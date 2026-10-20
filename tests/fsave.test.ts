import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import {
  FsaveSource,
  isFsaveJobUrl,
  resolveRenderJob,
  toDownloads,
  type FsaveApi,
} from "@/lib/fsave";

const VIDEO = "https://www.facebook.com/watch/?v=10153231379946729";
const REEL = "https://www.facebook.com/reel/10153231379946729";

// Trabajos y archivo con datos saneados (patrón real, contenido de prueba).
const JOB_1080 = "https://s1.worker01.com/v5/video/TESTVIDEOID/TESTMEDIA1080/1080p";
const JOB_720 = "https://s1.worker01.com/v5/video/TESTVIDEOID/TESTMEDIA720/720p";
const JOB_AUDIO = "https://s1.worker01.com/v5/audio/TESTVIDEOID/TESTMEDIA64K/64k";
const FILE_URL =
  "https://dl.iamworker.com/s1/v5/download/TESTVIDEOID/TESTMEDIA1080/TESTHASH?token=TESTTOKEN";

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

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html" } });
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

/** Encola `getch` → `ch`+`answer` (los dos pasos del mint). */
function queueMint(dt = "TESTDT0001"): void {
  queue.push(jsonResponse({ ch: "TESTCH0001.test.test" }));
  queue.push(jsonResponse({ dt }));
}

/** Respuesta `ok` de `proxy.php` con las tres pistas típicas de un reel. */
function okApi(items?: unknown): Response {
  const api: FsaveApi = {
    service: "Facebook",
    status: "ok",
    message: "Processing started.",
    id: "TESTVIDEOID",
    title: "Cómo compartir con solo amigos",
    description: "",
    previewUrl: "https://video-fra1.xx.fbcdn.net/o1/v/TESTPREVIEW.mp4?oe=TESTOE",
    permanentLink: "https://www.facebook.com/reel/TESTVIDEOID",
    mediaItems: (items as FsaveApi["mediaItems"]) ?? [
      {
        type: "Video",
        name: "Media #001",
        mediaId: "TESTMEDIA1080",
        mediaUrl: JOB_1080,
        mediaRes: "1080x1920",
        mediaQuality: "FHD",
        mediaExtension: "MP4",
        mediaFileSize: "120.85 MB",
        mediaDuration: "00:01:14",
        mediaTask: "render",
      },
      {
        type: "Video",
        name: "Media #002",
        mediaId: "TESTMEDIA720",
        mediaUrl: JOB_720,
        mediaRes: "720x1280",
        mediaQuality: "HD",
        mediaExtension: "MP4",
        mediaFileSize: "5.13 MB",
        mediaTask: "download",
      },
      {
        type: "Audio",
        name: "Media #003",
        mediaId: "TESTMEDIA64K",
        mediaUrl: JOB_AUDIO,
        mediaRes: false,
        mediaQuality: "64K",
        mediaExtension: "M4A",
        mediaFileSize: "1.13 MB",
        mediaTask: "render",
      },
    ],
  };
  return jsonResponse({ api });
}

/** Encola el flujo completo de resolución de un post. */
function queueResolve(): void {
  queueMint();
  queue.push(okApi());
}

/** Encola un trabajo de render: primer sondeo en curso, segundo completado. */
function queueRender(fileUrl = FILE_URL): void {
  queueMint();
  queue.push(
    jsonResponse({
      api: {
        status: "ok",
        fileName: "TEST.mp4",
        percent: "0%",
        progress: "0%",
        estimatedFileSize: "13.06 MB",
        fileSize: "13.06 MB",
        position: 1,
        totalWaiting: 0,
      },
    }),
  );
  queue.push(
    jsonResponse({
      api: {
        status: "ok",
        fileName: "TEST.mp4",
        percent: "100%",
        progress: "Completed",
        fileUrl,
        viewUrl: fileUrl,
        fileSize: "13.06 MB",
        fileSizeBytes: 13704894,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// isFsaveJobUrl
// ---------------------------------------------------------------------------
describe("isFsaveJobUrl", () => {
  it("acepta el patrón observado del CDN de FSave", () => {
    expect(isFsaveJobUrl(JOB_1080)).toBe(true);
    expect(isFsaveJobUrl(JOB_AUDIO)).toBe(true);
    expect(isFsaveJobUrl("https://s31.worker03.com/v5/video/123/456/720p")).toBe(true);
  });

  it("rechaza hosts, esquemas y rutas fuera del patrón", () => {
    expect(isFsaveJobUrl("http://s1.worker01.com/v5/video/1/2/720p")).toBe(false);
    expect(isFsaveJobUrl("https://evil.example.com/v5/video/1/2/720p")).toBe(false);
    expect(isFsaveJobUrl("https://s1.worker01.com/v5/video/1/2")).toBe(false);
    expect(isFsaveJobUrl("https://dl.iamworker.com/s1/v5/download/1/2/h")).toBe(false);
    expect(isFsaveJobUrl("")).toBe(false);
    expect(isFsaveJobUrl(null)).toBe(false);
    expect(isFsaveJobUrl("esto no es una URL")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toDownloads (unitario, sin red)
// ---------------------------------------------------------------------------
describe("toDownloads", () => {
  it("mapea mediaItems al modelo canónico y ordena por calidad", () => {
    const downloads = toDownloads({
      status: "ok",
      mediaItems: [
        { type: "Video", mediaUrl: JOB_720, mediaRes: "720x1280", mediaExtension: "MP4" },
        { type: "Video", mediaUrl: JOB_1080, mediaRes: "1080x1920", mediaExtension: "MP4" },
        { type: "Audio", mediaUrl: JOB_AUDIO, mediaRes: false, mediaQuality: "64K", mediaExtension: "M4A" },
      ],
    });

    expect(downloads).toHaveLength(3);
    expect(downloads.map((option) => option.quality)).toEqual(["1080p", "720p", "64 kbps"]);
    expect(downloads.map((option) => option.kind)).toEqual(["video", "video", "audio"]);
    expect(downloads.map((option) => option.format)).toEqual(["mp4", "mp4", "m4a"]);
    // Los vídeos progresivos de FSave traen audio (verificado en los MP4).
    expect(downloads[0].hasAudio).toBe(true);
    expect(downloads[2].hasAudio).toBeNull();
    // Opción diferida: URL relativa de resolución, nunca el job a pelo.
    expect(downloads[0].url).toBe(`/api/render?job=${encodeURIComponent(JOB_1080)}`);
  });

  it("usa el lado corto de la resolución como calidad convencional", () => {
    const [option] = toDownloads({
      status: "ok",
      mediaItems: [{ type: "Video", mediaUrl: JOB_1080, mediaRes: "1280x720" }],
    });
    expect(option.quality).toBe("720p");
  });

  it("descarta trabajos que no siguen el patrón del CDN", () => {
    const downloads = toDownloads({
      status: "ok",
      mediaItems: [
        { type: "Video", mediaUrl: "https://evil.example.com/video.mp4" },
        { type: "Video", mediaUrl: JOB_720, mediaRes: "720x1280" },
        { type: "Video", mediaRes: "720x1280" },
      ],
    });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].url).toContain("job=");
  });

  it("deduce el tipo de audio por la URL si falta `type`", () => {
    const downloads = toDownloads({
      status: "ok",
      mediaItems: [{ mediaUrl: JOB_AUDIO, mediaQuality: "64K" }],
    });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].kind).toBe("audio");
  });

  it("devuelve vacío si el servicio no envía mediaItems", () => {
    expect(toDownloads({ status: "ok", mediaItems: false })).toEqual([]);
    expect(toDownloads({ status: "ok" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchVideo
// ---------------------------------------------------------------------------
describe("searchVideo", () => {
  it("mapea la respuesta de proxy.php al modelo canónico", async () => {
    queueResolve();
    const source = new FsaveSource();

    const result = await source.searchVideo(VIDEO);

    expect(result.videoId).toBe("TESTVIDEOID");
    expect(result.title).toBe("Cómo compartir con solo amigos");
    expect(result.thumbnail).toContain("TESTPREVIEW");
    expect(result.downloads).toHaveLength(3);
    expect(result.downloads[0].quality).toBe("1080p");
    expect(result.downloads[2].kind).toBe("audio");

    // Secuencia: getch → challenge+answer → resolución del post.
    const sent = posts().map((call) => call.body);
    expect(sent[0]).toBe("getch=1");
    expect(sent[1]).toContain("ch=TESTCH0001.test.test");
    expect(sent[1]).toContain("answer=");
    expect(sent[2]).toContain(`url=${encodeURIComponent(VIDEO)}`);
    expect(sent[2]).toContain("dt=TESTDT0001");
  });

  it("resuelve enlaces cortos y reels igual que un watch", async () => {
    queueResolve();
    const source = new FsaveSource();

    const result = await source.searchVideo(REEL);
    expect(result.downloads.length).toBeGreaterThan(0);
  });

  it("acepta la entrada sin normalizar con espacios", async () => {
    queueResolve();
    const source = new FsaveSource();

    const result = await source.searchVideo(`  ${VIDEO}  `);
    expect(result.downloads).toHaveLength(3);
  });

  it("rechaza URLs que no son un vídeo de Facebook sin tocar la red", async () => {
    const source = new FsaveSource();
    const error = await source
      .searchVideo("https://www.facebook.com/somepage")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("convierte WRONG_SERVICE (HTTP 400) en UnavailableError", async () => {
    queueMint();
    queue.push(
      jsonResponse(
        { api: null, error: "WRONG_SERVICE", message: "Our service does not support this URL." },
        400,
      ),
    );
    const source = new FsaveSource();

    const error = await source.searchVideo(VIDEO).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as Error).message).toContain("does not support");
  });

  it("convierte INVALID_URL del api en UnavailableError", async () => {
    queueMint();
    queue.push(
      jsonResponse({
        api: {
          service: "Facebook",
          status: "error",
          error: "INVALID_URL",
          message: "Could not parse Facebook URL.",
          mediaItems: false,
        },
      }),
    );
    const source = new FsaveSource();

    const error = await source.searchVideo(VIDEO).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as Error).message).toBe("Could not parse Facebook URL.");
  });

  it("convierte FETCH_ERROR en un error reintentable", async () => {
    queueMint();
    queue.push(
      jsonResponse({
        api: {
          service: "Facebook",
          status: "error",
          error: "FETCH_ERROR",
          message: "Facebook is temporarily unavailable. Please try again.",
          mediaItems: false,
        },
      }),
    );
    const source = new FsaveSource();

    const error = await source.searchVideo(VIDEO).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
  });

  it("renueva el mint y reintenta si la sesión caducó (403 STALE_PAGE)", async () => {
    queueMint("TESTDT0001");
    queue.push(jsonResponse({ api: null, error: "STALE_PAGE", message: "Please refresh." }, 403));
    queueMint("TESTDT0002");
    queue.push(okApi());

    const source = new FsaveSource();
    const result = await source.searchVideo(VIDEO);

    expect(result.downloads).toHaveLength(3);
    expect(posts()).toHaveLength(6);
    expect(posts()[5].body).toContain("dt=TESTDT0002");
  });

  it("agota los intentos si STALE_PAGE persiste tras renovar", async () => {
    queueMint("TESTDT0001");
    queue.push(jsonResponse({ api: null, error: "STALE_PAGE" }, 403));
    queueMint("TESTDT0002");
    queue.push(jsonResponse({ api: null, error: "STALE_PAGE" }, 403));

    const source = new FsaveSource();
    const error = await source.searchVideo(VIDEO).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
  });

  it("reintenta ante un 503 transitorio", async () => {
    queueMint();
    queue.push(jsonResponse({ error: "internal" }, 503));
    queue.push(okApi());

    const source = new FsaveSource();
    const result = await source.searchVideo(VIDEO);
    expect(result.downloads).toHaveLength(3);
    expect(posts()).toHaveLength(4);
  });

  it("convierte una respuesta no JSON en error reintentable", async () => {
    queueMint();
    queue.push(textResponse("<html>cloudflare</html>"));

    const source = new FsaveSource();
    const error = await source.searchVideo(VIDEO).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
  });

  it("responde UnavailableError si no hay opciones de descarga", async () => {
    queueMint();
    queue.push(okApi([]));

    const source = new FsaveSource();
    const error = await source.searchVideo(VIDEO).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });
});

// ---------------------------------------------------------------------------
// resolveRenderJob
// ---------------------------------------------------------------------------
describe("resolveRenderJob", () => {
  it("sondea hasta Completed y devuelve la URL directa", async () => {
    queueRender();

    const rendered = await resolveRenderJob(JOB_1080);

    expect(rendered.url).toBe(FILE_URL);
    expect(rendered.fileName).toBe("TEST.mp4");
    // getch → mint → 2 sondeos al trabajo.
    expect(posts()).toHaveLength(4);
  });

  it("acepta trabajos ya listos (mediaTask download) al primer sondeo", async () => {
    queueMint();
    queue.push(
      jsonResponse({
        api: {
          status: "ok",
          progress: "Completed",
          fileName: "TEST.mp4",
          fileUrl: FILE_URL,
        },
      }),
    );

    const rendered = await resolveRenderJob(JOB_720);
    expect(rendered.url).toBe(FILE_URL);
  });

  it("rechaza un job fuera del patrón sin tocar la red", async () => {
    const error = await resolveRenderJob("https://evil.example.com/v5/video/1/2/720p").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rechaza un fileUrl cuyo host no está en la allowlist", async () => {
    queueRender("https://cdn.example.com/archivo.mp4");

    const error = await resolveRenderJob(JOB_1080).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
  });

  it("convierte un error del render en UnavailableError", async () => {
    queueMint();
    queue.push(
      jsonResponse({
        api: { status: "error", error: "INVALID_URL", message: "Could not parse Facebook URL." },
      }),
    );

    const error = await resolveRenderJob(JOB_1080).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("agota los sondeos si el trabajo nunca termina", async () => {
    queueMint();
    for (let i = 0; i < 20; i++) {
      queue.push(jsonResponse({ api: { status: "ok", progress: `${i}%`, percent: `${i}%` } }));
    }

    const error = await resolveRenderJob(JOB_1080).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Sesión (`mint`)
// ---------------------------------------------------------------------------
describe("mint", () => {
  it("usa el JS público del servicio si la clave configurada ha girado", async () => {
    // Primer mint fallido (dt ausente)…
    queue.push(jsonResponse({ ch: "TESTCH0001.a.b" }));
    queue.push(jsonResponse({ status: "error" }, 403));
    // …relectura de sensor.js…
    queue.push(textResponse("var K = 'fedcba9876543210fedcba9876543210';"));
    // …y nuevo mint con la clave rotada…
    queueMint("TESTDTROTADO");
    // …más los dos sondeos del trabajo.
    queue.push(jsonResponse({ api: { status: "ok", progress: "0%", percent: "0%" } }));
    queue.push(
      jsonResponse({
        api: { status: "ok", progress: "Completed", fileName: "TEST.mp4", fileUrl: FILE_URL },
      }),
    );

    const rendered = await resolveRenderJob(JOB_1080);
    expect(rendered.url).toBe(FILE_URL);

    const gets = calls.filter((call) => call.method === "GET");
    expect(gets).toHaveLength(1);
    expect(gets[0].url).toContain("sensor.js");
    // Los sondeos del trabajo van firmados con el `dt` de la clave rotada.
    expect(posts()).toHaveLength(6);
    expect(posts()[5].body).toContain("dt=TESTDTROTADO");
  });
});

// ---------------------------------------------------------------------------
// Contrato de la fuente
// ---------------------------------------------------------------------------
describe("FsaveSource (contrato)", () => {
  it("declara id, plataforma y ausencia de listados", () => {
    const source = new FsaveSource();
    expect(source.id).toBe("fsave");
    expect(source.platforms).toEqual(["facebook"]);
    expect(source.supportsProfiles).toBe(false);
  });

  it("rechaza los listados de páginas sin tocar la red", async () => {
    const source = new FsaveSource();
    const error = await source.listProfilePage("https://www.facebook.com/somepage").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
