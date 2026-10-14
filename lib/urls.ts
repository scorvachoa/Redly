/**
 * Clasificación y normalización de URLs de TikTok.
 *
 * Port de las funciones auxiliares de `app/client.py` (`is_tiktok_url`,
 * `is_video_url`, `is_profile_url`, `normalize_tiktok_url`,
 * `input_to_profile_url`). Se separan a su propio módulo para evitar
 * dependencias circulares entre el cliente y la fuente de perfiles.
 *
 * Sin imports de Node: el navegador (destino de descargas) también lo usa.
 */

import { sanitizeFolderName } from "./sanitize";

const VIDEO_PATH_RE = /\/(?:video|photo)\/\d{5,30}/i;
const PROFILE_PATH_RE = /^\/@[^/]+\/?$/i;

/** Validación flexible de URLs de TikTok (cualquier subdominio). */
export function isTikTokUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  const host = parsed.hostname.toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}

/** Quita barra final y espacios (algunos backends dan 404 con `/`). */
export function normalizeTikTokUrl(url: string): string {
  const cleaned = (url || "").trim();
  // La raíz exacta (https://www.tiktok.com/) no se toca; el resto pierde la
  // barra final porque savetikpro responde 404 con ella en los perfiles.
  if (cleaned === "https://www.tiktok.com/") return cleaned;
  return cleaned.replace(/\/+$/, "");
}

/** ¿Es la URL de un vídeo concreto (incluidos enlaces cortos)? */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!isTikTokUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  const host = parsed.hostname.toLowerCase();
  if (host.startsWith("vm.") || host.startsWith("vt.")) return true;
  return VIDEO_PATH_RE.test(parsed.pathname);
}

/** ¿Es la URL de un perfil (`@usuario` sin ruta de vídeo)? */
export function isProfileUrl(url: string | null | undefined): boolean {
  if (!isTikTokUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  return PROFILE_PATH_RE.test(parsed.pathname);
}

/** Convierte `@usuario` o una URL de perfil en URL normalizada. */
export function inputToProfileUrl(value: string): string {
  let raw = (value || "").trim();
  if (raw.startsWith("@") && !raw.includes(" ") && !raw.includes("/")) {
    raw = `https://www.tiktok.com/${raw}`;
  }
  return normalizeTikTokUrl(raw);
}

/** Extrae el identificador de un perfil (`@scout2015` → `scout2015`). */
export function profileHandle(url: string | null | undefined): string | null {
  if (!isProfileUrl(url)) return null;
  const parsed = new URL((url as string).trim());
  const match = /^\/@([^/]+)\/?$/i.exec(parsed.pathname);
  return match ? match[1] : null;
}

/**
 * Nombre de carpeta seguro para un perfil (`scout2015` → carpeta `scout2015`).
 * Devuelve `null` si la URL no es de perfil o si el identificador no se puede
 * convertir en un nombre de carpeta válido.
 */
export function profileFolderName(url: string | null | undefined): string | null {
  const handle = profileHandle(url);
  if (!handle) return null;
  const folder = sanitizeFolderName(handle);
  return folder === "perfil" ? null : folder;
}
