/**
 * Fuente de Threads vía SaveThreads (`savethreads.com`).
 *
 * Única fuente de Threads. El flujo, verificado empíricamente sin WAF, sin
 * Turnstile y sin claves de usuario, tiene dos pasos JSON contra el mismo
 * endpoint:
 *
 * 1. `POST /proxy.php` con `url=<post de Threads>` →
 *    `{ api: { service: "Threads", status: "ok", description, userInfo,
 *    mediaItems: [...] } }`.
 * 2. Cada `mediaItems[]` de vídeo es un **trabajo de render** en el CDN del
 *    servicio (`https://s<nn>.worker<nn>.com/v5/video/<id>/<mediaId>/<res>`;
 *    misma familia de CDN que FSave/LoveInsta/iLoveX), no un archivo directo:
 *    hay que volver a `POST /proxy.php` con esa `mediaUrl` y sondear
 *    `percent` hasta `"Completed"`, que entrega el `fileUrl` final en
 *    `dl.iamworker.com` con `Content-Disposition: attachment` y soporte
 *    Range/206 (host ya en la allowlist de `lib/config.ts`). Las fotos sí
 *    traen URL directa en `dl.iamworker.com` desde el primer resolve.
 *
 * A diferencia de FSave no hay mint: el servicio no exige sesión ni token,
 * así que cualquier invocación puede resolver el post y sondear su job por
 * separado (stateless, verificado en proceso frío).
 *
 * Por eso cada opción de vídeo lleva la URL relativa
 * `/api/render?job=<mediaUrl>&source=savethreads`: el cliente la resuelve **al
 * pulsar** y después baja los bytes por `/api/download`. No se cachean
 * `fileUrl` (caducan y van firmados; la FAQ del servicio habla de ~2 horas).
 *
 * Limitaciones documentadas: sólo publicaciones públicas, sin perfiles, sin
 * transcripciones y con **una sola variante de calidad por vídeo** (el
 * servicio entrega la máxima que ofrece Threads, p. ej. 720p); los carruseles
 * se ofrecen elemento a elemento (vídeos y fotos por separado).
 */

import {
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  SAVETHREADS_HEADERS,
  SAVETHREADS_PROXY_URL,
  SAVETHREADS_RENDER_ATTEMPTS,
  TRANSIENT_HTTP_STATUSES,
  isAllowedDownloadHost,
  urlHost,
} from "./config";
import { RequestError, UnavailableError } from "./exceptions";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import { type DownloadOption, type MediaKind, type TikTokResult } from "./models";
import type { ProfilePage } from "./savetik";
import { extractThreadsPostId, isThreadsPostUrl } from "./threads-urls";

// ---------------------------------------------------------------------------
// Tipos del servicio
// ---------------------------------------------------------------------------

/** Un elemento de `mediaItems[]` (vídeo en render o imagen directa). */
export interface SavethreadsMediaItem {
  type?: string | null;
  mediaId?: string | null;
  /** URL del trabajo de render (vídeo) o del archivo directo (imagen). */
  mediaUrl?: string | null;
  /** Vista previa del vídeo en el CDN de Instagram (`cdninstagram.com`). */
  mediaPreviewUrl?: string | false | null;
  mediaThumbnail?: string | false | null;
  /** `"720x958"` (ancho×alto). */
  mediaRes?: string | false | null;
  /** `"HD"`, `"Original"`. */
  mediaQuality?: string | null;
  /** `"MP4"`, `"JPG"`. */
  mediaExtension?: string | null;
  mediaFileSize?: string | null;
}

/** Objeto `api` de la respuesta de `proxy.php`. */
export interface SavethreadsApi {
  service?: string | null;
  status?: string | null;
  error?: string | null;
  message?: string | null;
  description?: string | null;
  userInfo?: {
    name?: string | null;
    username?: string | null;
    userId?: string | null;
    userAvatar?: string | null;
    isVerified?: boolean | null;
  } | null;
  mediaItems?: SavethreadsMediaItem[] | false | null;
}

/** Resultado de un trabajo de render completado. */
export interface SavethreadsRenderedFile {
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
 * `POST` de formulario a SaveThreads.
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
        headers: headersInit(SAVETHREADS_HEADERS),
        body,
      });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`SaveThreads respondió HTTP ${response.status}.`);
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
        `Error de red contra SaveThreads (${(error as Error)?.name ?? "Error"}).`,
      );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("SaveThreads no respondió.");
}

/** Extrae un string limpio de un registro o del `api` del servicio. */
function str(
  record: Record<string, unknown> | SavethreadsApi | null,
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
  return postForm(SAVETHREADS_PROXY_URL, `url=${encodeURIComponent(url)}`);
}

/** `api` como objeto, o `null` si no viene (errores del servicio). */
function apiRecord(payload: Record<string, unknown> | null): SavethreadsApi | null {
  const api = payload?.api;
  if (!api || typeof api !== "object" || Array.isArray(api)) return null;
  return api as SavethreadsApi;
}

/** Convierte un error del `api` en la excepción de la casa. */
function serviceError(api: SavethreadsApi): Error {
  const message = str(api, "message");
  const code = (str(api, "error") ?? "").toUpperCase();
  if (code === "POST_UNAVAILABLE") {
    return new UnavailableError(
      message ?? "Esa publicación de Threads no está disponible (¿borrada o privada?).",
    );
  }
  return new UnavailableError(
    message ?? "Esa publicación de Threads no tiene medios descargables.",
  );
}

/** Error HTTP sin `api` utilizable (cuerpo no JSON, 4xx inesperado…). */
function httpPayloadError(response: ProxyResponse): Error {
  const message = str(response.payload, "message", "error");
  if (response.payload === null) {
    return new RequestError("SaveThreads devolvió una respuesta no JSON.");
  }
  if (response.status >= 400) {
    return new RequestError(message ?? `SaveThreads respondió HTTP ${response.status}.`);
  }
  return new RequestError("Respuesta inesperada de SaveThreads.");
}

function throwHttpError(response: ProxyResponse): never {
  throw httpPayloadError(response);
}

// ---------------------------------------------------------------------------
// Resolución de una publicación
// ---------------------------------------------------------------------------

/**
 * Resuelve la URL de una publicación de Threads y devuelve su `api`.
 *
 * El servicio distingue tres casos: `status: "ok"` con `mediaItems`, post
 * inexistente (`error: "POST_UNAVAILABLE"`) y maintenance (`MAINTENANCE_MODE`).
 */
export async function resolveSavethreadsPost(url: string): Promise<SavethreadsApi> {
  const response = await proxyPost(url);
  const api = apiRecord(response.payload);
  if (!api) throwHttpError(response);

  const service = str(api, "service");
  if (service && service.toLowerCase() !== "threads") {
    throw new UnavailableError("Esa URL no apunta a contenido de Threads.");
  }
  const status = (str(api, "status") ?? "").toLowerCase();
  if (status === "error") throw serviceError(api);
  if (status !== "ok") throw new RequestError("Respuesta inesperada de SaveThreads.");
  return api;
}

// ---------------------------------------------------------------------------
// Trabajos de render → archivo directo
// ---------------------------------------------------------------------------

/**
 * ¿Es una URL de trabajo (job) de SaveThreads?
 *
 * Patrón observado (misma familia de CDN que FSave/LoveInsta/iLoveX):
 * `https://s<nn>.worker<nn>.com/v5/video/<id>/<mediaId>/<calidad>`.
 */
export function isSavethreadsJobUrl(url: string | null | undefined): boolean {
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
 * `fileUrl` se valida contra la allowlist: si SaveThreads cambiara de host,
 * el error es explícito en lugar de un 400 sorpresa en `/api/download`.
 */
export async function resolveSavethreadsRenderJob(
  jobUrl: string,
): Promise<SavethreadsRenderedFile> {
  if (!isSavethreadsJobUrl(jobUrl)) {
    throw new RequestError("La URL de trabajo no es válida.", { retryable: false });
  }

  for (let attempt = 0; attempt < SAVETHREADS_RENDER_ATTEMPTS; attempt++) {
    const response = await proxyPost(jobUrl);
    const api = apiRecord(response.payload);
    if (!api) throwHttpError(response);

    const progress = (str(api, "progress") ?? str(api, "percent") ?? "").toLowerCase();
    const status = (str(api, "status") ?? "").toLowerCase();
    if (progress === "completed" || status === "completed") {
      const fileUrl = str(api, "fileUrl");
      if (!fileUrl) {
        throw new RequestError("SaveThreads terminó el trabajo sin entregar el archivo.");
      }
      const host = urlHost(fileUrl);
      if (!isAllowedDownloadHost(host)) {
        throw new RequestError(`Host de descarga no permitido (${host ?? "desconocido"}).`, {
          retryable: false,
        });
      }
      return { url: fileUrl, fileName: str(api, "fileName") };
    }

    if (status === "error" || status === "failed") throw serviceError(api);
    if (attempt < SAVETHREADS_RENDER_ATTEMPTS - 1) await sleep(RETRY_BACKOFF_SECONDS);
  }
  throw new UnavailableError(
    "SaveThreads tardó demasiado en preparar el archivo. Vuelve a intentarlo.",
  );
}

// ---------------------------------------------------------------------------
// Modelo canónico
// ---------------------------------------------------------------------------

/** Altura convencional de una calidad: el lado corto (`720x958` → 720). */
function qualityHeight(mediaRes: string | false | null | undefined): number | null {
  if (!mediaRes || typeof mediaRes !== "string") return null;
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(mediaRes.trim());
  if (!match) return null;
  return Math.min(Number(match[1]), Number(match[2]));
}

/** Altura numérica de una calidad (`"720p"` → 720). Sin dato: -1. */
function heightOf(option: DownloadOption): number {
  const match = /(\d{2,5})\s*p/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : -1;
}

/** ¿Es este `mediaItem` un vídeo (por tipo o por el patrón de su job)? */
function isVideoItem(item: SavethreadsMediaItem, jobUrl: string | null): boolean {
  if (typeof item.type === "string" && item.type.trim()) {
    return item.type.trim().toLowerCase() === "video";
  }
  return jobUrl ? isSavethreadsJobUrl(jobUrl) : false;
}

/**
 * Convierte los `mediaItems` del servicio en opciones del modelo canónico.
 *
 * Los vídeos no son descargables directamente: llevan la URL relativa
 * `/api/render?job=…&source=savethreads` (resolución perezosa al pulsar). Las
 * imágenes sí llevan URL directa, pero sólo si su host supera la allowlist
 * (los hosts observados pertenecen a `dl.iamworker.com`; si SaveThreads
 * cambiara de CDN, el item se omite en lugar de prometer una descarga que
 * `/api/download` rechazaría). Orden: vídeos por altura descendente y, detrás,
 * las imágenes en su orden original — mismo criterio estable que `toDownloads`
 * de iLoveX.
 */
export function toDownloads(api: SavethreadsApi): DownloadOption[] {
  const raw = api.mediaItems;
  if (!Array.isArray(raw)) return [];

  const videos: DownloadOption[] = [];
  const images: DownloadOption[] = [];

  for (const item of raw) {
    const mediaUrl = typeof item.mediaUrl === "string" ? item.mediaUrl.trim() : null;
    if (!mediaUrl) continue;

    const jobUrl = isSavethreadsJobUrl(mediaUrl) ? mediaUrl : null;
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
        url: `/api/render?job=${encodeURIComponent(jobUrl)}&source=savethreads`,
        format: extension,
        quality,
        kind: "video",
        // El MP4 final del clúster worker trae audio embebido (misma familia
        // de CDN que FSave/LoveInsta/iLoveX, verificado con átomos soun+mp4a).
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

export class SavethreadsSource {
  /** Identificador estable del contrato `ContentSource` (`lib/sources.ts`). */
  readonly id = "savethreads";
  /** Plataformas que esta fuente sabe servir. */
  readonly platforms = ["threads"] as const;
  /** Sólo publicaciones sueltas: SaveThreads no ofrece listados de páginas. */
  readonly supportsProfiles = false;

  /** Resuelve una publicación de Threads con vídeo o fotos (URLs públicas). */
  async searchVideo(url: string): Promise<TikTokResult> {
    const target = url.trim();
    if (!isThreadsPostUrl(target)) {
      throw new RequestError("Esa URL no parece una publicación de Threads.", {
        retryable: false,
      });
    }

    const api = await resolveSavethreadsPost(target);
    const downloads = toDownloads(api);
    if (downloads.length === 0) {
      throw new UnavailableError("No se encontraron opciones de descarga.");
    }

    const raw = Array.isArray(api.mediaItems) ? api.mediaItems : [];
    const firstVideo = raw.find((item) => isSavethreadsJobUrl(item.mediaUrl ?? ""));
    const firstImage = raw.find((item) => item.type?.toLowerCase() === "image");
    const preview = firstVideo?.mediaPreviewUrl;
    const thumbnail =
      (typeof preview === "string" && preview.trim() ? preview.trim() : null) ??
      (typeof firstImage?.mediaThumbnail === "string" && firstImage.mediaThumbnail.trim()
        ? firstImage.mediaThumbnail.trim()
        : null);

    const username = str(api.userInfo ?? null, "username");
    const title =
      cleanTitle(api.description) ?? (username ? `@${username}` : null) ?? "Publicación de Threads";

    return {
      videoId: extractThreadsPostId(target),
      title,
      thumbnail,
      downloads,
    };
  }

  /** SaveThreads no ofrece listados de páginas: se rechaza sin tocar la red. */
  async listProfilePage(
    _url: string,
    _cursor?: string | null,
    _page?: number,
    _limit?: number,
  ): Promise<ProfilePage> {
    throw new RequestError("Las páginas de perfil de Threads no están soportadas.", {
      retryable: false,
    });
  }
}
