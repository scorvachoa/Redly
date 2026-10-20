import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import {
  SavethreadsSource,
  cleanTitle,
  isSavethreadsJobUrl,
  resolveSavethreadsRenderJob,
  toDownloads,
  type SavethreadsApi,
} from "@/lib/savethreads";

const POST = "https://www.threads.com/@mileycyrus/post/DWSFx_jErAQ";

// Trabajos y archivo con datos saneados (patrón real, contenido de prueba).
const JOB_960 = "https://s12.worker03.com/v5/video/TESTPOST/TESTMEDIA960/720p";
const JOB_720 = "https://s12.worker03.com/v5/video/TESTPOST/TESTMEDIA720/720p";
const FILE_URL =
  "https://dl.iamworker.com/s12/v5/download/TESTPOST/TESTMEDIA960/TESTHASH?token=TESTTOKEN";
const IMAGE_URL =
  "https://dl.iamworker.com/s12/v5/download/TESTPOST/TESTMEDIAIMG/TESTHASH?token=TESTTOKEN";

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

/** Respuesta `ok` de `proxy.php` con un post de vídeo (patrón real). */
function okApi(items?: unknown): Response {
  const api: SavethreadsApi = {
    service: "Threads",
    status: "ok",
    description:
      "Last night at the premiere of the Hannah Montana 20th Anniversary Special. Standing with Jason.",
    userInfo: {
      name: "MILEY",
      username: "miley",
      userId: "TESTUSERID",
      userAvatar: "https://dl.iamworker.com/s12/v5/views/TESTUSER/TESTHASH?token=TESTTOKEN",
      isVerified: true,
    },
    mediaItems: (items as SavethreadsApi["mediaItems"]) ?? [
      {
        type: "Video",
        mediaId: "TESTMEDIA960",
        mediaUrl: JOB_960,
        mediaPreviewUrl:
          "https://scontent-sea5-1.cdninstagram.com/o1/v/t2/f2/m367/TESTPREVIEW.mp4?oe=TEST",
        mediaThumbnail: "https://dl.iamworker.com/s12/v5/views/TEST/TESTTHUMB?token=TESTTOKEN",
        mediaRes: "720x960",
        mediaQuality: "HD",
        mediaExtension: "MP4",
        mediaFileSize: "11.70 MB",
      },
    ],
  };
  return jsonResponse({ api, requestId: "TESTREQUEST", cache: "MISS" });
}

/** Encola el flujo completo de resolución de un post. */
function queueResolve(items?: unknown): void {
  queue.push(okApi(items));
}

/** Encola un trabajo de render: primer sondeo en curso, segundo completado. */
function queueRender(fileUrl = FILE_URL): void {
  queue.push(
    jsonResponse({
      api: { status: "ok", fileName: "TEST.mp4", percent: "0%", progress: "0%", position: 1 },
    }),
  );
  queue.push(
    jsonResponse({
      api: {
        status: "completed",
        fileName: "TEST.mp4",
        percent: "Completed",
        progress: "Completed",
        fileUrl,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// isSavethreadsJobUrl
// ---------------------------------------------------------------------------
describe("isSavethreadsJobUrl", () => {
  it("acepta el patrón observado del CDN de SaveThreads", () => {
    expect(isSavethreadsJobUrl(JOB_960)).toBe(true);
    expect(isSavethreadsJobUrl(JOB_720)).toBe(true);
    expect(isSavethreadsJobUrl("https://s31.worker03.com/v5/video/123/456/720p")).toBe(true);
  });

  it("rechaza hosts, esquemas y rutas fuera del patrón", () => {
    expect(isSavethreadsJobUrl("http://s12.worker03.com/v5/video/1/2/720p")).toBe(false);
    expect(isSavethreadsJobUrl("https://evil.example.com/v5/video/1/2/720p")).toBe(false);
    expect(isSavethreadsJobUrl("https://s12.worker03.com/v5/video/1/2")).toBe(false);
    expect(isSavethreadsJobUrl("https://s12.worker03.com/v5/audio/1/2/64k")).toBe(false);
    expect(isSavethreadsJobUrl("https://dl.iamworker.com/s12/v5/download/1/2/h")).toBe(false);
    expect(isSavethreadsJobUrl("")).toBe(false);
    expect(isSavethreadsJobUrl(null)).toBe(false);
    expect(isSavethreadsJobUrl("esto no es una URL")).toBe(false);
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
        { type: "Video", mediaUrl: JOB_720, mediaRes: "720x720", mediaExtension: "MP4" },
        { type: "Video", mediaUrl: JOB_960, mediaRes: "720x960", mediaExtension: "MP4" },
      ],
    });

    expect(downloads).toHaveLength(2);
    expect(downloads.map((option) => option.quality)).toEqual(["720p", "720p"]);
    expect(downloads.map((option) => option.kind)).toEqual(["video", "video"]);
    expect(downloads.map((option) => option.format)).toEqual(["mp4", "mp4"]);
    // El MP4 final del clúster worker trae audio embebido (misma familia que iLoveX).
    expect(downloads[0].hasAudio).toBe(true);
    // Opción diferida: URL relativa con el servicio explícito, nunca el job a pelo.
    // A igual altura el orden es estable: se conserva el orden del servicio.
    expect(downloads[0].url).toBe(
      `/api/render?job=${encodeURIComponent(JOB_720)}&source=savethreads`,
    );
    expect(downloads[1].url).toBe(
      `/api/render?job=${encodeURIComponent(JOB_960)}&source=savethreads`,
    );
  });

  it("ordena por altura descendente (lado corto de mediaRes)", () => {
    const tall = "https://s12.worker03.com/v5/video/TESTPOST/TESTTALL/1080p";
    const short = "https://s12.worker03.com/v5/video/TESTPOST/TESTSHORT/480p";
    const downloads = toDownloads({
      status: "ok",
      mediaItems: [
        { type: "Video", mediaUrl: short, mediaRes: "480x854" },
        { type: "Video", mediaUrl: tall, mediaRes: "1080x1920" },
      ],
    });
    expect(downloads.map((option) => option.quality)).toEqual(["1080p", "480p"]);
  });

  it("incluye las fotos directas sólo si su host está en la allowlist", () => {
    const downloads = toDownloads({
      status: "ok",
      mediaItems: [
        { type: "Image", mediaUrl: IMAGE_URL, mediaExtension: "JPG" },
        { type: "Image", mediaUrl: "https://evil.example.com/photo.jpg" },
      ],
    });

    expect(downloads).toHaveLength(1);
    expect(downloads[0].kind).toBe("image");
    expect(downloads[0].url).toBe(IMAGE_URL);
    expect(downloads[0].format).toBe("jpg");
    expect(downloads[0].thumbnail).toBe(IMAGE_URL);
  });

  it("descarta vídeos cuya URL no sigue el patrón del CDN", () => {
    const downloads = toDownloads({
      status: "ok",
      mediaItems: [
        { type: "Video", mediaUrl: "https://evil.example.com/video.mp4" },
        { type: "Video", mediaUrl: JOB_720, mediaRes: "720x720" },
        { type: "Video", mediaRes: "720x720" },
      ],
    });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].url).toContain("job=");
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
    const source = new SavethreadsSource();

    const result = await source.searchVideo(POST);

    expect(result.videoId).toBe("DWSFx_jErAQ");
    // El título usa la descripción del post por delante del autor.
    expect(result.title).toContain("Hannah Montana");
    expect(result.thumbnail).toContain("TESTPREVIEW");
    expect(result.downloads).toHaveLength(1);
    expect(result.downloads[0].quality).toBe("720p");

    // Un solo POST con el post (sin mint ni sesión).
    const sent = posts().map((call) => call.body);
    expect(sent).toEqual([`url=${encodeURIComponent(POST)}`]);
  });

  it("acepta la entrada con espacios y threads.net", async () => {
    queueResolve();
    const source = new SavethreadsSource();

    const result = await source.searchVideo(
      "  https://www.threads.net/@mileycyrus/post/DWSFx_jErAQ  ",
    );
    expect(result.downloads).toHaveLength(1);
  });

  it("rechaza URLs que no son un post sin tocar la red", async () => {
    const source = new SavethreadsSource();
    const error = await source
      .searchVideo("https://www.threads.com/@mileycyrus")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("convierte POST_UNAVAILABLE en UnavailableError", async () => {
    queue.push(
      jsonResponse({
        api: {
          service: "Threads",
          status: "error",
          error: "POST_UNAVAILABLE",
          message: "This post is no longer available.",
          mediaItems: false,
        },
      }),
    );
    const source = new SavethreadsSource();

    const error = await source.searchVideo(POST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as Error).message).toContain("no longer available");
  });

  it("rechaza un servicio que no es Threads", async () => {
    queue.push(jsonResponse({ api: { service: "X", status: "ok", mediaItems: [] } }));
    const source = new SavethreadsSource();

    const error = await source.searchVideo(POST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("responde UnavailableError si no hay descargas tras el resolve", async () => {
    queueResolve([]);
    const source = new SavethreadsSource();

    const error = await source.searchVideo(POST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("reintenta ante 429 y termina con la respuesta buena", async () => {
    queue.push(new Response("rate limited", { status: 429 }));
    queue.push(new Response("boom", { status: 502 }));
    queueResolve();
    const source = new SavethreadsSource();

    const result = await source.searchVideo(POST);
    expect(result.downloads).toHaveLength(1);
    expect(posts()).toHaveLength(3);
  });

  it("convierte un cuerpo no JSON en RequestError reintentable", async () => {
    queue.push(textResponse("<html>cloudflare</html>"));
    const source = new SavethreadsSource();

    const error = await source.searchVideo(POST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveSavethreadsRenderJob
// ---------------------------------------------------------------------------
describe("resolveSavethreadsRenderJob", () => {
  it("sondea hasta Completed y devuelve el fileUrl permitido", async () => {
    queueRender();
    const rendered = await resolveSavethreadsRenderJob(JOB_960);

    expect(rendered.url).toBe(FILE_URL);
    expect(rendered.fileName).toBe("TEST.mp4");
    const sent = posts().map((call) => call.body);
    expect(sent).toEqual([
      `url=${encodeURIComponent(JOB_960)}`,
      `url=${encodeURIComponent(JOB_960)}`,
    ]);
  });

  it("acepta un job ya completado al primer sondeo", async () => {
    queue.push(
      jsonResponse({
        api: { status: "completed", percent: "Completed", progress: "Completed", fileUrl: FILE_URL },
      }),
    );
    const rendered = await resolveSavethreadsRenderJob(JOB_960);
    expect(rendered.url).toBe(FILE_URL);
  });

  it("rechaza jobs que no siguen el patrón sin tocar la red", async () => {
    const error = await resolveSavethreadsRenderJob("https://evil.example.com/v5/video/1/2/720p")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rechaza un fileUrl cuyo host no está en la allowlist", async () => {
    queueRender("https://cdn.example.com/file.mp4");
    const error = await resolveSavethreadsRenderJob(JOB_960).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect((error as Error).message).toContain("no permitido");
  });

  it("convierte un error del api durante el render en UnavailableError", async () => {
    queue.push(
      jsonResponse({
        api: { status: "error", error: "POST_UNAVAILABLE", message: "This post is no longer available." },
      }),
    );
    const error = await resolveSavethreadsRenderJob(JOB_960).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("se rinde tras agotar los sondeos", async () => {
    for (let i = 0; i < 20; i++) {
      queue.push(jsonResponse({ api: { status: "ok", percent: "12%", progress: "12%" } }));
    }
    const error = await resolveSavethreadsRenderJob(JOB_960).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
    expect(posts()).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// listProfilePage / cleanTitle
// ---------------------------------------------------------------------------
describe("listProfilePage", () => {
  it("rechaza los perfiles sin tocar la red", async () => {
    const source = new SavethreadsSource();
    const error = await source
      .listProfilePage("https://www.threads.com/@mileycyrus")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("cleanTitle", () => {
  it("colapsa espacios, descarta N/A y trunca textos largos", () => {
    expect(cleanTitle("  hola   mundo  ")).toBe("hola mundo");
    expect(cleanTitle("N/A")).toBeNull();
    expect(cleanTitle(null)).toBeNull();
    const long = "x".repeat(200);
    expect(cleanTitle(long)).toHaveLength(160);
    expect(cleanTitle(long)!.endsWith("…")).toBe(true);
  });
});
