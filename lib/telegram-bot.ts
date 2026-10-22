/**
 * Lógica del bot de Telegram de Red.ly.
 *
 * El usuario pega una URL de cualquiera de las 6 redes soportadas y el bot
 * responde directamente con el archivo en **mejor calidad posible** (sin
 * preguntar): se reutiliza el mismo motor que la web —`classifyInput` para
 * clasificar, `sourceForPlatform().searchVideo()` para analizar y
 * `batchOption(result, "max")` para elegir la opción— y las mismas funciones
 * lib para resolver las URLs relativas (`/api/merge`, `/api/render`) que la
 * web pediría a sus propias rutas.
 *
 * Apt servidor: sin imports de `next/*`. El webhook (`app/api/telegram/
 * webhook/route.ts`) valida el secreto y delega aquí; todo lo testeable
 * acepta dependencias inyectadas (`BotDeps`).
 */

import { TtlCache } from "./cache";
import {
  TELEGRAM_ALLOWED_CHAT_IDS,
  TELEGRAM_BOT_PUBLIC,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_MAX_FILE_BYTES,
  TELEGRAM_WEBHOOK_SECRET,
} from "./config";
import { openStream } from "./downloader";
import { DownloadError, RedlyError, UnavailableError } from "./exceptions";
import { resolveRenderJob } from "./fsave";
import { resolveIlovexRenderJob } from "./ilovex";
import { batchOption, type DownloadOption, type TikTokResult } from "./models";
import { RateLimiter, telegramLimiter } from "./ratelimit";
import { sourceForPlatform } from "./sources";
import { resolveSavethreadsRenderJob } from "./savethreads";
import { prepareMergedDownload } from "./snapyt";
import {
  TelegramApi,
  TelegramApiError,
  type TelegramUpdate,
} from "./telegram";
import { classifyInput, type ClassifiedUrl } from "./urlrules";

/** Enlace de la web mostrado en la ayuda y en los mensajes «úsalo en la web». */
export const TELEGRAM_SITE_URL = "https://red-ly.vercel.app";

const HELP_TEXT =
  "Red.ly bot — pega un enlace de TikTok, YouTube, Facebook, Instagram, X o Threads " +
  "y te devuelvo el vídeo en la mejor calidad (o las fotos de la publicación).\n\n" +
  "Los perfiles y las listas aún no están disponibles en el bot: " +
  `úsalo en la web ${TELEGRAM_SITE_URL}`;

const UNSUPPORTED_URL_TEXT =
  "No reconozco esa URL. Pega un enlace de TikTok, YouTube, Facebook, Instagram, X o Threads.";

const PROFILE_TEXT =
  "Los perfiles y las listas aún no están disponibles en el bot. " +
  `Pega la URL de un vídeo concreto, o usa la web ${TELEGRAM_SITE_URL}`;

const RATE_LIMIT_TEXT = "Demasiadas peticiones. Espera unos segundos.";

const SERVICE_ERROR_TEXT = "El servicio no respondió. Inténtalo de nuevo en unos segundos.";

/** Límite de caption de la Bot API (título incluido). */
const CAPTION_LIMIT = 1024;
/** Fotos por álbum (`sendMediaGroup` admite 2–10 elementos). */
const MEDIA_GROUP_SIZE = 10;
/** TTL del dedupe de `update_id` (Telegram reintenta el webhook en corto). */
const SEEN_UPDATES_TTL_MS = 5 * 60_000;

/**
 * Dedupe compartido por invocaciones (una sola instancia por módulo, igual
 * que `apiLimiter`/`profilePageCache`): en serverless es memoria por
 * instancia, suficiente para los reintentos cortos del webhook.
 */
const seenTelegramUpdates = new TtlCache<boolean>({ maxEntries: 500 });

// ---------------------------------------------------------------------------
// Dependencias inyectables
// ---------------------------------------------------------------------------

export interface BotDeps {
  api: TelegramApi;
  /** Chats autorizados; vacío = nadie (ignorada si `publicAccess`). */
  allowedChatIds: ReadonlySet<string>;
  /** `true` = atiende a cualquier chat, ignorando la allowlist. */
  publicAccess: boolean;
  limiter: RateLimiter;
  /** Dedupe de reintentos del webhook (por `update_id`). */
  seenUpdates: TtlCache<boolean>;
  /** Resuelve una URL de vídeo contra su fuente (inyectable en tests). */
  searchVideo(url: string): Promise<TikTokResult>;
  /** Resuelve una URL relativa (`/api/merge`, `/api/render`) a la del CDN. */
  resolvePreparedUrl(relativeUrl: string): Promise<string>;
  /** Descarga el archivo para subirlo (fallback cuando la URL no sirve). */
  fetchFile(url: string): Promise<{ blob: Blob; contentType: string | null }>;
  maxFileBytes: number;
}

/** Implementación por defecto: config del entorno + fuentes reales. */
export function createBotDeps(): BotDeps {
  const api = new TelegramApi({ token: TELEGRAM_BOT_TOKEN });
  return {
    api,
    allowedChatIds: TELEGRAM_ALLOWED_CHAT_IDS,
    publicAccess: TELEGRAM_BOT_PUBLIC,
    limiter: telegramLimiter,
    seenUpdates: seenTelegramUpdates,
    searchVideo(url) {
      const source = sourceForPlatform(classifyInput(url)?.slug ?? null);
      if (!source) throw new UnavailableError("Esa plataforma todavía no tiene una fuente verificada.");
      return source.searchVideo(url);
    },
    resolvePreparedUrl: resolvePreparedUrl,
    fetchFile: (url) => downloadFileBounded(url, TELEGRAM_MAX_FILE_BYTES),
    maxFileBytes: TELEGRAM_MAX_FILE_BYTES,
  };
}

// ---------------------------------------------------------------------------
// Validación del webhook
// ---------------------------------------------------------------------------

/**
 * ¿Coincide la cabecera del webhook con el secreto configurado?
 *
 * Comparación en tiempo constante para no filtrar el secreto por tiempos de
 * respuesta. Un secreto vacío en config nunca valida (nadie debería exponer
 * el webhook sin secreto).
 */
export function isWebhookSecretValid(
  received: string | null | undefined,
  expected: string = TELEGRAM_WEBHOOK_SECRET,
): boolean {
  if (!expected) return false;
  const value = (received ?? "").trim();
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Manejo de un update
// ---------------------------------------------------------------------------

/**
 * Procesa un update del webhook.
 *
 * **Nunca lanza**: un fallo se notifica al usuario (si es posible) y el
 * webhook responde 200 igual — Telegram reintenta si no recibe 200, y los
 * reintentos se filtran con el dedupe de `update_id`.
 */
export async function handleTelegramUpdate(update: unknown, deps: BotDeps): Promise<void> {
  const parsed = parseUpdate(update);
  if (!parsed) return;

  // Reintentos del webhook: el mismo update_id se procesa una sola vez.
  if (deps.seenUpdates.get(String(parsed.update_id))) return;
  deps.seenUpdates.set(String(parsed.update_id), true, SEEN_UPDATES_TTL_MS);

  const message = parsed.message;
  // Sólo mensajes de texto en chat privado o de grupo: el resto se ignora.
  if (!message?.chat?.id || typeof message.chat.id !== "number") return;
  const chatId = message.chat.id;

  // Allowlist: fuera de la lista, respuesta 200 del webhook sin contestar.
  // El modo público (`TELEGRAM_BOT_PUBLIC`) ignora la lista y atiende a todos.
  if (
    !deps.publicAccess &&
    (deps.allowedChatIds.size === 0 || !deps.allowedChatIds.has(String(chatId)))
  ) {
    return;
  }

  const text = (message.text ?? "").trim();
  if (!text) return;

  const command = commandOf(text);
  if (command === "/start" || command === "/help") {
    await safeSend(deps, chatId, HELP_TEXT);
    return;
  }
  if (command) {
    await safeSend(deps, chatId, "Comando no reconocido. Pega una URL o escribe /help.");
    return;
  }

  const limit = deps.limiter.check(String(chatId));
  if (!limit.allowed) {
    await safeSend(deps, chatId, RATE_LIMIT_TEXT);
    return;
  }

  try {
    await handleUrlInput(text, chatId, deps);
  } catch (error) {
    await safeSend(deps, chatId, friendlyError(error));
  }
}

/** `/start@MiBot hola` → `/start`; texto normal → `null`. */
function commandOf(text: string): string | null {
  if (!text.startsWith("/")) return null;
  return text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? null;
}

/** Acepta sólo updates con forma de mensaje de texto. */
function parseUpdate(update: unknown): { update_id: number; message: TelegramUpdate["message"] } | null {
  if (typeof update !== "object" || update === null) return null;
  const record = update as { update_id?: unknown; message?: unknown };
  if (typeof record.update_id !== "number") return null;
  const message = record.message as TelegramUpdate["message"] | undefined;
  if (!message || typeof message !== "object") return null;
  if (typeof message.chat?.id !== "number") return null;
  return { update_id: record.update_id, message };
}

// ---------------------------------------------------------------------------
// Flujo de una URL
// ---------------------------------------------------------------------------

/** URLs embebidas en texto libre (los botones «Compartir» pegan texto + enlace). */
const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"']+/gi;

/** Puntuación final que arrastra el enlace al copiar, no forma parte de la URL. */
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}»"']+$/;

/**
 * Primera URL soportada dentro de un texto libre.
 *
 * Compartir desde TikTok u otras apps pega un párrafo con el enlace en medio
 * (`… #TikTok https://vm.tiktok.com/…/ Esta publicación se ha compartido…
 * https://www.tiktok.com/tiktoklite`). Se extraen todas las URLs del texto y se
 * devuelve la primera que clasifica como vídeo; si ninguna lo es, la primera
 * clasificable de cualquier tipo (así un perfil sigue contestando con el
 * mensaje de «úsalo en la web»).
 */
function classifiedUrlFromText(text: string): ClassifiedUrl | null {
  const candidates = (text.match(URL_IN_TEXT_RE) ?? []).map((raw) =>
    raw.replace(TRAILING_PUNCTUATION_RE, ""),
  );
  let first: ClassifiedUrl | null = null;
  for (const candidate of candidates) {
    const classified = classifyInput(candidate);
    if (!classified) continue;
    if (classified.kind === "video") return classified;
    first ??= classified;
  }
  return first;
}

async function handleUrlInput(text: string, chatId: number, deps: BotDeps): Promise<void> {
  // La entrada puede ser la URL sola o el texto de compartir con el enlace en
  // medio; en ese caso se queda con la primera URL soportada del párrafo.
  const classified = classifyInput(text) ?? classifiedUrlFromText(text);
  if (!classified) {
    await safeSend(deps, chatId, UNSUPPORTED_URL_TEXT);
    return;
  }
  if (classified.kind === "profile") {
    await safeSend(deps, chatId, PROFILE_TEXT);
    return;
  }
  if (classified.kind === "unsupported") {
    await safeSend(deps, chatId, "Esa URL no corresponde a un vídeo concreto.");
    return;
  }

  await deps.api.sendChatAction(chatId, "typing");

  const result = await deps.searchVideo(classified.url);
  const photos = result.downloads.filter((option) => option.kind === "image");
  // Mejor calidad automática: en YouTube incluye la combinación (`/api/merge`);
  // las pistas mudas no combinables quedan descartadas dentro de `batchOption`.
  const video = batchOption(result, "max");
  const caption = captionFor(result.title);

  if (!video && photos.length === 0) {
    await safeSend(deps, chatId, "No se encontraron opciones de descarga para esa URL.");
    return;
  }

  if (video) {
    await deps.api.sendChatAction(chatId, "upload_video");
    await sendVideoWithFallback(deps, chatId, video, result, caption);
  }
  if (photos.length > 0) {
    await deps.api.sendChatAction(chatId, "upload_photo");
    await sendPhotos(deps, chatId, photos, caption, result.videoId);
  }
}

// ---------------------------------------------------------------------------
// Envío de vídeo (URL primero; si Telegram no la baja, subida en streaming)
// ---------------------------------------------------------------------------

async function sendVideoWithFallback(
  deps: BotDeps,
  chatId: number,
  option: DownloadOption,
  result: TikTokResult,
  caption: string | null,
): Promise<void> {
  const sourceUrl = option.url.startsWith("/")
    ? await deps.resolvePreparedUrl(option.url)
    : option.url;

  try {
    await deps.api.sendVideo(chatId, { url: sourceUrl }, { caption });
    return;
  } catch (error) {
    // Un límite de tasa de Telegram (429) no se arregla subiendo el archivo.
    if (error instanceof TelegramApiError && error.statusCode === 429) throw error;
  }

  // Fallback: se descarga aquí y se sube en multipart (mismo tope de bytes).
  const filename = `Redly_${safeId(result.videoId)}.${option.format ?? "mp4"}`;
  const { blob } = await fetchBounded(deps, sourceUrl);
  try {
    await deps.api.sendVideo(
      chatId,
      { file: { blob, filename } },
      { caption, supportsStreaming: true },
    );
  } catch {
    throw new DownloadError(
      "Telegram no pudo recibir el vídeo (ni por URL ni subiéndolo). Inténtalo de nuevo.",
    );
  }
}

// ---------------------------------------------------------------------------
// Envío de fotos (álbum; 1 sola → foto con fallback de subida)
// ---------------------------------------------------------------------------

async function sendPhotos(
  deps: BotDeps,
  chatId: number,
  photos: DownloadOption[],
  caption: string | null,
  videoId: string | null | undefined,
): Promise<void> {
  const urls = photos.map((photo) => photo.url).filter((url) => !url.startsWith("/"));
  if (urls.length === 0) return;

  const nameAt = (url: string): string => {
    const index = urls.indexOf(url);
    const suffix = urls.length > 1 ? `_${index + 1}` : "";
    const extension = photos[index]?.format ?? "jpeg";
    return `Redly_${safeId(videoId)}${suffix}.${extension}`;
  };

  if (urls.length === 1) {
    await sendPhotoWithFallback(deps, chatId, urls[0], nameAt(urls[0]), caption);
    return;
  }

  // Álbums de hasta 10 fotos; si Telegram rechaza el grupo (p. ej. no baja
  // alguna URL), cada foto del bloque se envía una a una con su fallback.
  for (let start = 0; start < urls.length; start += MEDIA_GROUP_SIZE) {
    const chunk = urls.slice(start, start + MEDIA_GROUP_SIZE);
    const chunkCaption = start === 0 ? caption : null;
    if (chunk.length === 1) {
      await sendPhotoWithFallback(deps, chatId, chunk[0], nameAt(chunk[0]), chunkCaption);
      continue;
    }
    try {
      await deps.api.sendMediaGroup(chatId, chunk, chunkCaption);
    } catch {
      for (const url of chunk) {
        await sendPhotoWithFallback(deps, chatId, url, nameAt(url), null);
      }
    }
  }
}

async function sendPhotoWithFallback(
  deps: BotDeps,
  chatId: number,
  url: string,
  filename: string,
  caption: string | null,
): Promise<void> {
  try {
    await deps.api.sendPhoto(chatId, { url }, { caption });
    return;
  } catch (error) {
    if (error instanceof TelegramApiError && error.statusCode === 429) throw error;
  }

  const { blob } = await fetchBounded(deps, url);
  try {
    await deps.api.sendPhoto(chatId, { file: { blob, filename } }, { caption });
  } catch {
    throw new DownloadError("Telegram no pudo recibir una de las fotos. Inténtalo de nuevo.");
  }
}

// ---------------------------------------------------------------------------
// Descarga con tope de bytes (para la subida de respaldo)
// ---------------------------------------------------------------------------

/**
 * Descarga el archivo vía `deps.fetchFile` y comprueba el tope de bytes.
 *
 * El límite se aplica también al `Blob` recibido: una implementación que no
 * lo respete (o un CDN que mienta con `Content-Length`) no debe poder agotar
 * la memoria de la función.
 */
async function fetchBounded(
  deps: BotDeps,
  url: string,
): Promise<{ blob: Blob; contentType: string | null }> {
  const file = await deps.fetchFile(url);
  if (file.blob.size > deps.maxFileBytes) throw tooBigError(deps.maxFileBytes);
  return file;
}

/**
 * Descarga por defecto (la que usa `createBotDeps`): `openStream` del repo,
 * con `Content-Length` declarado y lectura del stream bajo el tope.
 */
async function downloadFileBounded(
  url: string,
  maxBytes: number,
): Promise<{ blob: Blob; contentType: string | null }> {
  const download = await openStream(url);
  if (download.contentLength !== null && download.contentLength > maxBytes) {
    throw tooBigError(maxBytes);
  }

  const reader = download.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooBigError(maxBytes);
    }
    chunks.push(value);
  }
  return {
    blob: new Blob(chunks as BlobPart[], { type: download.contentType ?? undefined }),
    contentType: download.contentType,
  };
}

function tooBigError(maxBytes: number): DownloadError {
  const mb = Math.round(maxBytes / (1024 * 1024));
  return new DownloadError(`El archivo supera el límite de Telegram (${mb} MB).`);
}

// ---------------------------------------------------------------------------
// Resolución de URLs relativas (lo que la web pediría a /api/*)
// ---------------------------------------------------------------------------

/**
 * Convierte una URL relativa devuelta por una fuente en la URL directa del
 * CDN, con las mismas funciones que usan las rutas `/api/merge` y
 * `/api/render` (sin hacer HTTP interno).
 */
export async function resolvePreparedUrl(relativeUrl: string): Promise<string> {
  const url = new URL(relativeUrl, "http://redly.local");
  const path = url.pathname;

  if (path === "/api/merge") {
    const yt = url.searchParams.get("yt") ?? "";
    const v = url.searchParams.get("v") ?? "";
    const a = url.searchParams.get("a") ?? "";
    return prepareMergedDownload(yt, v, a);
  }

  if (path === "/api/render") {
    const job = url.searchParams.get("job") ?? "";
    const source = (url.searchParams.get("source") ?? "").trim().toLowerCase();
    if (source === "ilovex") return (await resolveIlovexRenderJob(job)).url;
    if (source === "savethreads") return (await resolveSavethreadsRenderJob(job)).url;
    return (await resolveRenderJob(job)).url;
  }

  throw new DownloadError("URL de preparación no reconocida.");
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Título como caption, recortado al límite de la Bot API. */
function captionFor(title: string | null | undefined): string | null {
  const value = (title ?? "").trim();
  if (!value) return null;
  return value.length > CAPTION_LIMIT ? `${value.slice(0, CAPTION_LIMIT - 1)}…` : value;
}

/** Id de archivo seguro (`Redly_<id>.mp4`); sin id razonable, `video`. */
function safeId(videoId: string | null | undefined): string {
  return videoId && /^[A-Za-z0-9_-]{6,}$/.test(videoId) ? videoId : "video";
}

/** Mensaje amable para el usuario a partir del error capturado. */
function friendlyError(error: unknown): string {
  if (error instanceof UnavailableError) return error.message;
  if (error instanceof DownloadError) return error.message;
  if (error instanceof TelegramApiError) return SERVICE_ERROR_TEXT;
  if (error instanceof RedlyError) return SERVICE_ERROR_TEXT;
  return SERVICE_ERROR_TEXT;
}

/** Envío best-effort: si avisar al usuario falla, el error se traga. */
async function safeSend(deps: BotDeps, chatId: number, text: string): Promise<void> {
  try {
    await deps.api.sendMessage(chatId, text);
  } catch {
    // Sin red o chat bloqueado: nada más que hacer.
  }
}
