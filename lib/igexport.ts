/**
 * Fuente principal de Instagram vía IGExport (`igexport.com`).
 *
 * Fuente primaria de Instagram (el respaldo, LoveInsta, está en
 * `lib/loveinsta.ts` y se encadena con `searchAny` al final de este fichero).
 * El flujo, verificado empíricamente sin WAF y sin
 * claves de usuario, son dos endpoints JSON del propio origen:
 *
 * 1. `GET /api/ig-reels/?url=<publicación>&videoOnly=1` →
 *    `{ ok, source, media: { videoUrl, thumbnailUrl, filename } }` con el MP4
 *    directo en el CDN de Instagram (`scontent-<borde>-<n>.cdninstagram.com`).
 *    Devuelve 404 `not_found` cuando la publicación no tiene vídeo: en ese caso
 *    se cae al paso 2.
 * 2. `GET /api/ig-photo/?url=<publicación>` →
 *    `{ ok, media: { shortcode, items: [{ type, url, thumbnailUrl, filename }] } }`
 *    con los elementos de una publicación de fotos o carrusel.
 *
 * El archivo vive directamente en el CDN de Instagram (Range/206 y audio
 * verificados; sin `Content-Disposition`, que lo pone `/api/download`), así que
 * las opciones llevan la URL **directa**: no hay fase de render como en FSave.
 * La URL va firmada y caduca en ~2 días, suficiente porque se consume al
 * momento de analizar.
 *
 * Título y autor se piden aparte al oEmbed público de Instagram
 * (`GET /api/v1/oembed/`) en modo **best-effort**: si Instagram lo rechaza, el
 * título cae al autor o al código de la publicación.
 *
 * Limitaciones documentadas: sólo contenido público, sin listados de perfil
 * ni historias (`supportsProfiles: false`) y sin transcripciones; el servicio
 * puede devolver 429/503 cuando Instagram limita su tasa (reintentos con
 * backoff).
 */

import {
  IGEXPORT_HEADERS,
  IGEXPORT_PHOTO_URL,
  IGEXPORT_REELS_URL,
  INSTAGRAM_OEMBED_HEADERS,
  INSTAGRAM_OEMBED_URL,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  TRANSIENT_HTTP_STATUSES,
  isAllowedDownloadHost,
  urlHost,
} from "./config";
import { RedlyError, RequestError, UnavailableError } from "./exceptions";
import { extractInstagramPostId } from "./instagram-urls";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import { LoveInstaSource } from "./loveinsta";
import type { DownloadOption, MediaKind, TikTokResult } from "./models";
import type { ProfilePage } from "./savetik";

// ---------------------------------------------------------------------------
// Tipos del servicio
// ---------------------------------------------------------------------------

/** `media` de la respuesta de `/api/ig-reels/`. */
export interface IgexportReelsMedia {
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  filename?: string | null;
}

/** Un elemento de la respuesta de `/api/ig-photo/` (foto o vídeo del carrusel). */
export interface IgexportPhotoItem {
  type?: string | null;
  url?: string | null;
  thumbnailUrl?: string | null;
  filename?: string | null;
}

/** Metadatos del oEmbed público de Instagram. */
export interface InstagramOEmbed {
  title?: string | null;
  author_name?: string | null;
  thumbnail_url?: string | null;
}

interface IgResponse {
  status: number;
  payload: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// HTTP con reintentos
// ---------------------------------------------------------------------------

/** Extrae un string limpio de un registro del servicio. */
function str(record: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Objeto anidado, o `null` si no lo es. */
function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * `GET` de JSON contra IGExport.
 *
 * Los estados transitorios (429/5xx) se repiten con backoff; el resto se
 * devuelve tal cual (`status` + `payload` ya parseado) para que el llamador
 * decida: los 400/404 del servicio traen JSON con su `error`.
 */
async function igGet(url: string): Promise<IgResponse> {
  let lastError: RequestError | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, { headers: headersInit(IGEXPORT_HEADERS) });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`IGExport respondió HTTP ${response.status}.`);
      } else {
        const text = await response.text();
        let payload: Record<string, unknown> | null = null;
        try {
          payload = record(JSON.parse(text));
        } catch {
          payload = null;
        }
        return { status: response.status, payload };
      }
    } catch (error) {
      lastError = new RequestError(
        `Error de red contra IGExport (${(error as Error)?.name ?? "Error"}).`,
      );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("IGExport no respondió.");
}

// ---------------------------------------------------------------------------
// Mapeo de errores
// ---------------------------------------------------------------------------

/** Convierte una respuesta sin datos utilizables en la excepción de la casa. */
function serviceError(status: number, payload: Record<string, unknown> | null): Error {
  const code = str(payload, "error");
  if (code === "invalid_url" || status === 400) {
    return new UnavailableError("Esa URL no apunta a una publicación de Instagram.");
  }
  if (payload === null) {
    // Cuerpo no JSON (p. ej. un 502 HTML observado en `ig-posts`): reintentable.
    return new RequestError(`IGExport devolvió una respuesta no JSON (HTTP ${status}).`);
  }
  if (code === "not_found" || status === 404) {
    return new UnavailableError(
      "Ese contenido de Instagram no está disponible (¿es privado o borrado?).",
    );
  }
  return new RequestError(str(payload, "message") ?? `IGExport respondió HTTP ${status}.`);
}

// ---------------------------------------------------------------------------
// Resolución de una publicación
// ---------------------------------------------------------------------------

/**
 * Intenta resolver el MP4 de la publicación.
 *
 * Devuelve `null` cuando el servicio responde 404 `not_found` (la publicación
 * no tiene vídeo): en ese caso el llamador prueba con `/api/ig-photo/`.
 */
export async function fetchReelsMedia(url: string): Promise<IgexportReelsMedia | null> {
  const response = await igGet(
    `${IGEXPORT_REELS_URL}?url=${encodeURIComponent(url)}&videoOnly=1`,
  );
  if (response.status === 404) return null;
  const media = record(response.payload?.media);
  const videoUrl = str(media, "videoUrl");
  if (response.status === 200 && videoUrl) {
    return {
      videoUrl,
      thumbnailUrl: str(media, "thumbnailUrl"),
      filename: str(media, "filename"),
    };
  }
  throw serviceError(response.status, response.payload);
}

/** Devuelve los elementos de una publicación de fotos o carrusel. */
export async function fetchPhotoItems(url: string): Promise<IgexportPhotoItem[]> {
  const response = await igGet(`${IGEXPORT_PHOTO_URL}?url=${encodeURIComponent(url)}`);
  if (response.status !== 200) throw serviceError(response.status, response.payload);
  const raw = record(response.payload?.media)?.items;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is IgexportPhotoItem => record(item) !== null);
}

/**
 * Metadatos del oEmbed público de Instagram (título/autor/miniatura).
 *
 * Best-effort: un solo intento y `null` ante cualquier fallo; el llamador se
 * conforma con el autor o el código de la publicación.
 */
export async function fetchOEmbed(url: string): Promise<InstagramOEmbed | null> {
  try {
    const response = await fetchWithTimeout(
      `${INSTAGRAM_OEMBED_URL}?url=${encodeURIComponent(url)}&format=json`,
      { headers: headersInit(INSTAGRAM_OEMBED_HEADERS) },
    );
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    return record(parsed) as InstagramOEmbed | null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Modelo canónico
// ---------------------------------------------------------------------------

const MEDIA_EXTENSION_PATTERN = /\.(mp4|m4v|m4a|mov|webm|jpe?g|png|webp|heic)(?:$|[?#])/i;

/** Extensión de archivo deducida del nombre o la URL, con su valor por defecto. */
function extensionFrom(nameOrUrl: string | null | undefined, fallback: string): string {
  const match = nameOrUrl ? MEDIA_EXTENSION_PATTERN.exec(nameOrUrl) : null;
  return match ? match[1].toLowerCase() : fallback;
}

/** Opción de descarga del MP4 directo del CDN de Instagram. */
export function toVideoDownload(media: IgexportReelsMedia): DownloadOption {
  const videoUrl = media.videoUrl ?? "";
  return {
    name: "Vídeo",
    url: videoUrl,
    format: extensionFrom(media.filename ?? videoUrl, "mp4"),
    quality: null,
    kind: "video",
    // Verificado: el MP4 de `scontent-*.cdninstagram.com` trae `soun` + `mp4a`.
    hasAudio: true,
  };
}

/**
 * Opciones de descarga de los elementos de una publicación de fotos.
 *
 * Se descartan los elementos cuyo host no está en la allowlist: si el servicio
 * cambiara de CDN, el error es explícito en lugar de un 400 sorpresa en
 * `/api/download`.
 */
export function toPhotoDownloads(items: IgexportPhotoItem[]): DownloadOption[] {
  const options: DownloadOption[] = [];
  for (const item of items) {
    const itemUrl = typeof item.url === "string" ? item.url.trim() : "";
    if (!itemUrl || !isAllowedDownloadHost(urlHost(itemUrl))) continue;

    const kind: MediaKind =
      (item.type ?? "").trim().toLowerCase() === "video" ? "video" : "image";
    const option: DownloadOption = {
      name: kind === "video" ? "Vídeo" : "Foto",
      url: itemUrl,
      format: extensionFrom(item.filename ?? itemUrl, kind === "video" ? "mp4" : "jpeg"),
      quality: null,
      kind,
      thumbnail:
        typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim()
          ? item.thumbnailUrl.trim()
          : kind === "image"
            ? itemUrl
            : null,
    };
    // El audio del vídeo incrustado en un carrusel no está verificado: no se
    // inventa la etiqueta (la UI no muestra nada si `hasAudio` viene ausente).
    options.push(option);
  }
  return options;
}

/** Título presentable: espacios colapsados y longitud razonable para la UI. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > 160 ? `${flat.slice(0, 159).trimEnd()}…` : flat;
}

// ---------------------------------------------------------------------------
// Fuente
// ---------------------------------------------------------------------------

export class IgexportSource {
  /** Identificador estable del contrato `ContentSource` (`lib/sources.ts`). */
  readonly id = "igexport";
  /** Plataformas que esta fuente sabe servir. */
  readonly platforms = ["instagram"] as const;
  /** Sólo publicaciones sueltas: IGExport no ofrece listados verificados. */
  readonly supportsProfiles = false;

  /** Resuelve una publicación de Instagram con vídeo o fotos (URLs públicas). */
  async searchVideo(url: string): Promise<TikTokResult> {
    const target = url.trim();
    const shortcode = extractInstagramPostId(target);
    if (!shortcode) {
      throw new RequestError("Esa URL no parece una publicación de Instagram.", {
        retryable: false,
      });
    }

    const reels = await fetchReelsMedia(target);
    let downloads: DownloadOption[];
    let thumbnail: string | null = null;

    if (reels) {
      const host = reels.videoUrl ? urlHost(reels.videoUrl) : null;
      if (!isAllowedDownloadHost(host)) {
        throw new RequestError(`Host de descarga no permitido (${host ?? "desconocido"}).`, {
          retryable: false,
        });
      }
      downloads = [toVideoDownload(reels)];
      thumbnail = reels.thumbnailUrl ?? null;
    } else {
      const items = await fetchPhotoItems(target);
      downloads = toPhotoDownloads(items);
      if (downloads.length === 0) {
        throw new UnavailableError("No se encontraron opciones de descarga.");
      }
      thumbnail = downloads[0]?.thumbnail ?? null;
    }

    // Metadatos best-effort: nunca impiden que la publicación se resuelva.
    const meta = await fetchOEmbed(target);
    const title =
      cleanTitle(meta?.title) ??
      (meta?.author_name ? `@${meta.author_name.trim()}` : null) ??
      `Instagram ${shortcode}`;

    return {
      videoId: shortcode,
      title,
      thumbnail: thumbnail ?? meta?.thumbnail_url ?? null,
      downloads,
    };
  }

  /** IGExport no ofrece listados de páginas: se rechaza sin tocar la red. */
  async listProfilePage(
    _url: string,
    _cursor?: string | null,
    _page?: number,
    _limit?: number,
  ): Promise<ProfilePage> {
    throw new RequestError("Las páginas de Instagram no están soportadas.", {
      retryable: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Fachada: una sola publicación con fallback a LoveInsta
// ---------------------------------------------------------------------------

/**
 * Resuelve una publicación de Instagram: intenta IGExport y, si falla con un
 * error de la casa, LoveInsta.
 *
 * `onFallback` se invoca cuando se produce el cambio de fuente (útil para
 * debug/UI); recibe el error que provocó el fallback. Espejo exacto de
 * `searchAny` de `lib/savetik.ts` (SavTikPro → TikVid).
 */
export async function searchAny(
  url: string,
  options: {
    igexport?: IgexportSource;
    loveinsta?: LoveInstaSource;
    onFallback?: (error: RedlyError) => void;
  } = {},
): Promise<TikTokResult> {
  const source = options.igexport ?? new IgexportSource();
  try {
    return await source.searchVideo(url);
  } catch (error) {
    if (!(error instanceof RedlyError)) throw error;
    options.onFallback?.(error);
    const fallback = options.loveinsta ?? new LoveInstaSource();
    return fallback.searchVideo(url);
  }
}
