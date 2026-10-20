import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import {
  IgexportSource,
  cleanTitle,
  fetchOEmbed,
  searchAny,
  toPhotoDownloads,
  toVideoDownload,
} from "@/lib/igexport";

const REEL = "https://www.instagram.com/reel/DeMbuYlBfMk/";
const PHOTO = "https://www.instagram.com/p/DeX9ayNujGE/";

// CDN de Instagram con datos de prueba (el patrón de host es el observado).
const CDN_VIDEO =
  "https://scontent-lga3-2.cdninstagram.com/o1/v/t2/f2/m86/TESTVIDEO.mp4?_nc_cat=1&oe=TESTOE";
const CDN_VIDEO_2 =
  "https://scontent-iad3-2.cdninstagram.com/o1/v/t2/f2/m86/TESTCAROUSEL.mp4?oe=TESTOE";
const CDN_IMAGE = "https://scontent-ams2-1.cdninstagram.com/v/test_photo.jpg?oe=TESTOE";
const CDN_THUMB =
  "https://scontent-lga3-2.cdninstagram.com/v/t51.2885-15/test_thumb.jpg?oe=TESTOE";

type QueueEntry = Response | Error;

let calls: Array<{ url: string; headers: Record<string, string> }> = [];
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
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const next = queue.shift();
    if (!next) throw new Error("no hay respuestas encoladas");
    if (next instanceof Error) throw next;
    return next;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Respuesta `ok` de `/api/ig-reels/` con el MP4 directo del CDN. */
function reelsOk(videoUrl = CDN_VIDEO): Response {
  return jsonResponse({
    ok: true,
    source: 1,
    media: { videoUrl, thumbnailUrl: CDN_THUMB, filename: "igexport-DeMbuYlBfMk.mp4" },
  });
}

/** Respuesta `ok` de `/api/ig-photo/` con los elementos indicados. */
function photoOk(items: unknown[]): Response {
  return jsonResponse({
    ok: true,
    source: 1,
    media: { shortcode: "DeX9ayNujGE", items },
  });
}

/** oEmbed con pie de foto y autor. */
function oembedOk(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    title: "Caption del post",
    author_name: "nasa",
    thumbnail_url: CDN_THUMB,
    ...overrides,
  });
}

// Job del clúster de render de LoveInsta (datos de prueba).
const LI_JOB =
  "https://s2.worker03.com/v5/video/4002696103568208676/TESTHASH/1080p";

/** Respuesta `ok` del `proxy.php` de LoveInsta con un trabajo de vídeo. */
function liStartVideo(): Response {
  return jsonResponse({
    api: {
      service: "Instagram",
      status: "ok",
      message: "Processing started.",
      title: "Autor's Media",
      imagePreviewUrl: null,
      mediaItems: [{ type: "Video", name: "Media #001", mediaUrl: LI_JOB, mediaThumbnail: null }],
    },
  });
}

describe("IgexportSource.searchVideo", () => {
  it("resuelve un reel con el MP4 directo y el título del oEmbed", async () => {
    queue.push(reelsOk(), oembedOk({ title: "  Cómo\nhacer   cosas  " }));

    const result = await new IgexportSource().searchVideo(REEL);

    expect(calls[0]?.url).toContain("igexport.com/api/ig-reels/");
    expect(calls[0]?.url).toContain(
      `url=${encodeURIComponent(REEL)}&videoOnly=1`,
    );
    expect(calls[0]?.headers.Referer).toBe("https://igexport.com/");
    expect(calls[1]?.url).toContain("instagram.com/api/v1/oembed/");

    expect(result.videoId).toBe("DeMbuYlBfMk");
    expect(result.title).toBe("Cómo hacer cosas");
    expect(result.thumbnail).toBe(CDN_THUMB);

    expect(result.downloads).toHaveLength(1);
    const option = result.downloads[0]!;
    expect(option.url).toBe(CDN_VIDEO);
    expect(option.kind).toBe("video");
    expect(option.format).toBe("mp4");
    expect(option.quality).toBeNull();
    // Verificado: el MP4 del CDN trae pistas de vídeo y audio.
    expect(option.hasAudio).toBe(true);
    expect(option.name).toBe("Vídeo");
  });

  it("si la publicación no tiene vídeo, cae en el endpoint de fotos", async () => {
    queue.push(
      jsonResponse({ ok: false, error: "not_found" }, 404),
      photoOk([
        { type: "image", url: CDN_IMAGE, thumbnailUrl: null, filename: "photo_1.jpg" },
        { type: "image", url: `${CDN_IMAGE}2`, thumbnailUrl: CDN_THUMB, filename: "photo_2.jpg" },
      ]),
      oembedOk({ title: "", author_name: "galactichighway3000" }),
    );

    const result = await new IgexportSource().searchVideo(PHOTO);

    expect(calls[0]?.url).toContain("ig-reels/");
    expect(calls[1]?.url).toContain(`ig-photo/?url=${encodeURIComponent(PHOTO)}`);
    expect(result.videoId).toBe("DeX9ayNujGE");
    // El oEmbed trae el pie en `title` vacío: manda el autor.
    expect(result.title).toBe("@galactichighway3000");

    expect(result.downloads).toHaveLength(2);
    expect(result.downloads.every((option) => option.kind === "image")).toBe(true);
    expect(result.downloads[0]!.format).toBe("jpg");
    // Sin miniatura propia, se usa la propia imagen.
    expect(result.downloads[0]!.thumbnail).toBe(CDN_IMAGE);
    expect(result.downloads[1]!.thumbnail).toBe(CDN_THUMB);
    expect(result.thumbnail).toBe(CDN_IMAGE);
  });

  it("incluye los vídeos del carrusel sin inventar la etiqueta de audio", async () => {
    queue.push(
      jsonResponse({ ok: false, error: "not_found" }, 404),
      photoOk([
        { type: "video", url: CDN_VIDEO_2, thumbnailUrl: null, filename: "clip.mp4" },
        { type: "image", url: CDN_IMAGE, thumbnailUrl: null, filename: "photo_1.jpg" },
      ]),
      jsonResponse({}),
    );

    const result = await new IgexportSource().searchVideo(PHOTO);

    expect(result.downloads).toHaveLength(2);
    expect(result.downloads[0]!.kind).toBe("video");
    expect(result.downloads[0]!.format).toBe("mp4");
    expect(result.downloads[0]!.hasAudio).toBeUndefined();
    expect(result.downloads[1]!.kind).toBe("image");
    // Sin metadatos: el título cae al código de la publicación.
    expect(result.title).toBe("Instagram DeX9ayNujGE");
  });

  it("descarta los elementos con host fuera de la allowlist", async () => {
    queue.push(
      jsonResponse({ ok: false, error: "not_found" }, 404),
      photoOk([
        { type: "image", url: "https://evil.example.com/photo.jpg", thumbnailUrl: null },
        { type: "image", url: CDN_IMAGE, thumbnailUrl: null, filename: "photo_1.jpg" },
      ]),
      oembedOk(),
    );

    const result = await new IgexportSource().searchVideo(PHOTO);

    expect(result.downloads).toHaveLength(1);
    expect(result.downloads[0]!.url).toBe(CDN_IMAGE);
  });

  it("si ningún elemento está permitido, responde como no disponible", async () => {
    queue.push(
      jsonResponse({ ok: false, error: "not_found" }, 404),
      photoOk([{ type: "image", url: "https://evil.example.com/photo.jpg", thumbnailUrl: null }]),
    );

    await expect(new IgexportSource().searchVideo(PHOTO)).rejects.toBeInstanceOf(
      UnavailableError,
    );
  });

  it("rechaza un videoUrl cuyo host no está permitido", async () => {
    queue.push(reelsOk("https://scontent.evilcdn.com/o1/v/test.mp4"));

    await expect(new IgexportSource().searchVideo(REEL)).rejects.toThrow(
      /Host de descarga no permitido/,
    );
  });

  it("convierte el invalid_url del servicio en contenido no disponible", async () => {
    queue.push(jsonResponse({ ok: false, error: "invalid_url" }, 400));

    await expect(new IgexportSource().searchVideo(REEL)).rejects.toBeInstanceOf(
      UnavailableError,
    );
  });

  it("reintenta ante un 502 con cuerpo HTML y acaba en error reintentable", async () => {
    queue.push(
      htmlResponse("<!DOCTYPE html><html></html>", 502),
      htmlResponse("<!DOCTYPE html><html></html>", 502),
      htmlResponse("<!DOCTYPE html><html></html>", 502),
    );

    const error = await new IgexportSource().searchVideo(REEL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("si la red falla, acaba en error de red reintentable", async () => {
    queue.push(new Error("ENOTFOUND"), new Error("ENOTFOUND"), new Error("ENOTFOUND"));

    const error = await new IgexportSource().searchVideo(REEL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(true);
  });

  it("no toca la red si la URL no es de Instagram", async () => {
    const error = await new IgexportSource()
      .searchVideo("https://example.com/video/1")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("si el oEmbed falla, el título cae al autor o al código", async () => {
    queue.push(reelsOk(), new Error("ETIMEDOUT"));

    const result = await new IgexportSource().searchVideo(REEL);

    expect(result.title).toBe("Instagram DeMbuYlBfMk");
    expect(result.downloads).toHaveLength(1);
  });
});

describe("IgexportSource.listProfilePage", () => {
  it("rechaza el listado sin tocar la red", async () => {
    const error = await new IgexportSource()
      .listProfilePage("https://www.instagram.com/nasa/")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).retryable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("fetchOEmbed", () => {
  it("devuelve null si el servicio responde con un error", async () => {
    queue.push(jsonResponse({ message: "error" }, 404));

    expect(await fetchOEmbed(REEL)).toBeNull();
  });

  it("devuelve null si la respuesta no es un objeto", async () => {
    queue.push(jsonResponse("nope"));

    expect(await fetchOEmbed(REEL)).toBeNull();
  });
});

describe("toVideoDownload", () => {
  it("mapea el media del servicio a una opción directa con audio", () => {
    const option = toVideoDownload({
      videoUrl: CDN_VIDEO,
      thumbnailUrl: CDN_THUMB,
      filename: "igexport-DeMbuYlBfMk.mp4",
    });

    expect(option).toEqual({
      name: "Vídeo",
      url: CDN_VIDEO,
      format: "mp4",
      quality: null,
      kind: "video",
      hasAudio: true,
    });
  });

  it("deduce la extensión de la propia URL si no hay filename", () => {
    const option = toVideoDownload({ videoUrl: CDN_IMAGE });

    expect(option.format).toBe("jpg");
  });
});

describe("toPhotoDownloads", () => {
  it("mapea tipo, extensión y miniatura de cada elemento", () => {
    const options = toPhotoDownloads([
      { type: "image", url: CDN_IMAGE, thumbnailUrl: null, filename: "photo_1.jpg" },
      { type: "image", url: `${CDN_IMAGE}2`, thumbnailUrl: CDN_THUMB, filename: "photo_2.png" },
      { type: "video", url: CDN_VIDEO_2, thumbnailUrl: null, filename: "clip.mp4" },
    ]);

    expect(options.map((option) => option.kind)).toEqual(["image", "image", "video"]);
    expect(options.map((option) => option.format)).toEqual(["jpg", "png", "mp4"]);
    expect(options[0]!.thumbnail).toBe(CDN_IMAGE);
    expect(options[1]!.thumbnail).toBe(CDN_THUMB);
    expect(options[2]!.thumbnail).toBeNull();
    // El audio del vídeo del carrusel no está verificado: no se etiqueta.
    expect(options[2]!.hasAudio).toBeUndefined();
  });

  it("ignora elementos sin URL o con host prohibido", () => {
    const options = toPhotoDownloads([
      { type: "image", url: "", thumbnailUrl: null },
      { type: "image", url: "https://evil.example.com/a.jpg", thumbnailUrl: null },
      { type: "image", url: CDN_IMAGE, thumbnailUrl: null },
    ]);

    expect(options).toHaveLength(1);
    expect(options[0]!.url).toBe(CDN_IMAGE);
  });
});

describe("cleanTitle", () => {
  it("colapsa los espacios y recorta el exceso", () => {
    expect(cleanTitle("  uno \n dos   tres  ")).toBe("uno dos tres");
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle(null)).toBeNull();

    const long = "x".repeat(200);
    const title = cleanTitle(long)!;
    expect(title).toHaveLength(160);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("searchAny (IGExport → LoveInsta)", () => {
  it("si IGExport resuelve, no toca LoveInsta", async () => {
    queue.push(reelsOk(), oembedOk());

    const result = await searchAny(REEL);

    expect(result.downloads[0]!.url).toBe(CDN_VIDEO);
    expect(calls.some((call) => call.url.includes("loveinsta.com"))).toBe(false);
  });

  it("si IGExport falla, resuelve con LoveInsta y avisa del cambio", async () => {
    const fallbacks: unknown[] = [];
    queue.push(
      // Primario: `invalid_url` → UnavailableError.
      jsonResponse({ ok: false, error: "invalid_url" }, 400),
      // Respaldo: `proxy.php` de LoveInsta con su job de render.
      liStartVideo(),
    );

    const result = await searchAny(REEL, { onFallback: (error) => fallbacks.push(error) });

    expect(calls[0]?.url).toContain("igexport.com");
    expect(calls[1]?.url).toContain("loveinsta.com/proxy.php");
    expect(result.videoId).toBe("DeMbuYlBfMk");
    expect(result.downloads[0]!.url).toBe(`/api/render?job=${encodeURIComponent(LI_JOB)}`);
    expect(result.downloads[0]!.hasAudio).toBe(true);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toBeInstanceOf(UnavailableError);
  });

  it("si IGExport agota sus reintentos, también cae en el respaldo", async () => {
    queue.push(
      htmlResponse("<!DOCTYPE html><html></html>", 502),
      htmlResponse("<!DOCTYPE html><html></html>", 502),
      htmlResponse("<!DOCTYPE html><html></html>", 502),
      liStartVideo(),
    );

    const result = await searchAny(REEL);

    expect(result.downloads).toHaveLength(1);
    expect(result.downloads[0]!.url).toContain("/api/render?job=");
    expect(calls).toHaveLength(4);
    expect(calls[3]?.url).toContain("loveinsta.com/proxy.php");
  });

  it("propaga los errores que no son de la casa", async () => {
    const error = await searchAny(REEL, {
      igexport: {
        searchVideo: async () => {
          throw new TypeError("boom");
        },
      } as never,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });
});
