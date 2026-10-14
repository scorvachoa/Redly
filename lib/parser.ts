/**
 * Parser del HTML devuelto por `POST /api/ajaxSearch`.
 *
 * Port de `app/parser.py` a Cheerio. El HTML de TikVid/SavTikPro puede cambiar,
 * así que cada dato se busca con una lista de selectores priorizados y, si
 * ninguno funciona, se devuelve `null` en lugar de lanzar un error.
 */

import type { AnyNode } from "domhandler";
import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";

import {
  DOWNLOAD_TEXT_PATTERN,
  EXCLUDED_DOWNLOAD_CLASSES,
  FORMAT_PATTERN,
  SELECTORS,
  TIKTOK_VIDEO_ID_PATTERN,
  TIKVID_BASE_URL,
} from "./config";
import type { DownloadOption, TikTokResult } from "./models";

const WHITESPACE_RE = /\s+/g;

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\xa0/g, " ").replace(WHITESPACE_RE, " ").trim();
  return cleaned || null;
}

function selectFirst($: cheerio.CheerioAPI, selectors: readonly string[]): Cheerio<AnyNode> | null {
  for (const selector of selectors) {
    try {
      const found = $(selector).first();
      if (found.length > 0) return found as Cheerio<AnyNode>;
    } catch {
      // Selector inválido: el HTML de TikVid puede cambiar.
    }
  }
  return null;
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, TIKVID_BASE_URL).toString();
  } catch {
    return value;
  }
}

/** Extrae metadatos y opciones de descarga del HTML de `ajaxSearch`. */
export function parseSearchHtml(html: string): TikTokResult {
  const $ = cheerio.load(html || "");
  const result: TikTokResult = {
    videoId: extractVideoId($),
    title: extractTitle($),
    thumbnail: extractThumbnail($),
    downloads: extractDownloads($),
  };
  return result;
}

// ---------------------------------------------------------------------------
// Título
// ---------------------------------------------------------------------------
function extractTitle($: cheerio.CheerioAPI): string | null {
  const node = selectFirst($, SELECTORS.title);
  if (!node) return null;
  return cleanText(node.text());
}

// ---------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------
function extractThumbnail($: cheerio.CheerioAPI): string | null {
  const node = selectFirst($, SELECTORS.thumbnail);
  if (!node) return null;
  const tag = node.is("video") ? node.attr("poster") : node.attr("src");
  const raw = tag || node.attr("data-src") || node.attr("data-original");
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value.startsWith("data:")) return null;
  return absoluteUrl(value);
}

// ---------------------------------------------------------------------------
// ID del vídeo
// ---------------------------------------------------------------------------
function extractVideoId($: cheerio.CheerioAPI): string | null {
  for (const selector of SELECTORS.videoIdInput) {
    let node: Cheerio<AnyNode> | null;
    try {
      node = $(selector).first() as Cheerio<AnyNode>;
    } catch {
      continue;
    }
    if (!node || node.length === 0) continue;
    const value = node.attr("value") || node.attr("data-value");
    if (value && /^\d+$/.test(value.trim())) return value.trim();
  }

  for (const anchor of $("a[href]").toArray()) {
    const href = $(anchor).attr("href") ?? "";
    const match = TIKTOK_VIDEO_ID_PATTERN.exec(href);
    if (match) return match[1];
  }

  for (const element of $("*").toArray()) {
    for (const attr of ["data-video-id", "data-item-id", "data-id"]) {
      const value = $(element).attr(attr);
      if (value && /^\d+$/.test(value.trim())) return value.trim();
    }
  }

  const match = TIKTOK_VIDEO_ID_PATTERN.exec($.root().text());
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Opciones de descarga
// ---------------------------------------------------------------------------
function extractDownloads($: cheerio.CheerioAPI): DownloadOption[] {
  const anchors = collectDownloadAnchors($);
  const options: DownloadOption[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors) {
    const el = $(anchor);
    const rawHref = hrefOf(el);
    if (!rawHref) continue;
    const url = absoluteUrl(rawHref);
    if (seen.has(url)) continue;
    seen.add(url);

    const name = cleanText(el.text()) || "Download";
    options.push({
      name,
      url,
      format: inferFormat(name, url),
      quality: inferQuality(name),
    });
  }

  return options;
}

function collectDownloadAnchors($: cheerio.CheerioAPI): AnyNode[] {
  for (const selector of SELECTORS.downloadPrimary) {
    let found: AnyNode[];
    try {
      found = $(selector).toArray();
    } catch {
      continue;
    }
    const usable = found.filter((anchor) => isDownloadAnchor($, anchor));
    if (usable.length > 0) return usable;
  }

  const hrefHosts = SELECTORS.downloadHrefHosts;
  const fallback: AnyNode[] = [];
  for (const anchor of $("a[href]").toArray()) {
    const href = ($(anchor).attr("href") || "").toLowerCase();
    if (hrefHosts.some((host) => href.includes(host)) && isDownloadAnchor($, anchor)) {
      fallback.push(anchor);
    }
  }
  if (fallback.length > 0) return fallback;

  // Último recurso: cualquier enlace cuyo texto parezca un botón de descarga.
  const lastResort: AnyNode[] = [];
  for (const anchor of $("a[href]").toArray()) {
    const text = cleanText($(anchor).text()) || "";
    if (DOWNLOAD_TEXT_PATTERN.test(text) && isDownloadAnchor($, anchor)) {
      lastResort.push(anchor);
    }
  }
  return lastResort;
}

function isDownloadAnchor($: cheerio.CheerioAPI, anchor: AnyNode): boolean {
  const el = $(anchor);
  const href = (el.attr("href") || "").trim();
  if (!href || href.startsWith("#") || href.startsWith("/") || href.startsWith("javascript:") || href.startsWith("data:")) {
    return false;
  }
  if (!/^https?:\/\//i.test(href)) return false;
  const classes = (el.attr("class") || "").toLowerCase();
  if (EXCLUDED_DOWNLOAD_CLASSES.some((excluded) => classes.includes(excluded))) {
    return false;
  }
  // Excluir el enlace del popup de reproducción si estuviera presente.
  if (el.closest("#popup_play").length > 0) return false;
  return true;
}

function hrefOf(el: Cheerio<AnyNode>): string | null {
  for (const attr of ["href", "data-href", "data-url"]) {
    const value = el.attr(attr);
    if (value) return value.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formato y calidad a partir del texto del botón
// ---------------------------------------------------------------------------
function inferFormat(name: string, url: string): string | null {
  const match = FORMAT_PATTERN.exec(name);
  if (match) return match[1].toLowerCase();
  const lowered = url.toLowerCase();
  for (const candidate of ["mp4", "mp3", "m4a", "aac", "webm", "wav"]) {
    if (lowered.includes(`.${candidate}`)) return candidate;
  }
  if (lowered.includes("mime_type=video")) return "mp4";
  if (lowered.includes("mime_type=audio")) return "mp3";
  return null;
}

function inferQuality(name: string): string | null {
  const lowered = name.toLowerCase();
  if (lowered.includes("mp3") || lowered.includes("audio") || lowered.includes("m4a")) {
    return "audio";
  }
  if (/\b(hd|1080|720|fullhd)\b/.test(lowered)) return "hd";
  if (/\b(sd|480|360)\b/.test(lowered)) return "sd";
  if (lowered.includes("mp4") || lowered.includes("video")) return "standard";
  return null;
}
