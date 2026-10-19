/**
 * Fuente de YouTube vía SnapYT (`www.snapyt.app`).
 *
 * Única fuente de YouTube desde que se retiraron YTDown (Cloudflare) e
 * Invidious. El flujo de resolución, verificado empíricamente sin WAF, tiene
 * tres pasos:
 *
 * 1. `POST /wp-admin/admin-ajax.php` con `action=vd_fresh_nonce` →
 *    `{ success, data: { nonce } }`.
 * 2. `POST` al mismo endpoint con `action=process_video_url`,
 *    `video_url=<URL de YouTube>` y `security=<nonce>` →
 *    `{ success: true, data: { redirect: "…/video-preview/?preview_id=…&q=…" } }`.
 * 3. `GET` la página de preview: un HTML con un `<select id="fmt-select">` que
 *    agrupa todas las opciones de descarga.
 *
 * Cada `<option>` del selector trae:
 *
 * ```html
 * <option value="5" data-kind="video-only" data-size="77.16 MB"
 *         data-force="https://www.snapyt.app/wp-admin/admin-ajax.php?action=snapyt_force_download&amp;pid=…&amp;fmt=5&amp;…">
 *   1080p MP4 · 77.16 MB
 * </option>
 * ```
 *
 * ## Vídeo + audio (combinación server-side)
 *
 * Las opciones `video-only` (todas las calidades altas) **no llevan audio**:
 * el audio está en pistas aparte. La propia web de SnapYT lo resuelve con un
 * trabajo de combinación en su servidor (`vd_mux_start` → `vd_mux_status` →
 * `vd_mux`), verificado empíricamente: se lanza con el `pid`/`nonce` del
 * preview y los índices `v` (vídeo) y `a` (audio), se consulta el estado cada
 * pocos segundos hasta `done` y el resultado se sirve desde `snapyt.app` con
 * `Content-Disposition: attachment`.
 *
 * Red.ly expone ese flujo como `/api/merge?yt=…&v=…&a=…`: las opciones
 * `video-only` entregan esa URL relativa en lugar de `data-force`, y el
 * cliente la invoca antes de descargar por `/api/download` (ver
 * `app/api/merge/route.ts`). Si la web cambia y no aparece el formulario de
 * combinación, las opciones conservan `data-force` (vídeo sin audio), que es
 * el comportamiento anterior.
 *
 * Reglas: **vídeo suelto** vía SnapYT y **listas de reproducción** vía
 * YTMP3.gg (API de metadatos `yt-meta.convert1s.com`; ver `lib/ytmp3.ts`).
 * Los canales de YouTube no se ofrecen todavía.
 */

import {
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  SNAPYT_AJAX_URL,
  SNAPYT_HEADERS,
  TRANSIENT_HTTP_STATUSES,
  YT_YTMP3_MAX_PER_PAGE,
  isAllowedDownloadHost,
  urlHost,
} from "./config";
import { RedlyError, RequestError, UnavailableError } from "./exceptions";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import { type DownloadOption, type MediaKind, type TikTokResult } from "./models";
import type { ProfilePage } from "./savetik";
import { listPlaylistItems } from "./ytmp3";
import {
  extractYouTubePlaylistId,
  extractYouTubeVideoId,
  isYouTubeProfileUrl,
  isYouTubeVideoUrl,
  normalizeYouTubeUrl,
} from "./youtube-urls";

// ---------------------------------------------------------------------------
// Utilidades locales
// ---------------------------------------------------------------------------

/** Extrae la primera cadena no vacía de las claves indicadas. */
function firstString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Extrae el primer número finito de las claves indicadas. */
function firstNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Decodifica las entidades HTML básicas de un atributo o etiqueta. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Altura numérica de una calidad (`"1080p"` → 1080). Sin resolución: -1. */
function heightOf(option: DownloadOption): number {
  const match = /(\d{3,4})\s*p/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : -1;
}

/**
 * `kind` del modelo canónico a partir del `data-kind` de SnapYT.
 *
 * Ojo con `video+audio` (la progresiva recomendada): contiene la palabra
 * «audio» pero es **vídeo con audio**, no una pista de sólo audio. Sólo
 * cuenta como audio lo marcado `audio-only` (o `audio` a secas).
 */
function mediaKindFromDataKind(dataKind: string): MediaKind {
  const value = dataKind.toLowerCase();
  if (value === "audio" || value.includes("audio-only")) return "audio";
  return "video";
}

/** Formato de archivo a partir del texto de la etiqueta (`1080p MP4 · 77 MB`). */
function formatFromLabel(label: string): string | null {
  const match = /\b(mp4|webm|m4a|mp3|opus|mov|mkv)\b/i.exec(label);
  return match ? match[1].toLowerCase() : null;
}

/** Calidad numérica del vídeo a partir del texto (`1080p MP4` → `1080p`). */
function qualityFromLabel(label: string): string | null {
  const match = /(\d{3,4})\s*p\b/i.exec(label);
  return match ? `${match[1]}p` : null;
}

/** Rango de bitrate para las pistas de audio (`MP3 · 320 kbps` → `320 kbps`). */
function audioQualityFromLabel(label: string): string {
  const match = /(\d{2,4})\s*kbps/i.exec(label);
  return match ? `${match[1]} kbps` : "audio";
}

/** Bitrate numérico de una pista de audio (`"131 kbps"` → 131). Sin dato: 0. */
function bitrateOf(option: DownloadOption): number {
  const match = /(\d{2,4})\s*kbps/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : 0;
}

/** Nombre visible de la opción, sin el tamaño (que ya se guarda aparte). */
function nameFromLabel(label: string, kind: MediaKind, quality: string | null): string {
  const cleaned = label.replace(/\s*·\s*≈?\s*[\d.,]+\s*(MB|GB|KB)\s*$/i, "").trim();
  if (cleaned) return cleaned;
  if (kind === "audio") return `Audio ${quality ?? ""}`.trim();
  return quality ? `Vídeo ${quality}` : "Vídeo";
}

// ---------------------------------------------------------------------------
// HTTP compartido (resolución del preview)
// ---------------------------------------------------------------------------

/** `POST` a `admin-ajax.php` y devuelve el JSON ya normalizado. */
async function postAjaxForm(body: string): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(SNAPYT_AJAX_URL, {
        method: "POST",
        headers: headersInit(SNAPYT_HEADERS),
        body,
      });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`SnapYT respondió HTTP ${response.status}.`);
      } else if (response.status === 404) {
        throw new UnavailableError("El contenido solicitado no existe o es privado.");
      } else if (response.status >= 400) {
        throw new RequestError(`SnapYT respondió HTTP ${response.status}.`);
      } else {
        let parsed: unknown;
        try {
          parsed = await response.json();
        } catch {
          throw new RequestError("SnapYT devolvió una respuesta no JSON.");
        }
        return extractRecord(parsed);
      }
    } catch (error) {
      if (error instanceof UnavailableError) throw error;
      lastError =
        error instanceof RequestError
          ? error
          : new RequestError(
              `Error de red contra SnapYT (${(error as Error)?.name ?? "Error"}).`,
            );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("SnapYT no respondió.");
}

/**
 * Valida la respuesta JSON de `admin-ajax.php`.
 *
 * Tolera el doble formato observado: objeto directo o JSON serializado como
 * string (`JSON.parse` encadenado, como ya hacen TikVid y SavTik).
 */
function extractRecord(body: unknown): Record<string, unknown> {
  let payload = body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new RequestError("SnapYT devolvió una respuesta no JSON.");
    }
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new RequestError("Respuesta inesperada de SnapYT.");
  }
  return payload as Record<string, unknown>;
}

/** Descarga un HTML (páginas de preview) con reintentos ante estados transitorios. */
async function fetchHtml(url: string): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "GET",
        headers: headersInit({ "User-Agent": SNAPYT_HEADERS["User-Agent"] }),
      });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`SnapYT respondió HTTP ${response.status}.`);
      } else if (response.status === 404) {
        throw new UnavailableError("El contenido solicitado no existe o es privado.");
      } else if (response.status >= 400) {
        throw new RequestError(`SnapYT respondió HTTP ${response.status}.`);
      } else {
        return await response.text();
      }
    } catch (error) {
      if (error instanceof UnavailableError) throw error;
      lastError =
        error instanceof RequestError
          ? error
          : new RequestError(
              `Error de red contra SnapYT (${(error as Error)?.name ?? "Error"}).`,
            );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("SnapYT no respondió.");
}

/** Paso 1: pide un nonce fresco a WordPress. */
async function fetchNonce(): Promise<string> {
  const body = await postAjaxForm("action=vd_fresh_nonce");
  const data =
    typeof body.data === "object" && body.data !== null
      ? (body.data as Record<string, unknown>)
      : null;
  const nonce = data ? firstString(data, "nonce") : null;
  if (!nonce) throw new RequestError("SnapYT no devolvió un nonce válido.");
  return nonce;
}

/** Paso 2: envía la URL y obtiene el redirect al preview. */
async function fetchPreviewRedirect(videoUrl: string, nonce: string): Promise<string> {
  const payload = new URLSearchParams({
    action: "process_video_url",
    video_url: videoUrl,
    security: nonce,
  });
  const body = await postAjaxForm(payload.toString());
  const data =
    typeof body.data === "object" && body.data !== null
      ? (body.data as Record<string, unknown>)
      : null;
  const redirect = data ? firstString(data, "redirect") : null;
  if (!redirect) {
    const message =
      firstString(body, "message", "error") ?? "SnapYT no devolvió datos para esa URL.";
    throw new UnavailableError(message);
  }
  return redirect;
}

/** Ejecuta el flujo completo nonce → redirect → preview y devuelve el HTML. */
async function resolvePreviewHtml(videoUrl: string): Promise<string> {
  const nonce = await fetchNonce();
  const redirect = await fetchPreviewRedirect(videoUrl, nonce);
  return fetchHtml(redirect);
}

// ---------------------------------------------------------------------------
// Parsing del HTML de preview
// ---------------------------------------------------------------------------

/** Una fila del `<select id="fmt-select">`. */
interface PreviewOption {
  /** `value` del `<option>`: índice de formato que SnapYT usa en `fmt=`. */
  value: string;
  /** `data-kind`: `video+audio`, `video-only` o `audio-only`. */
  dataKind: string;
  /** `data-size` legible (`"77.16 MB"`); vacío en la opción recomendada. */
  dataSize: string;
  /** URL de descarga del proxy (`data-force`, con entidades ya decodificadas). */
  forceUrl: string;
  /** Texto visible de la opción. */
  label: string;
}

/**
 * Extrae las opciones del `<select id="fmt-select">`.
 *
 * El selector es el único bloque estable del preview; el resto de la página
 * (chips, botones) es decorativo. Se busca el `<select>` por su id y de ahí
 * se leen los `<option>` con `data-force`, que es la URL de descarga real.
 */
export function parsePreviewOptions(html: string): PreviewOption[] {
  const decoded = decodeEntities(html);
  const block = selectBlock(decoded, "fmt-select");
  if (!block) return [];

  const options: PreviewOption[] = [];
  for (const match of block.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)) {
    const attrs = match[1];
    const inner = match[2];
    const forceUrl = /data-force="([^"]*)"/.exec(attrs)?.[1] ?? "";
    if (!forceUrl) continue;
    const label = inner.replace(/<[^>]*>/g, "").trim();
    options.push({
      value: /value="([^"]*)"/.exec(attrs)?.[1] ?? "",
      dataKind: /data-kind="([^"]*)"/.exec(attrs)?.[1] ?? "",
      dataSize: /data-size="([^"]*)"/.exec(attrs)?.[1] ?? "",
      forceUrl,
      label,
    });
  }
  return options;
}

/** Bloque de un `<select>` concreto (desde su id hasta su `</select>`). */
function selectBlock(decoded: string, id: string): string {
  const start = decoded.indexOf(`id="${id}"`);
  if (start === -1) return "";
  const end = decoded.indexOf("</select>", start);
  return end === -1 ? "" : decoded.slice(start, end);
}

/** Valores no vacíos de las `<option>` de un bloque de select. */
function optionValues(block: string): string[] {
  const values: string[] = [];
  for (const match of block.matchAll(/<option\b([^>]*)>/g)) {
    const value = /value="([^"]*)"/.exec(match[1])?.[1] ?? "";
    if (value) values.push(value);
  }
  return values;
}

/**
 * Datos del formulario de combinación de la página de preview.
 *
 * Sale del bloque de merge (`#merge-link`, `#mux-video`, `#mux-audio`): con
 * ellos se puede lanzar un trabajo `vd_mux_start` desde el servidor. Si la
 * web cambia y el formulario desaparece, se devuelve `null` y las opciones
 * `video-only` conservan su `data-force` (vídeo sin audio).
 */
export interface MergeForm {
  /** Id de preview (mismo `pid` que en los `data-force`). */
  pid: string;
  /** Nonce específico del merge (`data-nonce` de `#merge-link`). */
  nonce: string;
  /** Índices aceptados en el merge de vídeo (`#mux-video`). */
  videoValues: string[];
  /** Índices aceptados en el merge de audio (`#mux-audio`). */
  audioValues: string[];
  /** Pista de audio que la web preselecciona (`data-default`): la recomendada. */
  defaultAudio: string | null;
}

/** Lee el formulario de combinación del preview, o `null` si no está. */
export function parseMergeForm(html: string): MergeForm | null {
  const decoded = decodeEntities(html);
  const button = /<a\b[^>]*id="merge-link"[^>]*>/.exec(decoded)?.[0] ?? "";
  const pid = /data-pid="([^"]*)"/.exec(button)?.[1] ?? "";
  const nonce = /data-nonce="([^"]*)"/.exec(button)?.[1] ?? "";
  if (!pid || !nonce) return null;

  const videoValues = optionValues(selectBlock(decoded, "mux-video"));
  const audioBlock = selectBlock(decoded, "mux-audio");
  const audioValues = optionValues(audioBlock);
  if (videoValues.length === 0 || audioValues.length === 0) return null;

  let defaultAudio: string | null = null;
  for (const match of audioBlock.matchAll(/<option\b([^>]*)>/g)) {
    if (!/data-default\b/.test(match[1])) continue;
    const value = /value="([^"]*)"/.exec(match[1])?.[1] ?? "";
    if (value) {
      defaultAudio = value;
      break;
    }
  }

  return { pid, nonce, videoValues, audioValues, defaultAudio };
}

/** Título del vídeo a partir del `alt`/`src` de la miniatura del preview. */
function parseTitle(html: string): string | null {
  const img = /<img\b[^>]*id="vd-image"[^>]*>/i.exec(html)?.[0];
  const alt = img ? /alt="([^"]*)"/.exec(img)?.[1] : null;
  if (alt && alt.trim()) return decodeEntities(alt).trim();
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) {
    const text = decodeEntities(h1.replace(/<[^>]*>/g, "")).trim();
    if (text) return text;
  }
  return null;
}

/** Miniatura del vídeo (`img#vd-image` → su `src`). */
function parseThumbnail(html: string, videoId: string): string | null {
  const img = /<img\b[^>]*id="vd-image"[^>]*>/i.exec(html)?.[0];
  const src = img ? /src="([^"]*)"/.exec(img)?.[1] : null;
  if (src && src.startsWith("http")) return decodeEntities(src);
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Contexto de mapeo: la URL original (para el merge) y su formulario. */
interface DownloadContext {
  videoUrl: string;
  merge: MergeForm | null;
}

/** URL relativa de nuestra API que combina vídeo + audio en el servidor. */
function buildMergeUrl(videoUrl: string, v: string, a: string): string {
  const params = new URLSearchParams({ yt: videoUrl, v, a });
  return `/api/merge?${params.toString()}`;
}

/**
 * Convierte las opciones del preview en `DownloadOption[]` del modelo canónico.
 *
 * El `data-kind` decide el `kind` y la URL:
 * - `video+audio` → archivo progresivo (pista completa, descarga directa).
 * - `video-only`  → pista de vídeo **sin audio**: si el formulario de
 *   combinación está disponible, la opción apunta a `/api/merge?…` para que
 *   SnapYT una ambos en su servidor (igual que hace la propia web). Si no,
 *   conserva `data-force` (vídeo sin audio, el comportamiento anterior).
 * - `audio-only`  → pista de audio (incluye MP3 convertido y opus/m4a).
 *
 * Se ordenan por altura numérica descendente; el audio queda al final.
 */
function toDownloads(options: PreviewOption[], ctx: DownloadContext): DownloadOption[] {
  const videos: DownloadOption[] = [];
  const audios: DownloadOption[] = [];

  for (const option of options) {
    if (!option.forceUrl) continue;
    const kind = mediaKindFromDataKind(option.dataKind);
    const format = formatFromLabel(option.label) ?? (kind === "audio" ? "audio" : "mp4");

    let url = option.forceUrl;
    if (kind === "video" && option.dataKind.toLowerCase() === "video-only" && ctx.merge) {
      const { merge } = ctx;
      if (
        merge.videoValues.includes(option.value) &&
        merge.defaultAudio &&
        merge.audioValues.includes(merge.defaultAudio)
      ) {
        url = buildMergeUrl(ctx.videoUrl, option.value, merge.defaultAudio);
      }
    }

    if (kind === "audio") {
      audios.push({
        name: nameFromLabel(option.label, kind, null),
        url,
        format,
        quality: audioQualityFromLabel(option.label),
        kind: "audio",
      });
    } else {
      const quality = qualityFromLabel(option.label);
      videos.push({
        name: nameFromLabel(option.label, kind, quality),
        url,
        format,
        quality,
        kind: "video",
        // `video+audio` (progresiva) lleva el sonido en la misma pista;
        // `video-only` no: o se combina vía `/api/merge` o baja mudo.
        hasAudio: option.dataKind.toLowerCase().includes("video+audio"),
      });
    }
  }

  // Vídeo de mayor a menor resolución; audio de mayor a menor bitrate. El
  // orden es estable, así que a igual calidad se conserva el del servicio
  // (p. ej. MP4 antes que WEBM a la misma altura).
  videos.sort((a, b) => heightOf(b) - heightOf(a));
  audios.sort((a, b) => bitrateOf(b) - bitrateOf(a));
  return [...videos, ...audios];
}

// ---------------------------------------------------------------------------
// Combinación de vídeo + audio (vd_mux_start → vd_mux_status → vd_mux)
// ---------------------------------------------------------------------------

/** Límite de espera de la combinación (estados `queued`/`running`). */
const MUX_STATUS_DEADLINE_MS = 90_000;
/** Tope de espera de la «puerta de inicio» (`retry_in` del servidor). */
const MUX_START_GATE_MS = 20_000;
/** Intentos: primero conexión directa (`px=0`), después ruta de reserva. */
const MUX_MAX_ATTEMPTS = 2;
/** Intervalo por defecto entre consultas de estado si el servidor no lo da. */
const MUX_POLL_DEFAULT_MS = 2_500;

/**
 * Espera escalada por `RETRY_BACKOFF_SECONDS`.
 *
 * En los tests esa variable vale `0` (ver `vitest.config.ts`), de modo que
 * las esperas se saltan y la suite sigue siendo instantánea.
 */
function pause(seconds: number): Promise<void> {
  return sleep(RETRY_BACKOFF_SECONDS > 0 ? seconds : 0);
}

/** Identificador de envío de 16 hex (exigido por `vd_mux_start`). */
function randomSid(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

interface MuxJob {
  statusUrl: string;
  cancelUrl: string | null;
  /** Enlace final si el servidor lo entrega ya en el arranque. */
  downloadUrl: string | null;
  pollIntervalMs: number;
}

/**
 * Lanza un trabajo de combinación.
 *
 * `px` es la ruta que usa la propia web: `0` = conexión directa, `1+` = rutas
 * de reserva. Si el servidor responde con `retry_in` (puerta de inicio con un
 * envío anterior aún en curso), se vuelve a preguntar hasta agotar
 * `MUX_START_GATE_MS`.
 */
async function startMuxJob(
  form: MergeForm,
  v: string,
  a: string,
  px: number,
): Promise<MuxJob> {
  const sid = randomSid();
  const gateStart = Date.now();

  for (;;) {
    const body = new URLSearchParams({
      action: "vd_mux_start",
      pid: form.pid,
      v,
      a,
      nonce: form.nonce,
      px: String(px),
      sid,
    });
    const response = await postAjaxForm(body.toString());
    const data =
      typeof response.data === "object" && response.data !== null
        ? (response.data as Record<string, unknown>)
        : null;
    const statusUrl = data ? firstString(data, "status_url") : null;

    if (response.success === true && statusUrl) {
      const pollInterval = data ? firstNumber(data, "poll_interval") : null;
      return {
        statusUrl,
        cancelUrl: data ? firstString(data, "cancel_url") : null,
        downloadUrl: data ? firstString(data, "download_url") : null,
        pollIntervalMs: pollInterval && pollInterval > 0 ? pollInterval : MUX_POLL_DEFAULT_MS,
      };
    }

    const retryIn = data ? firstNumber(data, "retry_in") : null;
    if (retryIn && retryIn > 0 && Date.now() - gateStart < MUX_START_GATE_MS) {
      await pause(Math.min(Math.max(retryIn, 1), 10));
      continue;
    }

    const message =
      (data && firstString(data, "message")) ?? "SnapYT no pudo iniciar la combinación.";
    throw new UnavailableError(message);
  }
}

/** Consulta el estado hasta `done` y devuelve el enlace final. */
async function awaitMuxJob(job: MuxJob): Promise<string> {
  const deadline = Date.now() + MUX_STATUS_DEADLINE_MS;

  for (;;) {
    if (Date.now() > deadline) {
      // El trabajo sigue vivo en SnapYT: se suelta para no dejarlo colgado.
      if (job.cancelUrl) {
        void fetchWithTimeout(job.cancelUrl, {
          method: "POST",
          headers: headersInit({ "User-Agent": SNAPYT_HEADERS["User-Agent"] }),
        }).catch(() => undefined);
      }
      throw new RequestError(
        "SnapYT está tardando en combinar el vídeo. Inténtalo de nuevo en unos segundos.",
      );
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(job.statusUrl, {
        method: "GET",
        headers: headersInit({ "User-Agent": SNAPYT_HEADERS["User-Agent"] }),
      });
    } catch (error) {
      throw new RequestError(
        `Error de red al consultar la combinación (${(error as Error)?.name ?? "Error"}).`,
      );
    }

    if (response.status === 404 || response.status === 410) {
      throw new UnavailableError("El trabajo de combinación expiró. Inténtalo de nuevo.");
    }
    if (response.status >= 400) {
      throw new RequestError(`SnapYT respondió HTTP ${response.status} al combinar.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RequestError("SnapYT devolvió una respuesta no JSON al combinar.");
    }
    const record = extractRecord(payload);
    const data =
      typeof record.data === "object" && record.data !== null
        ? (record.data as Record<string, unknown>)
        : {};

    if (record.success !== true) {
      throw new UnavailableError(
        firstString(data, "message") ?? "SnapYT no pudo combinar ese vídeo.",
      );
    }

    const status = firstString(data, "status");
    if (status === "done") {
      const downloadUrl = firstString(data, "download_url") ?? job.downloadUrl;
      if (!downloadUrl) {
        throw new RequestError("SnapYT terminó la combinación sin enlace de descarga.");
      }
      if (!isAllowedDownloadHost(urlHost(downloadUrl))) {
        throw new RequestError("SnapYT devolvió un enlace de descarga no permitido.", {
          retryable: false,
        });
      }
      return downloadUrl;
    }
    if (status === "error") {
      throw new UnavailableError(
        firstString(data, "message") ??
          "SnapYT no pudo combinar ese vídeo. Prueba con otra calidad.",
      );
    }

    const interval = firstNumber(data, "poll_interval") ?? job.pollIntervalMs;
    await pause(Math.min(Math.max(interval / 1000, 1), 5));
  }
}

/**
 * Combina vídeo + audio en SnapYT y devuelve la URL temporal del archivo.
 *
 * Flujo: resuelve el preview (credenciales frescas, sin caché) → valida que
 * `v`/`a` sean opciones reales de esa página → `vd_mux_start` → consulta de
 * estado hasta `done` → enlace validado contra la lista blanca. Si la ruta
 * directa (`px=0`) falla, se reintenta una vez con la ruta de reserva
 * (`px=1`), el mismo patrón de reintentos que usa la propia web.
 */
export async function prepareMergedDownload(videoUrl: string, v: string, a: string) {
  const target = normalizeYouTubeUrl(videoUrl);
  if (!isYouTubeVideoUrl(target)) {
    throw new RequestError("Esa URL no parece un vídeo de YouTube.");
  }
  if (!/^\d{1,2}$/.test(v) || !/^\d{1,2}$/.test(a)) {
    throw new RequestError("La calidad pedida no es válida.");
  }

  const html = await resolvePreviewHtml(target);
  const form = parseMergeForm(html);
  if (!form) {
    throw new UnavailableError("SnapYT no ofrece la combinación de vídeo y audio aquí.");
  }
  if (!form.videoValues.includes(v) || !form.audioValues.includes(a)) {
    throw new RequestError("Esa combinación de vídeo y audio no está disponible.");
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MUX_MAX_ATTEMPTS; attempt++) {
    try {
      const job = await startMuxJob(form, v, a, attempt);
      return await awaitMuxJob(job);
    } catch (error) {
      // Un fallo de la ruta directa se repite en la de reserva; si ambas
      // fallan, el último error es el que se explica al usuario. Los errores
      // marcados como no reintentables (p. ej. un host fuera de la lista
      // blanca) y los ajenos a la jerarquía se propagan sin gastar intentos.
      if (error instanceof RequestError && !error.retryable) throw error;
      if (!(error instanceof RedlyError)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new RequestError("SnapYT no pudo combinar el vídeo.");
}

// ---------------------------------------------------------------------------
// Fuente
// ---------------------------------------------------------------------------

export class SnapYTSource {
  /** Identificador estable del contrato `ContentSource` (`lib/sources.ts`). */
  readonly id = "snapyt";
  /** Plataformas que esta fuente sabe servir. */
  readonly platforms = ["youtube"] as const;
  /** Vídeo suelto (SnapYT) y listas de reproducción (YTMP3.gg). */
  readonly supportsProfiles = true;

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  /** Resuelve un vídeo de YouTube (incluidos Shorts y enlaces cortos). */
  async searchVideo(url: string): Promise<TikTokResult> {
    const target = normalizeYouTubeUrl(url);
    const videoId = extractYouTubeVideoId(target);
    if (!isYouTubeVideoUrl(target) || !videoId) {
      throw new RequestError("Esa URL no parece un vídeo de YouTube.");
    }

    const html = await resolvePreviewHtml(target);
    const options = parsePreviewOptions(html);
    const downloads = toDownloads(options, { videoUrl: target, merge: parseMergeForm(html) });
    if (downloads.length === 0) {
      throw new UnavailableError("No se encontraron opciones de descarga.");
    }

    return {
      videoId,
      title: parseTitle(html),
      thumbnail: parseThumbnail(html, videoId),
      downloads,
    };
  }

  /**
   * Lista una página de una lista de reproducción de YouTube.
   *
   * El listado lo sirve YTMP3 (`yt-meta.convert1s.com`): `id`, título, canal y
   * miniatura de cada vídeo, paginados con un token opaco (`cursor`). El título
   * de la lista se recupera de la propia página de YouTube (mejor esfuerzo) y
   * el canal se deduce del primer vídeo; el servicio no expone el total ni las
   * vistas. Los canales se rechazan antes de tocar la red.
   */
  async listProfilePage(
    url: string,
    cursor?: string | null,
    page?: number,
    limit?: number,
  ): Promise<ProfilePage> {
    const target = normalizeYouTubeUrl(url);
    if (isYouTubeProfileUrl(target)) {
      throw new RequestError(
        "Los canales de YouTube no están soportados. Usa una lista de reproducción (`/playlist?list=…`).",
        { retryable: false },
      );
    }
    const playlistId = extractYouTubePlaylistId(target);
    if (!playlistId) {
      throw new RequestError("Esa URL no parece una lista de reproducción de YouTube.", {
        retryable: false,
      });
    }

    const data = await listPlaylistItems(playlistId, cursor);
    const max = Math.min(limit ?? YT_YTMP3_MAX_PER_PAGE, YT_YTMP3_MAX_PER_PAGE);
    const items = data.items.slice(0, max);
    // El servicio no da el total de la lista: se omite y la UI muestra los ya
    // listados. El título viene de YouTube (best-effort) y el canal del primer
    // vídeo, que en las listas de un solo autor coincide con el de la lista.
    const channel = items[0]?.channel ?? null;
    const meta = data.title || channel ? { title: data.title, channel, total: null } : null;
    return { items, nextCursor: data.nextPageToken, page: page ?? 1, meta };
  }
}
