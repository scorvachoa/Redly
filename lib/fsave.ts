/**
 * Fuente de Facebook vía FSave (`fsave.net`).
 *
 * Única fuente de Facebook. El flujo, verificado empíricamente sin WAF, sin
 * Turnstile y sin claves de usuario, tiene tres pasos JSON:
 *
 * 1. `POST /mint.php` con `getch=1` → `{ ch }` (challenge de un solo uso).
 * 2. `POST /mint.php` con `ch=<challenge>&answer=<HMAC>` → `{ dt }` (sesión).
 *    El `answer` es HMAC-SHA256 del challenge con la clave que el propio
 *    servicio sirve en claro en `assets/js/sensor.js`; si gira, se relee de ahí.
 * 3. `POST /proxy.php` con `url=<post de Facebook>&dt=<sesión>` →
 *    `{ api: { status: "ok", title, mediaItems: [...] } }`.
 *
 * Cada `mediaItems[]` es un **trabajo de render** en el CDN del servicio
 * (`https://s<nn>.worker<nn>.com/v5/video|audio/<id>/<mediaId>/<calidad>`),
 * no un archivo directo: hay que volver a `POST /proxy.php` con esa `mediaUrl`
 * y sondear `progress` hasta `"Completed"`, que entrega el `fileUrl` final en
 * `dl.iamworker.com` con `Content-Disposition: attachment` y soporte Range/206
 * (host en la allowlist de `lib/config.ts`).
 *
 * Por eso cada opción de descarga lleva la URL relativa
 * `/api/render?job=<mediaUrl>`: el cliente la resuelve **al pulsar** (mint
 * fresco, igual que `/api/merge` de SnapYT) y después baja los bytes por
 * `/api/download`. La resolución es stateless: no se cachean `ch`, `dt` ni
 * `fileUrl` (los `fileUrl` caducan).
 *
 * Limitaciones documentadas: sólo vídeos públicos, sin perfiles de página y
 * sin transcripciones; FSave aplica un enfriamiento de ~10 s ante peticiones
 * idénticas desde la misma IP (429 → reintentos con backoff).
 */

import { createHmac } from "node:crypto";

import {
  FSAVE_HEADERS,
  FSAVE_MINT_KEY,
  FSAVE_MINT_URL,
  FSAVE_PROXY_URL,
  FSAVE_RENDER_ATTEMPTS,
  FSAVE_SENSOR_URL,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  TRANSIENT_HTTP_STATUSES,
  isAllowedDownloadHost,
  urlHost,
} from "./config";
import { RequestError, UnavailableError } from "./exceptions";
import { isFacebookVideoUrl } from "./facebook-urls";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import { type DownloadOption, type TikTokResult } from "./models";
import type { ProfilePage } from "./savetik";

// ---------------------------------------------------------------------------
// Tipos del servicio
// ---------------------------------------------------------------------------

/** Una pista ofrecida por FSave (vídeo, audio) — `mediaItems[]` del `api`. */
export interface FsaveMediaItem {
  type?: string | null;
  name?: string | null;
  mediaId?: string | null;
  /** URL del trabajo de render (no es el archivo final). */
  mediaUrl?: string | null;
  /** `"1080x1920"` (ancho×alto) o `false` en el audio. */
  mediaRes?: string | false | null;
  /** `"FHD"`, `"HD"`, `"64K"`… */
  mediaQuality?: string | null;
  /** `"MP4"`, `"M4A"`. */
  mediaExtension?: string | null;
  mediaFileSize?: string | null;
  mediaDuration?: string | null;
  mediaTask?: string | null;
}

/** Objeto `api` de la respuesta de `proxy.php`. */
export interface FsaveApi {
  status?: string | null;
  error?: string | null;
  message?: string | null;
  service?: string | null;
  id?: string | null;
  title?: string | null;
  description?: string | null;
  previewUrl?: string | false | null;
  permanentLink?: string | null;
  mediaItems?: FsaveMediaItem[] | false | null;
}

/** Resultado de un trabajo de render completado. */
export interface RenderedFile {
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
 * `POST` de formulario a FSave.
 *
 * Los estados transitorios (429/5xx) se repiten con backoff; el resto se
 * devuelve tal cual (`status` + `payload` ya parseado) para que el llamador
 * decida: `proxy.php` comunica sus errores con HTTP 400/403 y cuerpo JSON.
 */
async function postForm(url: string, body: string): Promise<ProxyResponse> {
  let lastError: RequestError | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: headersInit(FSAVE_HEADERS),
        body,
      });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`FSave respondió HTTP ${response.status}.`);
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
        `Error de red contra FSave (${(error as Error)?.name ?? "Error"}).`,
      );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("FSave no respondió.");
}

/** Extrae un string limpio de un registro o del `api` del servicio. */
function str(record: Record<string, unknown> | FsaveApi | null, ...keys: string[]): string | null {
  if (!record) return null;
  const source = record as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sesión (`mint`)
// ---------------------------------------------------------------------------

/** Intenta un `mint` completo con la clave indicada; `null` si no consigue `dt`. */
async function mintOnce(key: string): Promise<string | null> {
  try {
    const challenge = await postForm(FSAVE_MINT_URL, "getch=1");
    const ch = str(challenge.payload, "ch");
    if (!ch) return null;
    const answer = createHmac("sha256", key).update(ch).digest("hex").slice(0, 32);
    const session = await postForm(
      FSAVE_MINT_URL,
      `ch=${encodeURIComponent(ch)}&answer=${answer}`,
    );
    return str(session.payload, "dt");
  } catch {
    return null;
  }
}

/** Lee la clave HMAC actual del JS público del servicio (rotación detectada). */
async function readMintKey(): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(FSAVE_SENSOR_URL, {
      method: "GET",
      headers: headersInit({ "User-Agent": FSAVE_HEADERS["User-Agent"] }),
    });
    if (!response.ok) return null;
    const source = await response.text();
    const match = /K\s*=\s*['"]([0-9a-f]{32})['"]/.exec(source);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Obtiene un `dt` fresco.
 *
 * El `ch` es de un solo uso y el `dt` caduca, así que se pide en **cada**
 * llamada (stateless, sin cachear credenciales).
 */
export async function mintDt(): Promise<string> {
  const primary = await mintOnce(FSAVE_MINT_KEY);
  if (primary) return primary;
  // La clave puede haber girado: se relee de `sensor.js` y se reintenta una vez.
  const rotated = await readMintKey();
  if (rotated) {
    const retry = await mintOnce(rotated);
    if (retry) return retry;
  }
  throw new RequestError("FSave no concedió el token de sesión (mint).");
}

// ---------------------------------------------------------------------------
// `proxy.php` y mapeo de errores
// ---------------------------------------------------------------------------

async function proxyPost(url: string, dt: string): Promise<ProxyResponse> {
  return postForm(FSAVE_PROXY_URL, `url=${encodeURIComponent(url)}&dt=${encodeURIComponent(dt)}`);
}

/** `api` como objeto, o `null` si no viene (errores del servicio). */
function apiRecord(payload: Record<string, unknown> | null): FsaveApi | null {
  const api = payload?.api;
  if (!api || typeof api !== "object" || Array.isArray(api)) return null;
  return api as FsaveApi;
}

/** La sesión caducó (`403 STALE_PAGE`): hay que pedir un `dt` nuevo. */
function isStale(response: ProxyResponse): boolean {
  if (response.status === 403) return true;
  const error = str(response.payload, "error");
  return error === "STALE_PAGE";
}

/** Convierte un error del `api` en la excepción de la casa. */
function serviceError(api: FsaveApi): Error {
  const message = str(api, "message");
  const code = (str(api, "error") ?? "").toUpperCase();
  if (code === "FETCH_ERROR") {
    // Fallo al recuperar el post (URL inexistente o Facebook caído): reintentable.
    return new RequestError(message ?? "Facebook no respondió. Inténtalo de nuevo.");
  }
  return new UnavailableError(
    message ?? "Ese contenido de Facebook no está disponible (¿es privado o borrado?).",
  );
}

/** Error HTTP sin `api` (400 WRONG_SERVICE, cuerpo no JSON…). */
function httpPayloadError(response: ProxyResponse): Error {
  const error = str(response.payload, "error");
  const message = str(response.payload, "message");
  if (error === "WRONG_SERVICE" || response.status === 404) {
    return new UnavailableError(message ?? "FSave no soporta esa URL.");
  }
  if (response.payload === null) {
    return new RequestError("FSave devolvió una respuesta no JSON.");
  }
  if (response.status >= 400) {
    return new RequestError(message ?? `FSave respondió HTTP ${response.status}.`);
  }
  return new RequestError("Respuesta inesperada de FSave.");
}

/**
 * Lanza el error que corresponda a una respuesta sin `api` utilizable.
 * Común a resolución y render.
 */
function throwHttpError(response: ProxyResponse): never {
  throw httpPayloadError(response);
}

// ---------------------------------------------------------------------------
// Resolución de un post
// ---------------------------------------------------------------------------

/**
 * Resuelve la URL de un post de Facebook y devuelve su `api`.
 *
 * Reintenta una vez con `dt` nuevo si la sesión caducó (`STALE_PAGE`).
 */
export async function resolveFacebookPost(url: string): Promise<FsaveApi> {
  let dt = await mintDt();
  let response = await proxyPost(url, dt);
  if (isStale(response)) {
    dt = await mintDt();
    response = await proxyPost(url, dt);
    if (isStale(response)) {
      throw new RequestError("FSave rechazó la sesión (STALE_PAGE) tras renovarla.");
    }
  }

  const api = apiRecord(response.payload);
  if (!api) throwHttpError(response);

  const service = str(api, "service");
  if (service && service.toLowerCase() !== "facebook") {
    throw new UnavailableError("Esa URL no apunta a contenido de Facebook.");
  }
  const status = (str(api, "status") ?? "").toLowerCase();
  if (status === "error") throw serviceError(api);
  if (status !== "ok") throw new RequestError("Respuesta inesperada de FSave.");
  return api;
}

// ---------------------------------------------------------------------------
// Trabajos de render → archivo directo
// ---------------------------------------------------------------------------

/**
 * ¿Es una URL de trabajo (job) de FSave?
 *
 * Patrón observado en todos los flujos verificados:
 * `https://s<nn>.worker<nn>.com/v5/video|audio/<id>/<mediaId>/<calidad>`.
 */
export function isFsaveJobUrl(url: string | null | undefined): boolean {
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

/**
 * Sondea un trabajo hasta `Completed` y devuelve el `fileUrl` directo.
 *
 * Cada invocación pide su propio `dt` y sondea con backoff (los tests fijan
 * `RETRY_BACKOFF_SECONDS=0`, así que el bucle es inmediato). El `fileUrl`
 * devuelto se valida contra la allowlist: si FSave cambiara de host, el error
 * es explícito en lugar de un 400 sorpresa en `/api/download`.
 */
export async function resolveRenderJob(jobUrl: string): Promise<RenderedFile> {
  if (!isFsaveJobUrl(jobUrl)) {
    throw new RequestError("La URL de trabajo no es válida.", { retryable: false });
  }

  let dt = await mintDt();
  for (let attempt = 0; attempt < FSAVE_RENDER_ATTEMPTS; attempt++) {
    let response = await proxyPost(jobUrl, dt);
    if (isStale(response)) {
      dt = await mintDt();
      response = await proxyPost(jobUrl, dt);
    }

    const api = apiRecord(response.payload);
    if (!api) throwHttpError(response);

    const progress = (str(api, "progress") ?? "").toLowerCase();
    if (progress === "completed") {
      const fileUrl = str(api, "fileUrl");
      if (!fileUrl) throw new RequestError("FSave terminó el trabajo sin entregar el archivo.");
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
    if (attempt < FSAVE_RENDER_ATTEMPTS - 1) await sleep(RETRY_BACKOFF_SECONDS);
  }
  throw new UnavailableError(
    "FSave tardó demasiado en preparar el archivo. Vuelve a intentarlo.",
  );
}

// ---------------------------------------------------------------------------
// Modelo canónico
// ---------------------------------------------------------------------------

/** Altura convencional de una calidad: el lado corto (`1080x1920` → 1080). */
function qualityHeight(mediaRes: string | false | null | undefined): number | null {
  if (!mediaRes || typeof mediaRes !== "string") return null;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(mediaRes.trim());
  if (!match) return null;
  return Math.min(Number(match[1]), Number(match[2]));
}

/** Bitrate numérico de una pista de audio (`"64K"` → 64). Sin dato: 0. */
function bitrateOf(option: DownloadOption): number {
  const match = /(\d{2,4})\s*kbps/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : 0;
}

/** Altura numérica de una calidad (`"1080p"` → 1080). Sin dato: -1. */
function heightOf(option: DownloadOption): number {
  const match = /(\d{3,4})\s*p/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : -1;
}

/** ¿Es este `mediaItem` una pista de audio? */
function isAudioItem(item: FsaveMediaItem, jobUrl: string | null): boolean {
  if (typeof item.type === "string" && item.type.trim()) {
    return item.type.trim().toLowerCase() === "audio";
  }
  return jobUrl ? jobUrl.includes("/v5/audio/") : false;
}

/**
 * Convierte los `mediaItems` del servicio en opciones del modelo canónico.
 *
 * Las opciones no son descargables directamente: llevan la URL relativa
 * `/api/render?job=…` (resolución perezosa al pulsar). Orden: vídeos por
 * altura descendente y, detrás, audios por bitrate descendente — mismo
 * criterio estable que `toDownloads` de SnapYT.
 */
export function toDownloads(api: FsaveApi): DownloadOption[] {
  const raw = api.mediaItems;
  if (!Array.isArray(raw)) return [];

  const videos: DownloadOption[] = [];
  const audios: DownloadOption[] = [];

  for (const item of raw) {
    const jobUrl = typeof item.mediaUrl === "string" ? item.mediaUrl.trim() : null;
    if (!jobUrl || !isFsaveJobUrl(jobUrl)) continue;

    const audio = isAudioItem(item, jobUrl);
    const extension =
      (typeof item.mediaExtension === "string" && item.mediaExtension.trim()
        ? item.mediaExtension.trim()
        : audio
          ? "m4a"
          : "mp4"
      ).toLowerCase() || null;

    let quality: string | null = null;
    if (audio) {
      const match = /(\d{2,4})/.exec(
        typeof item.mediaQuality === "string" ? item.mediaQuality : "",
      );
      quality = match ? `${match[1]} kbps` : null;
    } else {
      const height = qualityHeight(item.mediaRes);
      quality = height ? `${height}p` : null;
    }

    const option: DownloadOption = {
      name: audio
        ? `Audio${quality ? ` ${quality}` : ""}`
        : `Vídeo${quality ? ` ${quality}` : ""}`,
      url: `/api/render?job=${encodeURIComponent(jobUrl)}`,
      format: extension,
      quality,
      kind: audio ? "audio" : "video",
      // Verificado: los MP4 de FSave traen pistas `soun` + `vide`.
      hasAudio: audio ? null : true,
    };
    (audio ? audios : videos).push(option);
  }

  videos.sort((a, b) => heightOf(b) - heightOf(a));
  audios.sort((a, b) => bitrateOf(b) - bitrateOf(a));
  return [...videos, ...audios];
}

// ---------------------------------------------------------------------------
// Fuente
// ---------------------------------------------------------------------------

export class FsaveSource {
  /** Identificador estable del contrato `ContentSource` (`lib/sources.ts`). */
  readonly id = "fsave";
  /** Plataformas que esta fuente sabe servir. */
  readonly platforms = ["facebook"] as const;
  /** Sólo vídeos sueltos: FSave no ofrece listados de páginas. */
  readonly supportsProfiles = false;

  /** Resuelve un vídeo o reel de Facebook (URLs públicas). */
  async searchVideo(url: string): Promise<TikTokResult> {
    const target = url.trim();
    if (!isFacebookVideoUrl(target)) {
      throw new RequestError("Esa URL no parece un vídeo de Facebook.", { retryable: false });
    }

    const api = await resolveFacebookPost(target);
    const downloads = toDownloads(api);
    if (downloads.length === 0) {
      throw new UnavailableError("No se encontraron opciones de descarga.");
    }

    const preview = api.previewUrl;
    return {
      videoId: str(api, "id"),
      title: str(api, "title", "description"),
      thumbnail: typeof preview === "string" && preview.trim() ? preview.trim() : null,
      downloads,
    };
  }

  /** FSave no ofrece listados de páginas: se rechaza sin tocar la red. */
  async listProfilePage(
    _url: string,
    _cursor?: string | null,
    _page?: number,
    _limit?: number,
  ): Promise<ProfilePage> {
    throw new RequestError("Las páginas de Facebook no están soportadas.", {
      retryable: false,
    });
  }
}
