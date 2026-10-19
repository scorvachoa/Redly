/**
 * Cliente de listados de YouTube vía YTMP3.gg.
 *
 * El descargador de listas del sitio (`media.ytmp3.gg`) pobla su buscador con
 * la API pública de metadatos `yt-meta.convert1s.com`. Verificado empíricamente
 * sin clave, sin WAF, sin Turnstile y sin cuenta:
 *
 * 1. `GET /playlist?id=<PL…>` → `{ nextPageToken?, items }`, con hasta **100**
 *    vídeos por página. Cada ítem trae `id`, `title`, `channel` y `thumbnail`
 *    (miniatura de `i.ytimg.com`).
 * 2. `pageToken` es un **token opaco** de continuación: se devuelve tal cual en
 *    la petición siguiente (`&pageToken=…`). Si no hay más páginas, la clave
 *    `nextPageToken` no aparece (o es nula).
 * 3. Un id inválido o inaccesible responde `500` con cuerpo de texto plano.
 *
 * El servicio **no** expone el título de la lista ni su total. El título se
 * recupera a mano de la propia página pública de YouTube (`og:title`, mejor
 * esfuerzo) para no perder la experiencia de la tarjeta; si esa ida falla, la
 * UI degrada a un texto genérico. El canal se deduce del primer vídeo listado.
 *
 * Sólo sirve de **listado**: la descarga de cada vídeo se resuelve después con
 * SnapYT (pipeline de vídeo suelto), igual que antes con la extracción plana.
 */

import {
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  TRANSIENT_HTTP_STATUSES,
  YT_YTMP3_HEADERS,
  YT_YTMP3_META_BASE_URL,
  YT_YTMP3_PLAYLIST_PATH,
} from "./config";
import { RequestError } from "./exceptions";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import type { ProfileVideo } from "./models";

/** Un vídeo devuelto por la API de metadatos de YTMP3. */
export interface YTMP3Item {
  id: string;
  title?: string | null;
  channel?: string | null;
  thumbnail?: string | null;
}

/** Página cruda de `GET /playlist`. */
export interface YTMP3Page {
  items: YTMP3Item[];
  /** Token opaco de continuación; `null` cuando no hay más páginas. */
  nextPageToken: string | null;
}

/** Página ya mapeada al modelo de la app. */
export interface YTMP3PlaylistPage {
  items: ProfileVideo[];
  nextPageToken: string | null;
  /** Título de la lista (mejor esfuerzo desde la página de YouTube). */
  title: string | null;
}

/** URL `watch` canónica de un vídeo a partir de su id. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Mapea un ítem del servicio al modelo `ProfileVideo`.
 *
 * `url` y `postUrl` apuntan al watch URL: la descarga por lotes resuelve la
 * calidad vía `/api/search` (SnapYT) usando `postUrl`.
 */
export function toProfileVideo(item: YTMP3Item): ProfileVideo {
  const url = watchUrl(item.id);
  return {
    id: item.id,
    title: item.title ?? null,
    channel: item.channel ?? null,
    thumbnail: item.thumbnail ?? null,
    url,
    postUrl: url,
  };
}

/** GET con reintentos ante estados transitorios; devuelve el JSON parseado. */
async function fetchJson(url: string): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: "GET",
        headers: headersInit(YT_YTMP3_HEADERS),
      });
      if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
        lastError = new RequestError(`YTMP3 respondió HTTP ${response.status}.`);
      } else if (response.status >= 400) {
        throw new RequestError(`YTMP3 respondió HTTP ${response.status}.`, {
          retryable: false,
        });
      } else {
        try {
          return await response.json();
        } catch {
          throw new RequestError("YTMP3 devolvió una respuesta no JSON.", {
            retryable: false,
          });
        }
      }
    } catch (error) {
      if (error instanceof RequestError && !error.retryable) throw error;
      lastError =
        error instanceof RequestError
          ? error
          : new RequestError(
              `Error de red contra YTMP3 (${(error as Error)?.name ?? "Error"}).`,
            );
    }
    if (attempt < RETRY_ATTEMPTS - 1) {
      await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
    }
  }
  throw lastError ?? new RequestError("YTMP3 no respondió.");
}

/** Valida la forma de la página cruda (se tolera `items` ausente). */
function validatePage(body: unknown): YTMP3Page {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RequestError("Respuesta inesperada de YTMP3.", { retryable: false });
  }
  const record = body as Record<string, unknown>;
  const rawItems = Array.isArray(record.items) ? (record.items as YTMP3Item[]) : [];
  const items = rawItems.filter((item) => typeof item?.id === "string" && item.id);
  const token = record.nextPageToken;
  return {
    items,
    nextPageToken: typeof token === "string" && token ? token : null,
  };
}

/** Pide una página de la lista al servicio de metadatos. */
async function fetchPlaylistPage(
  playlistId: string,
  pageToken?: string | null,
): Promise<YTMP3Page> {
  const url = new URL(`${YT_YTMP3_META_BASE_URL}${YT_YTMP3_PLAYLIST_PATH}`);
  url.searchParams.set("id", playlistId);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  return validatePage(await fetchJson(url.toString()));
}

/** Decodifica las entidades HTML básicas del `og:title`. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Lee el `og:title` de un HTML (tolerante al orden de atributos). */
function parseOgTitle(html: string): string | null {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/property\s*=\s*["']og:title["']/i.test(tag)) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content?.trim()) return decodeEntities(content).trim();
  }
  return null;
}

/**
 * Título de la lista desde la propia página pública de YouTube (mejor esfuerzo).
 *
 * `yt-meta` no lo aporta, así que se lee el `og:title` de
 * `youtube.com/playlist?list=…`. Cualquier fallo (red, muro, cambio de
 * marcado) devuelve `null`: el listado no debe caerse por el título.
 */
async function fetchPlaylistTitle(playlistId: string): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`,
      {
        method: "GET",
        headers: headersInit({
          "User-Agent": YT_YTMP3_HEADERS["User-Agent"],
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+1",
        }),
      },
    );
    if (!response.ok) return null;
    return parseOgTitle(await response.text());
  } catch {
    return null;
  }
}

/**
 * Lista una página de una lista de reproducción.
 *
 * `pageToken` (`null`/ausente en la primera página) es el token opaco que
 * devolvió la petición anterior. En la primera página se recupera además, en
 * paralelo, el título de la lista para la tarjeta de resultado.
 */
export async function listPlaylistItems(
  playlistId: string,
  pageToken?: string | null,
): Promise<YTMP3PlaylistPage> {
  const pagePromise = fetchPlaylistPage(playlistId, pageToken);
  const titlePromise = pageToken
    ? Promise.resolve(null)
    : fetchPlaylistTitle(playlistId).catch(() => null);
  const [page, title] = await Promise.all([pagePromise, titlePromise]);
  return {
    items: page.items.map(toProfileVideo),
    nextPageToken: page.nextPageToken,
    title,
  };
}
