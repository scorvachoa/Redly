import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import {
  IlovexSource,
  cleanTitle,
  isIlovexJobUrl,
  resolveIlovexRenderJob,
  toDownloads,
  type IlovexApi,
} from "@/lib/ilovex";

const TWEET = "https://x.com/SpaceX/status/2109957980011552839";

// Trabajos y archivo con datos saneados (patrón real, contenido de prueba).
const JOB_2160 = "https://s22.worker03.com/v5/video/TESTTWEET/TESTMEDIA2160/2160p";
const JOB_720 = "https://s22.worker03.com/v5/video/TESTTWEET/TESTMEDIA720/720p";
const FILE_URL =
  "https://dl.iamworker.com/s22/v5/download/TESTTWEET/TESTMEDIA2160/TESTHASH?token=TESTTOKEN";
const IMAGE_URL =
  "https://dl.iamworker.com/s22/v5/views/TESTTWEET/TESTMEDIAIMG/TESTHASH?token=TESTTOKEN";

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

/** Respuesta `ok` de `proxy.php` con un tweet de vídeo (patrón real). */
function okApi(items?: unknown): Response {
  const api: IlovexApi = {
    service: "X",
    status: "ok",
    id: "TESTTWEET",
    title: "SpaceX's Media",
    description: "Falcon 9 lands on Landing Zone 40 https://t.co/TEST",
    permanentLink: TWEET,
    userInfo: {
      name: "SpaceX",
      username: "SpaceX",
      userId: "TESTUSERID",
      userAvatar: "https://dl.iamworker.com/s22/v5/views/TESTUSER/TESTHASH?token=TESTTOKEN",
    },
    mediaItems: (items as IlovexApi["mediaItems"]) ?? [
      {
        type: "Video",
        name: "Media #001",
        mediaId: "TESTMEDIA2160",
        mediaUrl: JOB_2160,
        mediaPreviewUrl: "https://video.twimg.com/amplify_video/TEST/vid/TESTPREVIEW.mp4?tag=29",
        mediaThumbnail: "https://dl.iamworker.com/s22/v5/views/TEST/TESTTHUMB?token=TESTTOKEN",
        mediaRes: "3840x2160",
        mediaQuality: "4K",
        mediaDuration: "00:00:20",
        mediaExtension: "MP4",
        mediaFileSize: "23.89 MB",
        mediaTask: "download",
      },
    ],
  };
  return jsonResponse({ api, requestId: "TESTREQUEST", cache: "MISS" });
}

/** Encola el flujo completo de resolución de un tweet. */
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
// isIlovexJobUrl
// ---------------------------------------------------------------------------
describe("isIlovexJobUrl", () => {
  it("acepta el patrón observado del CDN de iLoveX", () => {
    expect(isIlovexJobUrl(JOB_2160)).toBe(true);
    expect(isIlovexJobUrl(JOB_720)).toBe(true);
    expect(isIlovexJobUrl("https://s31.worker03.com/v5/video/123/456/720p")).toBe(true);
  });

  it("rechaza hosts, esquemas y rutas fuera del patrón", () => {
    expect(isIlovexJobUrl("http://s22.worker03.com/v5/video/1/2/720p")).toBe(false);
    expect(isIlovexJobUrl("https://evil.example.com/v5/video/1/2/720p")).toBe(false);
    expect(isIlovexJobUrl("https://s22.worker03.com/v5/video/1/2")).toBe(false);
    expect(isIlovexJobUrl("https://s22.worker03.com/v5/audio/1/2/64k")).toBe(false);
    expect(isIlovexJobUrl("https://dl.iamworker.com/s22/v5/download/1/2/h")).toBe(false);
    expect(isIlovexJobUrl("")).toBe(false);
    expect(isIlovexJobUrl(null)).toBe(false);
    expect(isIlovexJobUrl("esto no es una URL")).toBe(false);
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
        { type: "Video", mediaUrl: JOB_720, mediaRes: "1280x720", mediaExtension: "MP4" },
        { type: "Video", mediaUrl: JOB_2160, mediaRes: "3840x2160", mediaExtension: "MP4" },
      ],
    });

    expect(downloads).toHaveLength(2);
    expect(downloads.map((option) => option.quality)).toEqual(["2160p", "720p"]);
    expect(downloads.map((option) => option.kind)).toEqual(["video", "video"]);
    expect(downloads.map((option) => option.format)).toEqual(["mp4", "mp4"]);
    // El MP4 final de iLoveX trae audio verificado (átomos soun+mp4a).
    expect(downloads[0].hasAudio).toBe(true);
    // Opción diferida: URL relativa con el servicio explícito, nunca el job a pelo.
    expect(downloads[0].url).toBe(
      `/api/render?job=${encodeURIComponent(JOB_2160)}&source=ilovex`,
    );
  });

  it("incluye las fotos directas sólo si su host está en la allowlist", () => {
    const downloads = toDownloads({
      status: "ok",
      mediaItems: [
        { type: "Image", mediaUrl: IMAGE_URL, mediaExtension: "JPG" },
        { type: "Image", mediaUrl: "https://pbs.twimg.com/media/TEST.jpg?format=jpg" },
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
        { type: "Video", mediaUrl: JOB_720, mediaRes: "1280x720" },
        { type: "Video", mediaRes: "1280x720" },
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
    const source = new IlovexSource();

    const result = await source.searchVideo(TWEET);

    expect(result.videoId).toBe("TESTTWEET");
    // El título usa el texto del tweet (description) por delante del título del servicio.
    expect(result.title).toContain("Falcon 9 lands");
    expect(result.thumbnail).toContain("TESTPREVIEW");
    expect(result.downloads).toHaveLength(1);
    expect(result.downloads[0].quality).toBe("2160p");

    // Un solo POST con el tweet (sin mint ni sesión).
    const sent = posts().map((call) => call.body);
    expect(sent).toEqual([`url=${encodeURIComponent(TWEET)}`]);
  });

  it("acepta la entrada con espacios y twitter.com", async () => {
    queueResolve();
    const source = new IlovexSource();

    const result = await source.searchVideo(
      "  https://twitter.com/SpaceX/status/2109957980011552839  ",
    );
    expect(result.downloads).toHaveLength(1);
  });

  it("rechaza URLs que no son un tweet sin tocar la red", async () => {
    const source = new IlovexSource();
    const error = await source
      .searchVideo("https://x.com/SpaceX")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("convierte TWEET_UNAVAILABLE en UnavailableError", async () => {
    queue.push(
      jsonResponse({
        api: {
          service: "X",
          status: "error",
          error: "TWEET_UNAVAILABLE",
          message: "Tweet unavailable.",
          mediaItems: false,
        },
      }),
    );
    const source = new IlovexSource();

    const error = await source.searchVideo(TWEET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as Error).message).toContain("Tweet unavailable");
  });

  it("convierte «Media unavailable» (tweet sin medios) en UnavailableError", async () => {
    queue.push(
      jsonResponse({
        api: {
          service: "X",
          status: "error",
          message: "Media unavailable.",
          id: "TESTTWEET",
          title: "SpaceX's Media",
          mediaItems: false,
        },
      }),
    );
    const source = new IlovexSource();

    const error = await source.searchVideo(TWEET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("rechaza un servicio que no es X", async () => {
    queue.push(jsonResponse({ api: { service: "TikTok", status: "ok", mediaItems: [] } }));
    const source = new IlovexSource();

    const error = await source.searchVideo(TWEET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("responde UnavailableError si no hay descargas tras el resolve", async () => {
    queueResolve([]);
    const source = new IlovexSource();

    const error = await source.searchVideo(TWEET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("reintenta ante 429 y termina con la respuesta buena", async () => {
    queue.push(new Response("rate limited", { status: 429 }));
    queue.push(new Response("boom", { status: 502 }));
    queueResolve();
    const source = new IlovexSource();

    const result = await source.searchVideo(TWEET);
    expect(result.downloads).toHaveLength(1);
    expect(posts()).toHaveLength(3);
  });

  it("convierte un cuerpo no JSON en RequestError reintentable", async () => {
    queue.push(textResponse("<html>cloudflare</html>"));
    const source = new IlovexSource();

    const error = await source.searchVideo(TWEET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveIlovexRenderJob
// ---------------------------------------------------------------------------
describe("resolveIlovexRenderJob", () => {
  it("sondea hasta Completed y devuelve el fileUrl permitido", async () => {
    queueRender();
    const rendered = await resolveIlovexRenderJob(JOB_2160);

    expect(rendered.url).toBe(FILE_URL);
    expect(rendered.fileName).toBe("TEST.mp4");
    const sent = posts().map((call) => call.body);
    expect(sent).toEqual([
      `url=${encodeURIComponent(JOB_2160)}`,
      `url=${encodeURIComponent(JOB_2160)}`,
    ]);
  });

  it("acepta un job ya completado al primer sondeo", async () => {
    queue.push(
      jsonResponse({
        api: { status: "completed", percent: "Completed", progress: "Completed", fileUrl: FILE_URL },
      }),
    );
    const rendered = await resolveIlovexRenderJob(JOB_2160);
    expect(rendered.url).toBe(FILE_URL);
  });

  it("rechaza jobs que no siguen el patrón sin tocar la red", async () => {
    const error = await resolveIlovexRenderJob("https://evil.example.com/v5/video/1/2/720p")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("rechaza un fileUrl cuyo host no está en la allowlist", async () => {
    queueRender("https://cdn.example.com/file.mp4");
    const error = await resolveIlovexRenderJob(JOB_2160).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect((error as Error).message).toContain("no permitido");
  });

  it("convierte un error del api durante el render en UnavailableError", async () => {
    queue.push(
      jsonResponse({
        api: { status: "error", error: "TWEET_UNAVAILABLE", message: "Tweet unavailable." },
      }),
    );
    const error = await resolveIlovexRenderJob(JOB_2160).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
  });

  it("se rinde tras agotar los sondeos", async () => {
    for (let i = 0; i < 20; i++) {
      queue.push(jsonResponse({ api: { status: "ok", percent: "12%", progress: "12%" } }));
    }
    const error = await resolveIlovexRenderJob(JOB_2160).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnavailableError);
    expect(posts()).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// listProfilePage / cleanTitle
// ---------------------------------------------------------------------------
describe("listProfilePage", () => {
  it("rechaza los perfiles sin tocar la red", async () => {
    const source = new IlovexSource();
    const error = await source
      .listProfilePage("https://x.com/SpaceX")
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
