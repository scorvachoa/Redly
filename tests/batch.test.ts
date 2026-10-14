import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { itemOutputPath, joinOutputDir, runBatch, Manifest } from "@/lib/batch";
import { DownloadError } from "@/lib/exceptions";
import type { ProfileVideo } from "@/lib/models";

// El downloader se sustituye por dobles: no hay red en los tests.
// La implementación por defecto se reinstala en cada `beforeEach` para que
// un `mockImplementation` de un test no se filtre a los siguientes.
const defaultDownload = async (
  url: string,
  outputPath: string,
  onProgress?: (done: number, total: number | null) => void,
): Promise<{ path: string; bytes: number }> => {
  if (url.includes("FALLA")) {
    throw new DownloadError("fallo simulado");
  }
  await mkdir(join(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, Buffer.alloc(2048, 0x78));
  onProgress?.(2048, 2048);
  return { path: outputPath, bytes: 2048 };
};

vi.mock("@/lib/downloader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/downloader")>();
  return {
    ...actual,
    resolveUrl: vi.fn(async (url: string) => ({
      originalUrl: url,
      finalUrl: url,
      redirected: true,
      statusCode: 200,
      hops: 1,
    })),
    downloadToFile: vi.fn(),
  };
});

const { downloadToFile } = await import("@/lib/downloader");

function makeItems(count: number): ProfileVideo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(7000000000000000000n + BigInt(index)),
    title: `Vídeo ${index}`,
    url: `https://pro.snapcdn.app/dl?token=OK_${index}`,
    format: "mp4",
  }));
}

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `redly-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  vi.mocked(downloadToFile).mockReset();
  vi.mocked(downloadToFile).mockImplementation(
    defaultDownload as unknown as typeof downloadToFile,
  );
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(dir, { recursive: true, force: true });
});

describe("runBatch", () => {
  it("descarga todo y escribe un manifiesto sin URLs ni tokens", async () => {
    const report = await runBatch(makeItems(2), { delay: 0, downloadDir: dir });

    expect(report.downloaded).toBe(2);
    expect(report.failed).toBe(0);

    const target = join(dir, "Redly_7000000000000000000.mp4");
    expect((await stat(target)).size).toBe(2048);

    const raw = await readFile(join(dir, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as { items: Record<string, { state: string; file: string }> };
    expect(manifest.items["7000000000000000000"].state).toBe("ok");
    expect(manifest.items["7000000000000000000"].file).toMatch(/\.mp4$/);

    // Los tokens nunca deben persistirse.
    expect(raw.toLowerCase()).not.toContain("http");
    expect(raw.toLowerCase()).not.toContain("token");
  });

  it("la reanudación omite los vídeos ya completados", async () => {
    const items = makeItems(2);
    await runBatch(items, { delay: 0, downloadDir: dir });
    vi.mocked(downloadToFile).mockClear();

    const second = await runBatch(items, { delay: 0, downloadDir: dir });

    expect(second.downloaded).toBe(0);
    expect(second.skipped).toBe(2);
    expect(downloadToFile).not.toHaveBeenCalled();
  });

  it("la reanudación reintenta los que fallaron", async () => {
    const items: ProfileVideo[] = [
      { id: "7000000000000000000", title: "ok", url: "https://pro.snapcdn.app/dl?token=OK", format: "mp4" },
      { id: "7000000000000000001", title: "fallo", url: "https://pro.snapcdn.app/dl?token=FALLA", format: "mp4" },
    ];

    const first = await runBatch(items, { delay: 0, downloadDir: dir });
    expect(first.failed).toBe(1);
    expect(first.downloaded).toBe(1);

    // Se "arregla" el fallo para la segunda pasada.
    vi.mocked(downloadToFile).mockImplementation(
      (async (_url: string, outputPath: string) => {
        await mkdir(join(outputPath, ".."), { recursive: true });
        await writeFile(outputPath, Buffer.alloc(2048, 0x78));
        return { path: outputPath as string, bytes: 2048 };
      }) as unknown as typeof downloadToFile,
    );

    const second = await runBatch(items, { delay: 0, downloadDir: dir });
    expect(second.downloaded).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.failed).toBe(0);
  });

  it("un fallo no detiene el lote", async () => {
    const items: ProfileVideo[] = [
      { id: "7000000000000000000", title: "fallo", url: "https://x/dl?token=FALLA", format: "mp4" },
      { id: "7000000000000000001", title: "ok", url: "https://x/dl?token=OK", format: "mp4" },
      { id: "7000000000000000002", title: "ok", url: "https://x/dl?token=OK2", format: "mp4" },
    ];

    const report = await runBatch(items, { delay: 0, downloadDir: dir });

    expect(report.downloaded).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.results[0].error).toContain("fallo simulado");
  });

  it("procesa exactamente los elementos que recibe", async () => {
    // El recorte por `--max` / `API_PROFILE_MAX` ocurre antes (CLI y API);
    // runBatch sólo baja la cola que se le entrega, en orden.
    const report = await runBatch(makeItems(5), { delay: 0, downloadDir: dir });

    expect(report.results).toHaveLength(5);
    expect(report.results.map((r) => r.key)).toEqual(
      makeItems(5).map((item) => item.id),
    );
  });

  it("emite los callbacks de inicio, progreso y fin", async () => {
    const events: string[] = [];
    const items = makeItems(1);

    await runBatch(
      items,
      { delay: 0, downloadDir: join(dir, "cb") },
      {
        onItemStart: (index, total) => events.push(`start:${index}/${total}`),
        onItemProgress: (done) => events.push(`bytes:${done}`),
        onItemDone: (_i, _t, result) => events.push(`done:${result.state}`),
      },
    );

    expect(events[0]).toBe("start:1/1");
    expect(events).toContain("bytes:2048");
    expect(events[events.length - 1]).toBe("done:ok");
  });

  it("resume=false vuelve a descargar", async () => {
    const items = makeItems(1);
    await runBatch(items, { delay: 0, downloadDir: dir });
    vi.mocked(downloadToFile).mockClear();

    const report = await runBatch(items, { delay: 0, downloadDir: dir, resume: false });

    expect(report.downloaded).toBe(1);
    expect(downloadToFile).toHaveBeenCalledTimes(1);
  });

  it("si desaparece el archivo, se vuelve a descargar", async () => {
    const items = makeItems(1);
    await runBatch(items, { delay: 0, downloadDir: dir });
    const { rm } = await import("node:fs/promises");
    await rm(join(dir, "Redly_7000000000000000000.mp4"), { force: true });

    const report = await runBatch(items, { delay: 0, downloadDir: dir });

    expect(report.downloaded).toBe(1);
  });
});

describe("subcarpeta por perfil (subdirFor)", () => {
  it("escribe cada ítem en su subcarpeta y el manifiesto en la raíz", async () => {
    const report = await runBatch(makeItems(2), {
      delay: 0,
      downloadDir: dir,
      subdirFor: (item) => (item.id.endsWith("0") ? "scout2015" : "otro"),
    });

    expect(report.downloaded).toBe(2);
    expect((await stat(join(dir, "scout2015", "Redly_7000000000000000000.mp4"))).size).toBe(2048);
    expect((await stat(join(dir, "otro", "Redly_7000000000000000001.mp4"))).size).toBe(2048);

    // El manifiesto se queda en la raíz, compartido entre perfiles.
    await expect(stat(join(dir, "manifest.json"))).resolves.toBeDefined();
    await expect(stat(join(dir, "scout2015", "manifest.json"))).rejects.toThrow();
  });

  it("la reanudación funciona entre subcarpetas (manifiesto compartido)", async () => {
    const items = makeItems(2);
    const subdirFor = () => "scout2015";

    await runBatch(items, { delay: 0, downloadDir: dir, subdirFor });
    vi.mocked(downloadToFile).mockClear();

    const second = await runBatch(items, { delay: 0, downloadDir: dir, subdirFor });

    expect(second.skipped).toBe(2);
    expect(downloadToFile).not.toHaveBeenCalled();
  });

  it("sin subdirFor se escribe en la raíz (comportamiento por defecto)", async () => {
    await runBatch(makeItems(1), { delay: 0, downloadDir: dir });

    expect((await stat(join(dir, "Redly_7000000000000000000.mp4"))).size).toBe(2048);
  });
});

describe("joinOutputDir", () => {
  it("une la raíz con una subcarpeta sin duplicar barras", () => {
    expect(joinOutputDir("downloads", "scout2015")).toBe("downloads/scout2015");
    expect(joinOutputDir("downloads/", "scout2015")).toBe("downloads/scout2015");
    expect(joinOutputDir("downloads///", "/scout2015/")).toBe("downloads/scout2015");
  });

  it("devuelve la raíz si no hay subcarpeta", () => {
    expect(joinOutputDir("downloads/", null)).toBe("downloads");
    expect(joinOutputDir("downloads", undefined)).toBe("downloads");
    expect(joinOutputDir("downloads", "")).toBe("downloads");
  });
});

describe("Manifest", () => {
  it("empieza de cero si el JSON está roto", async () => {
    const path = join(dir, "broken.json");
    await writeFile(path, "{{{ no es json", "utf8");

    const manifest = new Manifest(path);
    await manifest.load();

    expect(manifest.get("x")).toBeNull();
  });

  it("escribe de forma atómica (sin .tmp residual)", async () => {
    const path = join(dir, "atomic.json");
    const manifest = new Manifest(path);
    await manifest.load();
    await manifest.mark("abc", "ok", { file: "a.mp4", bytes: 10 });

    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw).items.abc.state).toBe("ok");
    await expect(stat(`${path}.tmp`)).rejects.toThrow();
  });
});

describe("itemOutputPath", () => {
  it("usa el id numérico y la extensión del vídeo", () => {
    const path = itemOutputPath("downloads", {
      id: "7694475743509646622",
      url: "https://x/a",
      format: "mp4",
    });

    expect(path).toBe("downloads/Redly_7694475743509646622.mp4");
  });

  it("sanea los ids no numéricos", () => {
    const path = itemOutputPath("salida/", {
      id: "anon/../x",
      url: "https://x/a",
      format: "mp3",
    });

    expect(path.startsWith("salida/")).toBe(true);
    expect(path).not.toContain("..");
    expect(path.endsWith(".mp3")).toBe(true);
  });
});
