/**
 * Fuente de Instagram de respaldo vía LoveInsta (`loveinsta.com`).
 *
 * Actúa cuando IGExport (fuente primaria) falla con un error de la casa; la
 * cadena está en `searchAny` de `lib/igexport.ts`, al estilo de SavTik → TikVid.
 *
 * El flujo, verificado empíricamente sin WAF, sin Turnstile y sin claves —
 * incluso con un `POST` sin headers de navegador — es un único paso:
 *
 * 1. `POST /proxy.php` con `url=<publicación>` →
 *    `{ api: { service: "Instagram", status: "ok", title, imagePreviewUrl,
 *    mediaItems: [...] } }`.
 *
 * Cada `mediaItems[]` es o bien un **trabajo de render** de vídeo
 * (`https://s<nn>.worker<nn>.com/v5/video/<id>/<hash>/<calidad>`, el mismo
 * clúster que FSave) o bien la **URL directa** de una foto en
 * `dl.iamworker.com`. Por eso:
 *
 * - Los vídeos llevan la opción relativa `/api/render?job=<mediaUrl>` y se
 *   resuelven al pulsar (el `/api/render` existente entrega el `fileUrl` en
 *   `dl.iamworker.com`, con `Content-Disposition: attachment` y Range/206;
 *   resolución verificada con el mint de FSave sobre jobs de LoveInsta).
 * - Las fotos llevan su URL directa, validada contra `ALLOWED_DOWNLOAD_HOSTS`
 *   (host observado: `dl.iamworker.com`, `image/jpeg`, `attachment`).
 *
 * La resolución es stateless: no se cachea nada y el sondeo del job ocurre en
 * el propio `/api/render`. El MP4 de los jobs trae pistas `soun` + `mp4a`
 * (audio verificado), y la resolución (`1080p`, `720p`…) se lee del último
 * segmento de la URL del trabajo.
 *
 * Errores observados (todos JSON): `400 INVALID_URL`/`WRONG_SERVICE` y
 * `200 api.status:"error"` (`MEDIA_UNAVAILABLE`, `VIDEO_NOT_FOUND`) →
 * contenido no disponible; cuerpo no JSON o 5xx → error reintentable.
 *
 * Limitaciones documentadas: sólo publicaciones públicas (sin listados de
 * perfil ni historias), fotos con token de URL firmada que conviene consumir
 * al momento, y sin transcripciones.
 */

import {
  LOVEINSTA_HEADERS,
  LOVEINSTA_PROXY_URL,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  TRANSIENT_HTTP_STATUSES,
  isAllowedDownloadHost,
  urlHost,
} from "./config";
import { RequestError, UnavailableError } from "./exceptions";
import { extractInstagramPostId } from "./instagram-urls";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import type { DownloadOption, TikTokResult } from "./models";
import type { ProfilePage } from "./savetik";

// ---------------------------------------------------------------------------
// Tipos del servicio
// ---------------------------------------------------------------------------

/** Un elemento de `mediaItems[]`: trabajo de vídeo o URL directa de foto. */
export interface LoveInstaMediaItem {
  type?: string | null;
  name?: string | null;
  /** Job de render (vídeo) o URL directa (foto). */
  mediaUrl?: string | null;
  mediaThumbnail?: string | null;
}

/** Objeto `api` de la respuesta de `proxy.php`. */
export interface LoveInstaApi {
  status?: string | null;
  service?: string | null;
  error?: string | null;
  message?: string | null;
  id?: string | null;
  title?: string | null;
  /** Suele ser el pie de foto; a veces viene como `false`. */
  description?: string | false | null;
  imagePreviewUrl?: string | false | null;
  previewUrl?: string | false | null;
  mediaItems?: LoveInstaMediaItem[] | false | null;
}

interface ProxyResponse {
  status: number;
  payload: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// HTTP con reintentos
// ---------------------------------------------------------------------------

/** Extrae un string limpio de un registro del servicio. */
function str(record: Record<string, unknown> | LoveInstaApi | null, ...keys: string[]): string | null {
  if (!record) return null;
  const source = record as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** `api` como objeto, o `null` si no viene (errores del servicio). */
function apiRecord(payload: Record<string, unknown> | null): LoveInstaApi | null {
  const api = payload?.api;
  if (!api || typeof api !== "object" || Array.isArray(api)) return null;
  return api as LoveInstaApi;
}

/**
 * `POST` de formulario a LoveInsta.
 *
 * Los estados transitorios (429/5xx) se repiten con backoff; el resto se
 * devuelve tal cual (`status` + `payload` ya parseado) para que el llamador
 * decida: los errores del servicio llegan con HTTP 400 y cuerpo JSON.
 */
async function postProxy(url: string): Promise<ProxyResponse> {
  let lastError: RequestError | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(LOVEINSTA_PROXY_URL, {
        method: "POST",
        headers: headersInit(LOVEINSTA_HEADERS),
        body: new URLSearchParams({ url }).toString(),
      });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`LoveInsta respondió HTTP ${response.status}.`);
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
        `Error de red contra LoveInsta (${(error as Error)?.name ?? "Error"}).`,
      );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("LoveInsta no respondió.");
}

// ---------------------------------------------------------------------------
// Mapeo de errores
// ---------------------------------------------------------------------------

/** Convierte un `api` con error en la excepción de la casa. */
function serviceError(api: LoveInstaApi): Error {
  return new UnavailableError(
    str(api, "message") ??
      "Ese contenido de Instagram no está disponible (¿es privado o borrado?).",
  );
}

/** Error HTTP sin `api` utilizable (400 INVALID_URL/WRONG_SERVICE, no JSON…). */
function httpPayloadError(response: ProxyResponse): Error {
  const error = str(response.payload, "error");
  const message = str(response.payload, "message");
  if (error === "WRONG_SERVICE" || error === "INVALID_URL" || response.status === 400) {
    return new UnavailableError(message ?? "Esa URL no apunta a una publicación de Instagram.");
  }
  if (response.payload === null) {
    return new RequestError("LoveInsta devolvió una respuesta no JSON.");
  }
  if (response.status >= 400) {
    return new RequestError(message ?? `LoveInsta respondió HTTP ${response.status}.`);
  }
  return new RequestError("Respuesta inesperada de LoveInsta.");
}

// ---------------------------------------------------------------------------
// Trabajos de render
// ---------------------------------------------------------------------------

/**
 * ¿Es una URL de trabajo del clúster de render?
 *
 * Patrón observado en todos los flujos verificados (IG y FB comparten
 * clúster): `https://s<nn>.worker<nn>.com/v5/video/<id>/<hash>/<calidad>`.
 */
export function isLoveInstaJobUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!/^[a-z0-9-]+\.worker\d+\.com$/i.test(parsed.hostname)) return false;
  return /^\/v5\/(?:video|audio)\/[^/]+\/[^/]+\/[^/]+$/.test(parsed.pathname);
}

/** Calidad del trabajo, leída del último segmento (`…/1080p` → `1080p`). */
function qualityFromJob(jobUrl: string): string | null {
  const last = jobUrl.split("/").pop() ?? "";
  return /^\d{3,4}p$/i.test(last) ? last.toLowerCase() : null;
}

/** Altura numérica de una calidad (`"1080p"` → 1080). Sin dato: -1. */
function heightOf(option: DownloadOption): number {
  const match = /(\d{3,4})\s*p/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : -1;
}

/** URL directa http(s) con host permitido, o `null`. */
function allowedDirectUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return isAllowedDownloadHost(urlHost(trimmed)) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Modelo canónico
// ---------------------------------------------------------------------------

/**
 * Convierte los `mediaItems` en opciones del modelo canónico.
 *
 * Los vídeos no son descargables directamente: llevan la URL relativa
 * `/api/render?job=…` (resolución perezosa al pulsar, igual que FSave). Orden:
 * vídeos por altura descendente y, detrás, fotos en el orden del servicio —
 * mismo criterio estable que `toDownloads` de FSave.
 */
export function toDownloads(api: LoveInstaApi): DownloadOption[] {
  const raw = api.mediaItems;
  if (!Array.isArray(raw)) return [];

  const videos: DownloadOption[] = [];
  const images: DownloadOption[] = [];

  for (const item of raw) {
    const mediaUrl = typeof item.mediaUrl === "string" ? item.mediaUrl.trim() : null;
    if (!mediaUrl) continue;
    const type = (typeof item.type === "string" ? item.type : "").trim().toLowerCase();
    const thumbnail =
      typeof item.mediaThumbnail === "string" && item.mediaThumbnail.trim()
        ? item.mediaThumbnail.trim()
        : null;

    if (type === "video" || (type === "" && isLoveInstaJobUrl(mediaUrl))) {
      if (!isLoveInstaJobUrl(mediaUrl)) continue;
      const quality = qualityFromJob(mediaUrl);
      videos.push({
        name: quality ? `Vídeo ${quality}` : "Vídeo",
        url: `/api/render?job=${encodeURIComponent(mediaUrl)}`,
        format: "mp4",
        quality,
        kind: "video",
        // Verificado: los MP4 de los jobs traen pistas `soun` + `mp4a`.
        hasAudio: true,
      });
      continue;
    }

    if (type === "image" || type === "") {
      const direct = allowedDirectUrl(mediaUrl);
      if (!direct) continue;
      images.push({
        name: "Foto",
        url: direct,
        // Observado: las fotos se sirven siempre como `image/jpeg`.
        format: "jpg",
        quality: null,
        kind: "image",
        thumbnail: thumbnail ?? direct,
      });
    }
  }

  videos.sort((a, b) => heightOf(b) - heightOf(a));
  return [...videos, ...images];
}

/** Título presentable: espacios colapsados y longitud razonable para la UI. */
function cleanText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > 160 ? `${flat.slice(0, 159).trimEnd()}…` : flat;
}

// ---------------------------------------------------------------------------
// Fuente
// ---------------------------------------------------------------------------

export class LoveInstaSource {
  /** Identificador estable del contrato `ContentSource` (`lib/sources.ts`). */
  readonly id = "loveinsta";
  /** Plataformas que esta fuente sabe servir. */
  readonly platforms = ["instagram"] as const;
  /** Sólo publicaciones sueltas: LoveInsta no ofrece listados verificados. */
  readonly supportsProfiles = false;

  /** Resuelve una publicación de Instagram (URLs públicas) en un solo paso. */
  async searchVideo(url: string): Promise<TikTokResult> {
    const target = url.trim();
    const shortcode = extractInstagramPostId(target);
    if (!shortcode) {
      throw new RequestError("Esa URL no parece una publicación de Instagram.", {
        retryable: false,
      });
    }

    const response = await postProxy(target);
    const api = apiRecord(response.payload);
    if (!api) throw httpPayloadError(response);

    const service = str(api, "service");
    if (service && service.toLowerCase() !== "instagram") {
      throw new UnavailableError("Esa URL no apunta a contenido de Instagram.");
    }
    const status = (str(api, "status") ?? "").toLowerCase();
    if (status === "error") throw serviceError(api);
    if (status !== "ok") throw httpPayloadError(response);

    const downloads = toDownloads(api);
    if (downloads.length === 0) {
      throw new UnavailableError("No se encontraron opciones de descarga.");
    }

    const preview = api.imagePreviewUrl;
    const fallbackThumb = api.previewUrl;
    const thumbnail =
      (typeof preview === "string" && preview.trim() ? preview.trim() : null) ??
      (typeof fallbackThumb === "string" && fallbackThumb.trim() ? fallbackThumb.trim() : null) ??
      downloads.find((option) => option.thumbnail)?.thumbnail ??
      null;
    const title =
      cleanText(str(api, "title")) ??
      cleanText(typeof api.description === "string" ? api.description : null) ??
      `Instagram ${shortcode}`;

    return { videoId: shortcode, title, thumbnail, downloads };
  }

  /** LoveInsta no ofrece listados de páginas: se rechaza sin tocar la red. */
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
