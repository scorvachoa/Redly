/**
 * Fuente de X (Twitter) vía iLoveX (`ilovex.com`).
 *
 * Única fuente de X. El flujo, verificado empíricamente sin WAF, sin Turnstile
 * y sin claves de usuario, tiene dos pasos JSON contra el mismo endpoint:
 *
 * 1. `POST /proxy.php` con `url=<tweet>` →
 *    `{ api: { service: "X", status: "ok", title, description, userInfo,
 *    mediaStats, mediaItems: [...] } }`.
 * 2. Cada `mediaItems[]` de vídeo es un **trabajo de render** en el CDN del
 *    servicio (`https://s<nn>.worker<nn>.com/v5/video/<id>/<mediaId>/<res>`;
 *    misma familia de CDN que FSave/LoveInsta), no un archivo directo: hay
 *    que volver a `POST /proxy.php` con esa `mediaUrl` y sondear `progress`
 *    hasta `"Completed"`, que entrega el `fileUrl` final en
 *    `dl.iamworker.com` con `Content-Disposition: attachment`, soporte
 *    Range/206 y pistas `soun`+`mp4a`+`vide` verificadas (host ya en la
 *    allowlist de `lib/config.ts`).
 *
 * A diferencia de FSave no hay `mint`: el servicio no exige sesión ni token,
 * así que cualquier invocación puede resolver el tweet y sondear su job por
 * separado (stateless, verificado en proceso frío).
 *
 * Por eso cada opción de vídeo lleva la URL relativa
 * `/api/render?job=<mediaUrl>&source=ilovex`: el cliente la resuelve **al
 * pulsar** y después baja los bytes por `/api/download`. No se cachean
 * `fileUrl` (caducan y van firmados por IP).
 *
 * Limitaciones documentadas: sólo tweets públicos, sin perfiles, sin
 * transcripciones y con **una sola variante de calidad por vídeo** (el
 * servicio entrega la máxima, p. ej. 4K); las publicaciones de fotos sólo se
 * ofrecen si su URL directa supera la allowlist.
 */

import {
  ILOVEX_HEADERS,
  ILOVEX_PROXY_URL,
  ILOVEX_RENDER_ATTEMPTS,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  TRANSIENT_HTTP_STATUSES,
  isAllowedDownloadHost,
  urlHost,
} from "./config";
import { RequestError, UnavailableError } from "./exceptions";
import { isTweetUrl } from "./twitter-urls";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import { type DownloadOption, type MediaKind, type TikTokResult } from "./models";
import type { ProfilePage } from "./savetik";

// ---------------------------------------------------------------------------
// Tipos del servicio
// ---------------------------------------------------------------------------

/** Un elemento de `mediaItems[]` (vídeo en render o imagen directa). */
export interface IlovexMediaItem {
  type?: string | null;
  name?: string | null;
  mediaId?: string | null;
  /** URL del trabajo de render (vídeo) o del archivo directo (imagen). */
  mediaUrl?: string | null;
  /** Vista previa del vídeo en el CDN de X (`video.twimg.com`). */
  mediaPreviewUrl?: string | false | null;
  mediaThumbnail?: string | false | null;
  /** `"3840x2160"` (ancho×alto). */
  mediaRes?: string | false | null;
  /** `"4K"`, `"HD"`, `"FHD"`. */
  mediaQuality?: string | null;
  /** `"MP4"`, `"JPG"`. */
  mediaExtension?: string | null;
  mediaFileSize?: string | null;
  mediaDuration?: string | null;
  mediaTask?: string | null;
}

/** Objeto `api` de la respuesta de `proxy.php`. */
export interface IlovexApi {
  service?: string | null;
  status?: string | null;
  error?: string | null;
  message?: string | null;
  id?: string | null;
  title?: string | null;
  description?: string | null;
  previewUrl?: string | false | null;
  permanentLink?: string | null;
  userInfo?: {
    name?: string | null;
    username?: string | null;
    userId?: string | null;
    userAvatar?: string | null;
  } | null;
  mediaItems?: IlovexMediaItem[] | false | null;
}

/** Resultado de un trabajo de render completado. */
export interface IlovexRenderedFile {
  url: string;
  fileName: string | null;
}

// ---------------------------------------------------------------------------
// HTTP con reintentos
// ---------------------------------------------------------------------------

interface ProxyResponse {
  status: number;
  payload: Record<string, unknown> | null;
}

/**
 * `POST` de formulario a iLoveX.
 *
 * Los estados transitorios (429/5xx) se repiten con backoff; el resto se
 * devuelve tal cual (`status` + `payload` ya parseado) para que el llamador
 * decida.
 */
async function postForm(url: string, body: string): Promise<ProxyResponse> {
  let lastError: RequestError | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: headersInit(ILOVEX_HEADERS),
        body,
      });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`iLoveX respondió HTTP ${response.status}.`);
      } else {
        const text = await response.text();
        let payload: Record<string, unknown> | null = null;
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            payload = parsed as Record<string, unknown>;
          }
        } catch {
          payload = null;
        }
        return { status: response.status, payload };
      }
    } catch (error) {
      lastError = new RequestError(
        `Error de red contra iLoveX (${(error as Error)?.name ?? "Error"}).`,
      );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("iLoveX no respondió.");
}

/** Extrae un string limpio de un registro o del `api` del servicio. */
function str(
  record: Record<string, unknown> | IlovexApi | null,
  ...keys: string[]
): string | null {
  if (!record) return null;
  const source = record as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function proxyPost(url: string): Promise<ProxyResponse> {
  return postForm(ILOVEX_PROXY_URL, `url=${encodeURIComponent(url)}`);
}

/** `api` como objeto, o `null` si no viene (errores del servicio). */
function apiRecord(payload: Record<string, unknown> | null): IlovexApi | null {
  const api = payload?.api;
  if (!api || typeof api !== "object" || Array.isArray(api)) return null;
  return api as IlovexApi;
}

/** Convierte un error del `api` en la excepción de la casa. */
function serviceError(api: IlovexApi): Error {
  const message = str(api, "message");
  const code = (str(api, "error") ?? "").toUpperCase();
  if (code === "TWEET_UNAVAILABLE") {
    return new UnavailableError(
      message ?? "Ese tweet no está disponible (¿es privado o borrado?).",
    );
  }
  // Observado: tweet existente sin vídeo ni fotos → "Media unavailable."
  return new UnavailableError(
    message ?? "Ese tweet de X no tiene medios descargables.",
  );
}

/** Error HTTP sin `api` utilizable (cuerpo no JSON, 4xx inesperado…). */
function httpPayloadError(response: ProxyResponse): Error {
  const message = str(response.payload, "message", "error");
  if (response.payload === null) {
    return new RequestError("iLoveX devolvió una respuesta no JSON.");
  }
  if (response.status >= 400) {
    return new RequestError(message ?? `iLoveX respondió HTTP ${response.status}.`);
  }
  return new RequestError("Respuesta inesperada de iLoveX.");
}

function throwHttpError(response: ProxyResponse): never {
  throw httpPayloadError(response);
}

// ---------------------------------------------------------------------------
// Resolución de un tweet
// ---------------------------------------------------------------------------

/**
 * Resuelve la URL de un tweet y devuelve su `api`.
 *
 * El servicio distingue tres casos: `status: "ok"` con `mediaItems`, tweet
 * inexistente (`error: "TWEET_UNAVAILABLE"`) y tweet sin medios
 * (`message: "Media unavailable."` con `mediaItems: false`).
 */
export async function resolveIlovexTweet(url: string): Promise<IlovexApi> {
  const response = await proxyPost(url);
  const api = apiRecord(response.payload);
  if (!api) throwHttpError(response);

  const service = str(api, "service");
  if (service && service.toLowerCase() !== "x") {
    throw new UnavailableError("Esa URL no apunta a contenido de X (Twitter).");
  }
  const status = (str(api, "status") ?? "").toLowerCase();
  if (status === "error") throw serviceError(api);
  if (status !== "ok") throw new RequestError("Respuesta inesperada de iLoveX.");
  return api;
}

// ---------------------------------------------------------------------------
// Trabajos de render → archivo directo
// ---------------------------------------------------------------------------

/**
 * ¿Es una URL de trabajo (job) de iLoveX?
 *
 * Patrón observado (misma familia de CDN que FSave):
 * `https://s<nn>.worker<nn>.com/v5/video/<id>/<mediaId>/<calidad>`.
 */
export function isIlovexJobUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!/^[a-z0-9-]+\.worker\d+\.com$/i.test(parsed.hostname)) return false;
  return /^\/v5\/video\/[^/]+\/[^/]+\/[^/]+$/.test(parsed.pathname);
}

/**
 * Sondea un trabajo hasta `Completed` y devuelve el `fileUrl` directo.
 *
 * No hay sesión que renovar: cada invocación sondea con backoff (los tests
 * fijan `RETRY_BACKOFF_SECONDS=0`, así que el bucle es inmediato). El
 * `fileUrl` se valida contra la allowlist: si iLoveX cambiara de host, el
 * error es explícito en lugar de un 400 sorpresa en `/api/download`.
 */
export async function resolveIlovexRenderJob(jobUrl: string): Promise<IlovexRenderedFile> {
  if (!isIlovexJobUrl(jobUrl)) {
    throw new RequestError("La URL de trabajo no es válida.", { retryable: false });
  }

  for (let attempt = 0; attempt < ILOVEX_RENDER_ATTEMPTS; attempt++) {
    const response = await proxyPost(jobUrl);
    const api = apiRecord(response.payload);
    if (!api) throwHttpError(response);

    const progress = (str(api, "progress") ?? "").toLowerCase();
    if (progress === "completed" || (str(api, "percent") ?? "").toLowerCase() === "completed") {
      const fileUrl = str(api, "fileUrl");
      if (!fileUrl) {
        throw new RequestError("iLoveX terminó el trabajo sin entregar el archivo.");
      }
      const host = urlHost(fileUrl);
      if (!isAllowedDownloadHost(host)) {
        throw new RequestError(`Host de descarga no permitido (${host ?? "desconocido"}).`, {
          retryable: false,
        });
      }
      return { url: fileUrl, fileName: str(api, "fileName") };
    }

    const status = (str(api, "status") ?? "").toLowerCase();
    if (status === "error") throw serviceError(api);
    if (attempt < ILOVEX_RENDER_ATTEMPTS - 1) await sleep(RETRY_BACKOFF_SECONDS);
  }
  throw new UnavailableError(
    "iLoveX tardó demasiado en preparar el archivo. Vuelve a intentarlo.",
  );
}

// ---------------------------------------------------------------------------
// Modelo canónico
// ---------------------------------------------------------------------------

/** Altura convencional de una calidad: el lado corto (`3840x2160` → 2160). */
function qualityHeight(mediaRes: string | false | null | undefined): number | null {
  if (!mediaRes || typeof mediaRes !== "string") return null;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(mediaRes.trim());
  if (!match) return null;
  return Math.min(Number(match[1]), Number(match[2]));
}

/** Altura numérica de una calidad (`"2160p"` → 2160). Sin dato: -1. */
function heightOf(option: DownloadOption): number {
  const match = /(\d{3,4})\s*p/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : -1;
}

/** ¿Es este `mediaItem` un vídeo (por tipo o por el patrón de su job)? */
function isVideoItem(item: IlovexMediaItem, jobUrl: string | null): boolean {
  if (typeof item.type === "string" && item.type.trim()) {
    return item.type.trim().toLowerCase() === "video";
  }
  return jobUrl ? isIlovexJobUrl(jobUrl) : false;
}

/**
 * Convierte los `mediaItems` del servicio en opciones del modelo canónico.
 *
 * Los vídeos no son descargables directamente: llevan la URL relativa
 * `/api/render?job=…&source=ilovex` (resolución perezosa al pulsar). Las
 * imágenes sí llevan URL directa, pero sólo si su host supera la allowlist
 * (los hosts observados pertenecen a `dl.iamworker.com`; si iLoveX cambiara
 * de CDN, el item se omite en lugar de prometer una descarga que
 * `/api/download` rechazaría). Orden: vídeos por altura descendente y, detrás,
 * las imágenes en su orden original — mismo criterio estable que `toDownloads`
 * de FSave.
 */
export function toDownloads(api: IlovexApi): DownloadOption[] {
  const raw = api.mediaItems;
  if (!Array.isArray(raw)) return [];

  const videos: DownloadOption[] = [];
  const images: DownloadOption[] = [];

  for (const item of raw) {
    const mediaUrl = typeof item.mediaUrl === "string" ? item.mediaUrl.trim() : null;
    if (!mediaUrl) continue;

    const jobUrl = isIlovexJobUrl(mediaUrl) ? mediaUrl : null;
    const video = isVideoItem(item, jobUrl);

    if (video) {
      if (!jobUrl) continue;
      const height = qualityHeight(item.mediaRes);
      const quality = height ? `${height}p` : null;
      const extension =
        (typeof item.mediaExtension === "string" && item.mediaExtension.trim()
          ? item.mediaExtension.trim()
          : "mp4"
        ).toLowerCase() || null;
      videos.push({
        name: `Vídeo${quality ? ` ${quality}` : ""}`,
        url: `/api/render?job=${encodeURIComponent(jobUrl)}&source=ilovex`,
        format: extension,
        quality,
        kind: "video",
        // Verificado: el MP4 final de iLoveX trae átomos `soun` + `mp4a` + `vide`.
        hasAudio: true,
      });
      continue;
    }

    // Imagen (o tipo desconocido con URL directa): sólo si el host está permitido.
    if (!isAllowedDownloadHost(urlHost(mediaUrl))) continue;
    const kind: MediaKind = "image";
    const extension =
      (typeof item.mediaExtension === "string" && item.mediaExtension.trim()
        ? item.mediaExtension.trim()
        : "jpg"
      ).toLowerCase() || null;
    const thumbnail =
      typeof item.mediaThumbnail === "string" && item.mediaThumbnail.trim()
        ? item.mediaThumbnail.trim()
        : mediaUrl;
    images.push({
      name: "Foto",
      url: mediaUrl,
      format: extension,
      quality: null,
      kind,
      thumbnail,
    });
  }

  videos.sort((a, b) => heightOf(b) - heightOf(a));
  return [...videos, ...images];
}

/** Título presentable: espacios colapsados y longitud razonable para la UI. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat || flat === "N/A") return null;
  return flat.length > 160 ? `${flat.slice(0, 159).trimEnd()}…` : flat;
}

// ---------------------------------------------------------------------------
// Fuente
// ---------------------------------------------------------------------------

export class IlovexSource {
  /** Identificador estable del contrato `ContentSource` (`lib/sources.ts`). */
  readonly id = "ilovex";
  /** Plataformas que esta fuente sabe servir. */
  readonly platforms = ["twitter"] as const;
  /** Sólo tweets sueltos: iLoveX no ofrece listados de páginas. */
  readonly supportsProfiles = false;

  /** Resuelve un tweet de X con vídeo o fotos (URLs públicas). */
  async searchVideo(url: string): Promise<TikTokResult> {
    const target = url.trim();
    if (!isTweetUrl(target)) {
      throw new RequestError("Esa URL no parece un tweet de X (Twitter).", {
        retryable: false,
      });
    }

    const api = await resolveIlovexTweet(target);
    const downloads = toDownloads(api);
    if (downloads.length === 0) {
      throw new UnavailableError("No se encontraron opciones de descarga.");
    }

    const raw = Array.isArray(api.mediaItems) ? api.mediaItems : [];
    const firstVideo = raw.find((item) => isIlovexJobUrl(item.mediaUrl ?? ""));
    const firstImage = raw.find((item) => item.type?.toLowerCase() === "image");
    const preview = firstVideo?.mediaPreviewUrl;
    const thumbnail =
      (typeof preview === "string" && preview.trim() ? preview.trim() : null) ??
      (typeof firstImage?.mediaThumbnail === "string" && firstImage.mediaThumbnail.trim()
        ? firstImage.mediaThumbnail.trim()
        : null);

    const username = str(api.userInfo ?? null, "username");
    const title =
      cleanTitle(api.description) ??
      cleanTitle(api.title) ??
      (username ? `@${username}` : null) ??
      `X ${str(api, "id") ?? ""}`.trim();

    return {
      videoId: str(api, "id"),
      title,
      thumbnail,
      downloads,
    };
  }

  /** iLoveX no ofrece listados de páginas: se rechaza sin tocar la red. */
  async listProfilePage(
    _url: string,
    _cursor?: string | null,
    _page?: number,
    _limit?: number,
  ): Promise<ProfilePage> {
    throw new RequestError("Las páginas de X (Twitter) no están soportadas.", {
      retryable: false,
    });
  }
}
