/**
 * Clasificación y normalización de URLs de YouTube.
 *
 * Homólogo de `lib/urls.ts` para la fuente de YouTube (`lib/snapyt.ts`): aquí
 * sólo se decide **qué clase de URL es** (vídeo, canal, lista) — la resolución
 * del contenido es cosa de la fuente.
 *
 * Sin imports de Node: el navegador (destino de descargas) también lo usa.
 */

/**
 * Identificador de vídeo de YouTube: 11 caracteres de `[A-Za-z0-9_-]`
 * (incluye los enlaces cortos, que usan la misma longitud).
 */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Rutas que identifican un canal (todas con su contenido incluido). */
const CHANNEL_PATH_RE = /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(?:\/|$)/i;

/** Validación flexible de URLs de YouTube (cualquier subdominio). */
export function isYouTubeUrl(url: string | null | undefined): boolean {
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
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host.endsWith(".youtu.be")
  );
}

/**
 * Identificador del vídeo que apunta la URL, o `null` si no apunta a uno.
 *
 * Se aceptan las formas habituales: `watch?v=`, enlace corto `youtu.be/<id>`,
 * `/shorts/`, `/embed/`, `/live/` y `/v/`.
 */
export function extractYouTubeVideoId(url: string | null | undefined): string | null {
  if (!isYouTubeUrl(url)) return null;
  const parsed = new URL((url as string).trim());
  const host = parsed.hostname.toLowerCase();

  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    const id = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  const fromQuery = parsed.searchParams.get("v");
  if (fromQuery && VIDEO_ID_RE.test(fromQuery)) return fromQuery;

  const match = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/i.exec(parsed.pathname);
  if (match && VIDEO_ID_RE.test(match[1])) return match[1];
  return null;
}

/** ¿Es la URL de un vídeo concreto (cualquier formato de enlace)? */
export function isYouTubeVideoUrl(url: string | null | undefined): boolean {
  return extractYouTubeVideoId(url) !== null;
}

/** ¿Es la URL de un canal (`@handle`, `/channel/UC…`, `/c/…`, `/user/…`)? */
export function isYouTubeProfileUrl(url: string | null | undefined): boolean {
  if (!isYouTubeUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  return CHANNEL_PATH_RE.test(parsed.pathname);
}

/**
 * ¿Es la URL de una lista de reproducción sin vídeo concreto?
 *
 * `watch?v=<id>&list=<lista>` cuenta como **vídeo**: manda el id. Las listas
 * como tal (`/playlist?list=…`) cuentan como **perfil** (listado).
 */
export function isYouTubePlaylistUrl(url: string | null | undefined): boolean {
  if (!isYouTubeUrl(url)) return false;
  if (isYouTubeVideoUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  return parsed.pathname === "/playlist" || parsed.searchParams.has("list");
}

/**
 * Identificador de la lista que apunta la URL (`list=PL…`), o `null`.
 *
 * Sólo tiene sentido para URLs que ya clasifican como lista
 * (`isYouTubePlaylistUrl`); el resto devuelve `null`.
 */
export function extractYouTubePlaylistId(url: string | null | undefined): string | null {
  if (!isYouTubePlaylistUrl(url)) return null;
  const parsed = new URL((url as string).trim());
  const id = parsed.searchParams.get("list");
  return id && id.trim() ? id.trim() : null;
}

/**
 * Normaliza la entrada antes de clasificarla.
 *
 * YouTube no necesita recortar nada más que los espacios exteriores (a
 * diferencia de TikTok, que rechaza la barra final en perfiles).
 */
export function normalizeYouTubeUrl(url: string): string {
  return (url || "").trim();
}

/**
 * Lee lo que escribe el usuario.
 *
 * Fase 1 (vídeo suelto): sólo se admite la URL completa; los `@handle` de
 * canal se clasificarán como perfil cuando llegue el soporte de canales.
 */
export function inputToYouTubeUrl(value: string): string {
  return normalizeYouTubeUrl(value);
}
