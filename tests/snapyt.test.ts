import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import { SnapYTSource, parseMergeForm, parsePreviewOptions } from "@/lib/snapyt";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SHORT = "https://youtu.be/dQw4w9WgXcQ";
const CANAL = "https://www.youtube.com/@rickastley";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const PREVIEW_HTML = fixture("snapyt_preview.html");

interface RecordedCall {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

let calls: RecordedCall[] = [];
let queue: Response[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html" } });
}

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : "";
    calls.push({ url, method, body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (queue.length === 0) throw new Error("no hay respuestas encoladas");
    return queue.shift() as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function posts(): RecordedCall[] {
  return calls.filter((call) => call.method === "POST");
}

function gets(): RecordedCall[] {
  return calls.filter((call) => call.method === "GET");
}

/** Encola el flujo completo: nonce → redirect → preview HTML. */
function queueHappyPath(): void {
  queue.push(jsonResponse({ success: true, data: { nonce: "abc123def4" } }));
  queue.push(
    jsonResponse({
      success: true,
      data: { redirect: "https://www.snapyt.app/video-preview/?preview_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&q=test" },
    }),
  );
  queue.push(htmlResponse(PREVIEW_HTML));
}

// ---------------------------------------------------------------------------
// parsePreviewOptions (unitario, sin red)
// ---------------------------------------------------------------------------
describe("parsePreviewOptions", () => {
  it("extrae las opciones del select del fixture", () => {
    const options = parsePreviewOptions(PREVIEW_HTML);
    // El fixture trae 24 filas con data-force (vídeo + audio).
    expect(options.length).toBeGreaterThanOrEqual(10);
    for (const option of options) {
      expect(option.forceUrl).toContain("snapyt_force_download");
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it("devuelve vacío si no hay select", () => {
    expect(parsePreviewOptions("<html><body>no hay</body></html>")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseMergeForm (formulario de combinación del preview)
// ---------------------------------------------------------------------------
describe("parseMergeForm", () => {
  it("lee pid, nonce, calidades y audio por defecto del fixture", () => {
    const form = parseMergeForm(PREVIEW_HTML);

    expect(form).not.toBeNull();
    expect(form!.pid).toBe("TESTPID0000000000");
    expect(form!.nonce).toBe("TESTNONCE0");
    // El fixture trae 16 calidades de vídeo y 4 pistas de audio.
    expect(form!.videoValues).toContain("5");
    expect(form!.audioValues).toEqual(expect.arrayContaining(["17", "19", "20"]));
    expect(form!.defaultAudio).toBe("17");
  });

  it("devuelve null si la web quita el bloque de merge", () => {
    const broken = PREVIEW_HTML.replace(/<a id="merge-link"[\s\S]*?<\/a>/, "");
    expect(parseMergeForm(broken)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// searchVideo
// ---------------------------------------------------------------------------
describe("searchVideo", () => {
  it("mapea el HTML del preview al modelo canónico", async () => {
    queueHappyPath();
    const source = new SnapYTSource();

    const result = await source.searchVideo(VIDEO);

    expect(result.videoId).toBe("dQw4w9WgXcQ");
    expect(result.title).toContain("Never Gonna Give You Up");
    expect(result.thumbnail).toContain("i.ytimg.com");
    expect(result.downloads.length).toBeGreaterThan(0);
  });

  it("ofrece opciones de vídeo y audio con kind correcto", async () => {
    queueHappyPath();
    const source = new SnapYTSource();

    const result = await source.searchVideo(VIDEO);

    const videos = result.downloads.filter((option) => option.kind === "video");
    const audios = result.downloads.filter((option) => option.kind === "audio");
    expect(videos.length).toBeGreaterThan(0);
    expect(audios.length).toBeGreaterThan(0);
    // El audio y la progresiva bajan directo del proxy de SnapYT.
    for (const option of audios) {
      expect(option.url).toContain("snapyt_force_download");
    }
    const progressive = videos.find((option) => option.quality === "360p");
    expect(progressive?.url).toContain("snapyt_force_download");
    // La progresiva trae el sonido en la misma pista; el resto, no.
    expect(progressive?.hasAudio).toBe(true);
    expect(videos.filter((option) => option.hasAudio === false).length).toBeGreaterThan(0);
  });

  it("las opciones de alta resolución combinan vídeo+audio vía /api/merge", async () => {
    queueHappyPath();
    const source = new SnapYTSource();

    const result = await source.searchVideo(VIDEO);

    // Todas las calidades altas son `video-only` en SnapYT: su URL pasa a ser
    // la ruta de combinación de Red.ly con yt/v/a.
    const hd = result.downloads.find(
      (option) => option.kind === "video" && option.quality === "1080p",
    );
    expect(hd).toBeDefined();
    expect(hd!.url.startsWith("/api/merge?")).toBe(true);
    expect(hd!.hasAudio).toBe(false);
    const params = new URLSearchParams(hd!.url.slice(hd!.url.indexOf("?")));
    expect(params.get("yt")).toBe(VIDEO);
    expect(params.get("v")).toBe("5"); // 1080p MP4 en el fixture
    expect(params.get("a")).toBe("17"); // M4A 131 kbps (`data-default` del merge)

    // En cambio, la progresiva recomendada (360p) y el audio no combinan:
    // la progresiva ya trae audio en la misma pista.
    const progressive = result.downloads.find((option) => option.name.includes("Recommended"));
    expect(progressive?.url).toContain("snapyt_force_download");
    for (const option of result.downloads.filter((item) => item.kind === "audio")) {
      expect(option.url).toContain("snapyt_force_download");
    }
    // El resto de calidades de vídeo del fixture son todas `video-only`.
    const videoOnly = result.downloads.filter(
      (option) => option.kind === "video" && option !== progressive,
    );
    expect(videoOnly.length).toBeGreaterThan(0);
    for (const option of videoOnly) {
      expect(option.url.startsWith("/api/merge?")).toBe(true);
    }
  });

  it("ordena el vídeo de mayor a menor resolución", async () => {
    queueHappyPath();
    const source = new SnapYTSource();

    const result = await source.searchVideo(VIDEO);

    const videos = result.downloads.filter((option) => option.kind === "video");
    const heights = videos.map((option) => {
      const match = /(\d{3,4})p/.exec(option.quality ?? "");
      return match ? Number(match[1]) : 0;
    });
    const sorted = [...heights].sort((a, b) => b - a);
    expect(heights).toEqual(sorted);
    // La más alta del fixture es 2160p.
    expect(heights[0]).toBe(2160);
  });

  it("ordena el audio de mayor a menor bitrate", async () => {
    queueHappyPath();
    const source = new SnapYTSource();

    const result = await source.searchVideo(VIDEO);

    const audios = result.downloads.filter((option) => option.kind === "audio");
    expect(audios.length).toBeGreaterThan(1);
    const bitrates = audios.map((option) => {
      const match = /(\d+)\s*kbps/i.exec(option.quality ?? "");
      return match ? Number(match[1]) : 0;
    });
    const sorted = [...bitrates].sort((a, b) => b - a);
    expect(bitrates).toEqual(sorted);
    // El mayor del fixture es el MP3 de 320 kbps.
    expect(bitrates[0]).toBe(320);
  });

  it("pide el nonce, luego el redirect, luego el preview", async () => {
    queueHappyPath();
    const source = new SnapYTSource();

    await source.searchVideo(VIDEO);

    const postCalls = posts();
    expect(postCalls.length).toBe(2);
    expect(postCalls[0].body).toContain("action=vd_fresh_nonce");
    expect(postCalls[1].body).toContain("action=process_video_url");
    expect(postCalls[1].body).toContain(encodeURIComponent(VIDEO));
    expect(gets()).toHaveLength(1);
    expect(gets()[0].url).toContain("video-preview");
  });

  it("envía las cabeceras del navegador en el admin-ajax", async () => {
    queueHappyPath();
    const source = new SnapYTSource();

    await source.searchVideo(VIDEO);

    const call = posts()[0];
    expect(call.url).toContain("admin-ajax.php");
    expect(call.headers["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(String(call.headers.Origin)).toContain("snapyt.app");
  });

  it("acepta el enlace corto y los Shorts", async () => {
    queueHappyPath();
    queueHappyPath();
    const source = new SnapYTSource();

    const short = await source.searchVideo(SHORT);
    const shorts = await source.searchVideo("https://www.youtube.com/shorts/dQw4w9WgXcQ");

    expect(short.videoId).toBe("dQw4w9WgXcQ");
    expect(shorts.videoId).toBe("dQw4w9WgXcQ");
  });

  it("si la web no trae el bloque de merge, las calidades altas conservan data-force", async () => {
    const broken = PREVIEW_HTML.replace(/<a id="merge-link"[\s\S]*?<\/a>/, "");
    queue.push(jsonResponse({ success: true, data: { nonce: "abc123def4" } }));
    queue.push(
      jsonResponse({
        success: true,
        data: { redirect: "https://www.snapyt.app/video-preview/?preview_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&q=test" },
      }),
    );
    queue.push(htmlResponse(broken));
    const source = new SnapYTSource();

    const result = await source.searchVideo(VIDEO);

    const hd = result.downloads.find(
      (option) => option.kind === "video" && option.quality === "1080p",
    );
    expect(hd?.url).toContain("snapyt_force_download");
  });

  it("rechaza una URL que no es un vídeo sin llegar a la red", async () => {
    const source = new SnapYTSource();

    await expect(source.searchVideo(CANAL)).rejects.toBeInstanceOf(RequestError);
    expect(calls).toHaveLength(0);
  });

  it("HTTP 404 en el preview se traduce en contenido no disponible", async () => {
    queue.push(jsonResponse({ success: true, data: { nonce: "abc123def4" } }));
    queue.push(
      jsonResponse({
        success: true,
        data: { redirect: "https://www.snapyt.app/video-preview/?preview_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&q=test" },
      }),
    );
    queue.push(htmlResponse("no existe", 404));
    const source = new SnapYTSource();

    await expect(source.searchVideo(VIDEO)).rejects.toBeInstanceOf(UnavailableError);
  });

  it("reintenta ante errores transitorios en el admin-ajax", async () => {
    queue.push(jsonResponse({}, 503));
    queue.push(jsonResponse({ success: true, data: { nonce: "abc123def4" } }));
    queue.push(
      jsonResponse({
        success: true,
        data: { redirect: "https://www.snapyt.app/video-preview/?preview_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&q=test" },
      }),
    );
    queue.push(htmlResponse(PREVIEW_HTML));
    const source = new SnapYTSource();

    const result = await source.searchVideo(VIDEO);

    expect(result.downloads.length).toBeGreaterThan(0);
    expect(posts()[0].body).toContain("vd_fresh_nonce");
  });

  it("si el proceso no devuelve redirect, se reporta como no disponible", async () => {
    queue.push(jsonResponse({ success: true, data: { nonce: "abc123def4" } }));
    queue.push(jsonResponse({ success: false, message: "Invalid url." }));
    const source = new SnapYTSource();

    await expect(source.searchVideo(VIDEO)).rejects.toThrow("Invalid url.");
  });

  it("si el nonce falta, se reporta como error de la fuente", async () => {
    queue.push(jsonResponse({ success: true, data: {} }));
    const source = new SnapYTSource();

    await expect(source.searchVideo(VIDEO)).rejects.toBeInstanceOf(RequestError);
  });

  it("lanza error si el admin-ajax no es JSON", async () => {
    queue.push(htmlResponse("<html>oops</html>"));
    const source = new SnapYTSource();

    await expect(source.searchVideo(VIDEO)).rejects.toBeInstanceOf(RequestError);
  });

  it("sin opciones de descarga se reporta como no disponible", async () => {
    queue.push(jsonResponse({ success: true, data: { nonce: "abc123def4" } }));
    queue.push(
      jsonResponse({
        success: true,
        data: { redirect: "https://www.snapyt.app/video-preview/?preview_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&q=test" },
      }),
    );
    queue.push(htmlResponse("<html><body><select id='fmt-select'></select></body></html>"));
    const source = new SnapYTSource();

    await expect(source.searchVideo(VIDEO)).rejects.toBeInstanceOf(UnavailableError);
  });
});

// ---------------------------------------------------------------------------
// listProfilePage (canales rechazados; las listas se prueban en ytmp3.test.ts)
// ---------------------------------------------------------------------------
describe("listProfilePage", () => {
  it("rechaza un canal sin tocar la red", async () => {
    const source = new SnapYTSource();

    await expect(source.listProfilePage(CANAL)).rejects.toBeInstanceOf(RequestError);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Contrato ContentSource
// ---------------------------------------------------------------------------
describe("contrato ContentSource", () => {
  it("declara id, plataforma y soporte de listas", () => {
    const source = new SnapYTSource();

    expect(source.id).toBe("snapyt");
    expect(source.platforms).toContain("youtube");
    expect(source.supportsProfiles).toBe(true);
  });
});
