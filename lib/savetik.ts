/**
 * Fuente de listados de perfil vía SavTikPro.
 *
 * El endpoint `POST /api/ajaxSearch` de savetikpro (misma familia de producto
 * que TikVid, build más nueva) devuelve:
 *
 * - `pageType="detail"` para un vídeo único  -> se parsea con el parser existente.
 * - `pageType="profile"` para un perfil, con `data` (HTML con tarjetas
 *   `.video-item`) y `next_cursor` para paginar.
 *
 * Descubrimiento sin API documentada: se envía la misma forma de payload que
 * TikVid (`q`, `cursor`, `page`, `lang`). Reglas verificadas empíricamente:
 *
 * - `cursor` vacío produce `404 Video not found` (sólo la primera página usa `0`).
 * - La URL de perfil **no** debe llevar barra final.
 * - Las URLs de descarga son tokens JWT de `pro.snapcdn.app` con caducidad de
 *   ~1 hora: se usan en el momento y **nunca** se guardan ni se registran.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { createHash } from "node:crypto";

import {
  PROFILE_FORMAT_PATTERN,
  PROFILE_SELECTORS,
  PROFILE_VIDEO_ID_PATTERN,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  SAVETIK_AJAX_SEARCH_URL,
  SAVETIK_BASE_URL,
  SAVETIK_HEADERS,
  SAVETIK_HOME_PATH,
  SAVETIK_LANG,
  TRANSIENT_HTTP_STATUSES,
} from "./config";
import { TikVidClient } from "./client";
import { RedlyError, RequestError, UnavailableError } from "./exceptions";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import type { ProfileVideo, TikTokResult } from "./models";
import { parseSearchHtml } from "./parser";
import { buildVideoUrl, isProfileUrl, normalizeTikTokUrl } from "./urls";

/**
 * Metadatos del listado en sí (no de cada vídeo).
 *
 * TikTok no los aporta hoy; las listas de YouTube sí (título del `og:title` de
 * YouTube y canal deducido del primer vídeo, vía YTMP3). La UI los usa para
 * titular la tarjeta de resultado; si no llegan, se recurre a un texto genérico.
 */
export interface ProfileMeta {
  /** Título del perfil o de la lista. */
  title?: string | null;
  /** Canal o usuario responsable del listado. */
  channel?: string | null;
  /** Nº total de elementos del listado (puede superar los ya recopilados). */
  total?: number | null;
}

/** Resultado de una única petición de listado (una página del perfil). */
export interface ProfilePage {
  items: ProfileVideo[];
  /** Cursor para pedir la página siguiente, o `null` si no hay más. */
  nextCursor: string | null;
  /** Página que acaba de devolverse. */
  page: number;
  /** Datos del listado; sólo en la primera página suelen aportarse. */
  meta?: ProfileMeta | null;
}

/** Primera página de un perfil: así empieza siempre el cursor. */
export const FIRST_PAGE_CURSOR = "0";

  /** Clave estable para el historial SIN almacenar la URL del token. */
export function anonymousKey(url: string): string {
  return createHash("sha1").update(url, "utf8").digest("hex").slice(0, 16);
}

/**
 * Completa un ítem del listado con la URL de su propio post.
 *
 * El listado sólo trae el enlace del MP4 estándar; para descargar a máxima
 * calidad hay que analizar el post, y eso necesita esta URL. Si no se puede
 * construir (identificador no numérico o entrada que no es un perfil), se
 * devuelve el ítem tal cual.
 */
function withPostUrl(profileUrl: string, item: ProfileVideo): ProfileVideo {
  const postUrl = buildVideoUrl(profileUrl, item.id);
  return postUrl ? { ...item, postUrl } : item;
}

export class SavetikSource {
  /** Identificador estable del contrato `ContentSource` (`lib/sources.ts`). */
  readonly id = "savetikpro";
  /** Plataformas que esta fuente sabe servir. */
  readonly platforms = ["tiktok"] as const;

  private readonly parser: typeof parseSearchHtml;
  private warmed = false;

  constructor(parser: typeof parseSearchHtml = parseSearchHtml) {
    this.parser = parser;
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  /** Busca un vídeo único; devuelve el mismo modelo que el cliente de TikVid. */
  async searchVideo(url: string): Promise<TikTokResult> {
    const target = normalizeTikTokUrl(url);
    const body = await this.post(target, null, "1");
    const html = typeof body.data === "string" ? body.data : "";
    if (!html.trim()) {
      throw new UnavailableError("El servicio no devolvió datos para esa URL.");
    }
    const result = this.parser(html);
    if (result.downloads.length === 0) {
      throw new UnavailableError("No se encontraron opciones de descarga.");
    }
    return result;
  }

  /**
   * Pide **una sola página** de un perfil y devuelve el cursor para la
   * siguiente. Pensada para paginar desde fuera (la API web), de modo que cada
   * invocación de la función sea corta y no se choque con `maxDuration`.
   *
   * `cursor` nulo o vacío se normaliza a `"0"`: SavTikPro responde `404` con un
   * cursor vacío (verificado empíricamente).
   */
  async listProfilePage(
    url: string,
    cursor: string | null = null,
    page = 1,
    limit?: number,
  ): Promise<ProfilePage> {
    const target = normalizeTikTokUrl(url);
    if (!isProfileUrl(target)) {
      throw new RequestError("Esa URL no parece la de un perfil de TikTok.");
    }

    const from = cursor === null || cursor === undefined || cursor.trim() === ""
      ? FIRST_PAGE_CURSOR
      : cursor.trim();
    const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;

    const body = await this.post(target, from, String(safePage));
    const html = typeof body.data === "string" ? body.data : "";
    // Sin HTML no hay tarjetas ni sentido en pedir otra página.
    if (!html.trim()) {
      return { items: [], nextCursor: null, page: safePage };
    }

    const max = limit && limit > 0 ? Math.floor(limit) : null;
    const items: ProfileVideo[] = [];
    const seen = new Set<string>();
    for (const item of this.parseCards(html)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(withPostUrl(target, item));
      if (max !== null && items.length >= max) break;
    }

    const nextRaw = body.next_cursor;
    let nextCursor: string | null = null;
    if (nextRaw !== undefined && nextRaw !== null && String(nextRaw).trim() !== "") {
      const next = String(nextRaw).trim();
      // Protección: si el servicio devuelve el mismo cursor, el bucle sería eterno.
      nextCursor = next === from ? null : next;
    }

    return { items, nextCursor, page: safePage };
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async post(q: string, cursor: string | null, page: string): Promise<Record<string, unknown>> {
    if (!this.warmed) await this.warmUp();

    const payload = new URLSearchParams({ q, page, lang: SAVETIK_LANG });
    if (cursor !== null) payload.set("cursor", cursor);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await fetchWithTimeout(
          SAVETIK_AJAX_SEARCH_URL,
          { method: "POST", headers: headersInit(SAVETIK_HEADERS), body: payload },
        );

        if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
          lastError = new RequestError(`SavTikPro respondió HTTP ${response.status}.`);
        } else if (response.status === 404) {
          throw new UnavailableError("El contenido solicitado no existe o es privado.");
        } else if (response.status >= 400) {
          throw new RequestError(`SavTikPro respondió HTTP ${response.status}.`);
        } else {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            lastError = new RequestError("SavTikPro devolvió una respuesta no JSON.");
          }
          if (body !== undefined) return this.validateBody(body);
        }
      } catch (error) {
        if (error instanceof UnavailableError || error instanceof RequestError) {
          if (error instanceof UnavailableError) throw error;
          lastError = error;
        } else {
          lastError = new RequestError(
            `Error de red contra SavTikPro (${(error as Error)?.name ?? "Error"}).`,
          );
        }
      }

      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
      }
    }

    throw lastError ?? new RequestError("SavTikPro no respondió.");
  }

  private validateBody(body: unknown): Record<string, unknown> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new RequestError("Respuesta inesperada de SavTikPro.");
    }
    const record = body as Record<string, unknown>;
    const status = String(record.status ?? "").toLowerCase();
    if (status !== "ok" && status !== "") {
      const message = String(record.message ?? record.msg ?? "").trim();
      throw new UnavailableError(message || "SavTikPro no encontró el contenido solicitado.");
    }
    return record;
  }

  /** Visita la página inicial (misma práctica que el navegador). No es fatal. */
  private async warmUp(): Promise<void> {
    try {
      await fetchWithTimeout(
        new URL(SAVETIK_HOME_PATH, SAVETIK_BASE_URL).toString(),
        { headers: { "User-Agent": SAVETIK_HEADERS["User-Agent"] } },
      );
    } catch {
      // El POST puede funcionar aunque el warm-up falle.
    }
    this.warmed = true;
  }

  // -------------------------------------------------------------------------
  // Tarjetas de perfil
  // -------------------------------------------------------------------------

  private parseCards(html: string): ProfileVideo[] {
    const $ = cheerio.load(html || "");
    const items: ProfileVideo[] = [];
    // Cada selectro tiene respaldo: si SavTikPro renombra una clase, se sigue
    // extrayendo en lugar de devolver una lista vacía en silencio.
    const cards = firstNonEmpty($, PROFILE_SELECTORS.card, $.root());
    cards.each((_index, card) => {
      const item = this.cardToVideo($, card);
      if (item) items.push(item);
    });
    return items;
  }

  private cardToVideo($: cheerio.CheerioAPI, card: AnyNode): ProfileVideo | null {
    const container = $(card);
    const anchor = firstNonEmpty($, PROFILE_SELECTORS.link, container).first();
    if (anchor.length === 0) return null;

    let rawHref = (anchor.attr("href") || "").trim();
    if (rawHref && !/^https?:\/\//i.test(rawHref)) {
      rawHref = new URL(rawHref, SAVETIK_BASE_URL).toString();
    }
    if (!rawHref) return null;

    const dataName = anchor.attr("data-name") || "";
    const idMatch = PROFILE_VIDEO_ID_PATTERN.exec(dataName) ?? PROFILE_VIDEO_ID_PATTERN.exec(rawHref);
    const videoId = idMatch ? idMatch[1] : anonymousKey(rawHref);

    const extMatch = PROFILE_FORMAT_PATTERN.exec(dataName);
    const format = extMatch ? extMatch[1].toLowerCase() : "mp4";

    return {
      id: videoId,
      title: firstText($, PROFILE_SELECTORS.title, container),
      channel: firstText($, PROFILE_SELECTORS.channel, container),
      views: firstText($, PROFILE_SELECTORS.views, container),
      thumbnail: firstAttr($, PROFILE_SELECTORS.thumb, container, "src"),
      url: rawHref,
      format,
    };
  }
}

/**
 * Devuelve el primer conjunto no vacío que produzca alguna selección.
 *
 * `context` es el nodo raíz de búsqueda: `$.root()` para el documento entero o
 * el contenedor de una tarjeta concreta.
 */
function firstNonEmpty(
  $: cheerio.CheerioAPI,
  selectors: readonly string[],
  context: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  for (const selector of selectors) {
    const found = context.find(selector);
    if (found.length > 0) return found;
  }
  return $();
}

/** Texto del primer selector que devuelva algo con contenido. */
function firstText(
  $: cheerio.CheerioAPI,
  selectors: readonly string[],
  context: cheerio.Cheerio<AnyNode>,
): string | null {
  for (const selector of selectors) {
    const text = clean(context.find(selector).first().text());
    if (text) return text;
  }
  return null;
}

/** Atributo del primer selector que devuelva algo con valor. */
function firstAttr(
  $: cheerio.CheerioAPI,
  selectors: readonly string[],
  context: cheerio.Cheerio<AnyNode>,
  attribute: string,
): string | null {
  for (const selector of selectors) {
    const value = clean(context.find(selector).first().attr(attribute));
    if (value) return value;
  }
  return null;
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

// ---------------------------------------------------------------------------
// Fachada: un sólo vídeo con fallback a TikVid
// ---------------------------------------------------------------------------

/**
 * Resuelve un vídeo único: intenta SavTikPro y, si falla, TikVid.
 *
 * `onFallback` se invoca cuando se produce el cambio de fuente (útil para
 * debug/UI); recibe el error que provocó el fallback.
 */
export async function searchAny(
  url: string,
  options: { savetik?: SavetikSource; tikvid?: TikVidClient; onFallback?: (error: RedlyError) => void } = {},
): Promise<TikTokResult> {
  const source = options.savetik ?? new SavetikSource();
  try {
    return await source.searchVideo(url);
  } catch (error) {
    if (!(error instanceof RedlyError)) throw error;
    options.onFallback?.(error);
    const client = options.tikvid ?? new TikVidClient();
    return client.search(url);
  }
}
