import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import { LoveInstaSource, isLoveInstaJobUrl, toDownloads } from "@/lib/loveinsta";

const REEL = "https://www.instagram.com/reel/DeMbuYlBfMk/";
const POST = "https://www.instagram.com/p/DeX9ayNujGE/";

// Jobs del clúster de render (mismo patrón que FSave) con datos de prueba.
const JOB_1080 =
  "https://s2.worker03.com/v5/video/4002696103568208676/TESTHASH/1080p";
const JOB_720 =
  "https://s30.worker03.com/v5/video/4005940515030315396/TESTHASH2/720p";
// Fotos en `dl.iamworker.com` (host observado y ya presente en la allowlist).
const IMAGE =
  "https://dl.iamworker.com/s8/v5/download/TESTID/TESTHASH/TESTHASH?token=TESTTOKEN";
const THUMB =
  "https://dl.iamworker.com/s8/v5/views/TESTID/TESTHASH/TESTHASH?token=TESTTOKEN";

type QueueEntry = Response | Error;

let calls: Array<{ url: string; method: string; body: string; headers: Record<string, string> }> = [];
let queue: QueueEntry[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html" } });
}

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = queue.shift();
    if (!next) throw new Error("no hay respuestas encoladas");
    if (next instanceof Error) throw next;
    return next;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Respuesta `ok` de `proxy.php` con los elementos indicados. */
function startOk(mediaItems: unknown[], overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    api: {
      service: "Instagram",
      status: "ok",
      message: "Processing started.",
      id: "4002696103568208676",
      title: "Autor's Media",
      description: false,
      imagePreviewUrl: THUMB,
      previewUrl: false,
      mediaItems,
      ...overrides,
    },
  });
}

describe("LoveInstaSource.searchVideo", () => {
  it("entrega el job de render como opción perezosa con la calidad del job", async () => {
    queue.push(
      startOk([{ type: "Video", name: "Media #001", mediaUrl: JOB_1080, mediaThumbnail: THUMB }]),
    );

    const result = await new LoveInstaSource().searchVideo(REEL);

    const call = calls[0]!;
    expect(call.url).toBe("https://loveinsta.com/proxy.php");
    expect(call.method).toBe("POST");
    expect(call.body).toBe(`url=${encodeURIComponent(REEL)}`);
    expect(call.headers["Content-Type"]).toContain("application/x-www-form-urlencoded");
    expect(call.headers.Origin).toBe("https://loveinsta.com");
    expect(call.headers["X-Requested-With"]).toBe("XMLHttpRequest");

    expect(result.videoId).toBe("DeMbuYlBfMk");
    expect(result.title).toBe("Autor's Media");
    expect(result.thumbnail).toBe(THUMB);

    expect(result.downloads).toHaveLength(1);
    const option = result.downloads[0]!;
    expect(option.url).toBe(`/api/render?job=${encodeURIComponent(JOB_1080)}`);
    expect(option.kind).toBe("video");
    expect(option.format).toBe("mp4");
    expect(option.quality).toBe("1080p");
    // Verificado: los MP4 de los jobs traen pistas `soun` + `mp4a`.
    expect(option.hasAudio).toBe(true);
    expect(option.name).toBe("Vídeo 1080p");
  });

  it("resuelve las fotos como URL directa con su miniatura", async () => {
    queue.push(
      startOk([
        { type: "Image", name: "Media #001", mediaUrl: IMAGE, mediaThumbnail: THUMB },
        { type: "Image", name: "Media #002", mediaUrl: `${IMAGE}2`, mediaThumbnail: null },
      ]),
    );

    const result = await new LoveInstaSource().searchVideo(POST);

    expect(result.downloads).toHaveLength(2);
    expect(result.downloads.every((option) => option.kind === "image")).toBe(true);
    expect(result.downloads[0]!.format).toBe("jpg");
    expect(result.downloads[0]!.thumbnail).toBe(THUMB);
    // Sin miniatura propia, se usa la propia imagen.
    expect(result.downloads[1]!.thumbnail).toBe(`${IMAGE}2`);
    expect(result.thumbnail).toBe(THUMB);
  });

  it("mezcla vídeos y fotos: los vídeos primero, por calidad descendente", async () => {
    queue.push(
      startOk([
        { type: "Image", name: "Media #001", mediaUrl: IMAGE, mediaThumbnail: null },
        { type: "Video", name: "Media #002", mediaUrl: JOB_720, mediaThumbnail: null },
        { type: "Video", name: "Media #003", mediaUrl: JOB_1080, mediaThumbnail: null },
      ]),
    );

    const result = await new LoveInstaSource().searchVideo(POST);

    expect(result.downloads.map((option) => option.kind)).toEqual(["video", "video", "image"]);
    expect(result.downloads.map((option) => option.quality)).toEqual(["1080p", "720p", null]);
  });

  it("si no hay título ni pie, el título cae al código de la publicación", async () => {
    queue.push(
      startOk([{ type: "Video", name: "Media #001", mediaUrl: JOB_1080, mediaThumbnail: null }], {
        title: null,
        imagePreviewUrl: false,
      }),
    );

    const result = await new LoveInstaSource().searchVideo(REEL);

    expect(result.title).toBe("Instagram DeMbuYlBfMk");
    expect(result.thumbnail).toBeNull();
  });

  it("si el contenido no está disponible, responde como no disponible", async () => {
    queue.push(
      jsonResponse({
        api: {
          service: "Instagram",
          status: "error",
          error: "MEDIA_UNAVAILABLE",
          message: "No media items found.",
          mediaItems: false,
        },
      }),
    );

    const error = await new LoveInstaSource().searchVideo(REEL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnavailableError);
    expect((error as Error).message).toContain("No media items found.");
  });

  it("convierte un 400 INVALID_URL en contenido no disponible", async () => {
    queue.push(
      jsonResponse(
        { api: null, error: "INVALID_URL", message: "That does not look like a valid video link." },
        400,
      ),
    );

    await expect(new LoveInstaSource().searchVideo(REEL)).rejects.toBeInstanceOf(UnavailableError);
  });

  it("convierte un WRONG_SERVICE en contenido no disponible", async () => {
    queue.push(
      jsonResponse({ api: null, error: "WRONG_SERVICE", message: "Our service does not support this URL." }, 400),
    );

    await expect(new LoveInstaSource().searchVideo(REEL)).rejects.toBeInstanceOf(UnavailableError);
  });

  it("si el servicio responde otro servicio, no acepta la URL", async () => {
    queue.push(startOk([], { service: "Facebook" }));

    await expect(new LoveInstaSource().searchVideo(REEL)).rejects.toBeInstanceOf(UnavailableError);
  });

  it("si ningún elemento tiene host permitido, responde como no disponible", async () => {
    queue.push(
      startOk([{ type: "Image", name: "Media #001", mediaUrl: "https://evil.example.com/a.jpg", mediaThumbnail: null }]),
    );

    await expect(new LoveInstaSource().searchVideo(POST)).rejects.toBeInstanceOf(UnavailableError);
  });

  it("descarta el trabajo cuya URL no tiene forma de job", async () => {
    queue.push(
      startOk([
        { type: "Video", name: "Media #001", mediaUrl: "https://s2.worker03.com/v5/video/solo/dos", mediaThumbnail: null },
        { type: "Image", name: "Media #002", mediaUrl: IMAGE, mediaThumbnail: null },
      ]),
    );

    const result = await new LoveInstaSource().searchVideo(POST);

    expect(result.downloads).toHaveLength(1);
    expect(result.downloads[0]!.kind).toBe("image");
  });

  it("si la respuesta no es JSON, acaba en error reintentable", async () => {
    queue.push(htmlResponse("<!DOCTYPE html><html></html>"));

    const error = await new LoveInstaSource().searchVideo(REEL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
  });

  it("reintenta ante un 429 y acaba en error reintentable", async () => {
    queue.push(jsonResponse({}, 429), jsonResponse({}, 429), jsonResponse({}, 429));

    const error = await new LoveInstaSource().searchVideo(REEL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("si la red falla, acaba en error de red reintentable", async () => {
    queue.push(new Error("ENOTFOUND"), new Error("ENOTFOUND"), new Error("ENOTFOUND"));

    const error = await new LoveInstaSource().searchVideo(REEL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("no toca la red si la URL no es de Instagram", async () => {
    const error = await new LoveInstaSource()
      .searchVideo("https://example.com/video/1")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("LoveInstaSource.listProfilePage", () => {
  it("rechaza el listado sin tocar la red", async () => {
    const error = await new LoveInstaSource()
      .listProfilePage("https://www.instagram.com/nasa/")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("isLoveInstaJobUrl", () => {
  it("reconoce los jobs del clúster de render", () => {
    expect(isLoveInstaJobUrl(JOB_1080)).toBe(true);
    expect(isLoveInstaJobUrl(JOB_720)).toBe(true);
  });

  it("rechaza lo que no sea un job válido", () => {
    expect(isLoveInstaJobUrl(IMAGE)).toBe(false);
    expect(isLoveInstaJobUrl("https://s2.worker03.com/v5/video/solo/dos")).toBe(false);
    expect(isLoveInstaJobUrl("http://s2.worker03.com/v5/video/a/b/1080p")).toBe(false);
    expect(isLoveInstaJobUrl("https://evil.example.com/v5/video/a/b/1080p")).toBe(false);
    expect(isLoveInstaJobUrl("")).toBe(false);
    expect(isLoveInstaJobUrl(null)).toBe(false);
  });
});

describe("toDownloads", () => {
  it("ignora elementos sin URL o con host prohibido en las fotos", () => {
    const options = toDownloads({
      mediaItems: [
        { type: "Image", mediaUrl: "", mediaThumbnail: null },
        { type: "Image", mediaUrl: "https://evil.example.com/a.jpg", mediaThumbnail: null },
        { type: "Image", mediaUrl: IMAGE, mediaThumbnail: null },
      ],
    });

    expect(options).toHaveLength(1);
    expect(options[0]!.url).toBe(IMAGE);
  });

  it("devuelve una lista vacía si mediaItems no es una lista", () => {
    expect(toDownloads({ mediaItems: false })).toEqual([]);
    expect(toDownloads({})).toEqual([]);
  });
});
