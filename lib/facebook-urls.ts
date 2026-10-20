/**
 * Clasificación y normalización de URLs de Facebook.
 *
 * Homólogo de `lib/youtube-urls.ts` para la fuente de Facebook (`lib/fsave.ts`):
 * aquí sólo se decide **qué clase de URL es** (vídeo, perfil) — la resolución
 * del contenido es cosa del servicio.
 *
 * Patrones de vídeo verificados empíricamente contra FSave: `/watch/?v=`,
 * `/reel/<id>`, `/videos/<id>/` y `story.php?story_fbid=…`. Los enlaces cortos
 * `fb.watch/<código>` apuntan siempre a un vídeo (si el código no existe, el
 * servicio responde con su propio error, que la fuente convierte en
 * `UnavailableError`).
 *
 * Sin imports de Node: el navegador (destino de descargas) también lo usa.
 */

/** Dominios de Facebook (cualquier subdominio: `www.`, `m.`, `web.`…). */
const FB_HOSTS = ["facebook.com", "fb.watch", "fb.com"];

/** Claves de query que identifican un vídeo (`story_fbid` en publicaciones). */
const VIDEO_QUERY_KEYS = ["story_fbid", "video_id", "v"];

/** Segmento inicial reservado: no cuenta como perfil (`/watch/`, `/share/…`). */
const RESERVED_PATHS = new Set([
  "watch",
  "videos",
  "video.php",
  "reel",
  "reels",
  "share",
  "story.php",
  "permalink.php",
  "photos",
  "photo.php",
  "pages",
  "groups",
  "marketplace",
  "gaming",
  "settings",
  "help",
  "login",
]);

/** ¿La URL (ya normalizada) es de Facebook? Coincide por host. */
export function isFacebookUrl(url: string | null | undefined): boolean {
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
  return FB_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/**
 * Identificador del contenido al que apunta la URL, o `null` si no es un vídeo.
 *
 * Se aceptan las formas habituales: `watch?v=`, `/reel/<id>`, `/videos/<id>/`,
 * `story.php?story_fbid=…`, `share/v|<r>/…` y los enlaces cortos `fb.watch`.
 */
export function extractFacebookVideoId(url: string | null | undefined): string | null {
  if (!isFacebookUrl(url)) return null;
  const parsed = new URL((url as string).trim());
  const host = parsed.hostname.toLowerCase();

  // Enlaces cortos: el código de la ruta es el identificador usable.
  if (host === "fb.watch" || host.endsWith(".fb.watch")) {
    const code = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    return /^[A-Za-z0-9_-]{3,}$/.test(code) ? code : null;
  }

  for (const key of VIDEO_QUERY_KEYS) {
    const value = parsed.searchParams.get(key);
    if (!value) continue;
    if (key === "v" ? /^[A-Za-z0-9_-]{3,}$/.test(value) : /^\d{5,25}$/.test(value)) {
      return value;
    }
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const head = (segments[0] ?? "").toLowerCase();
  if (head === "reel" || head === "reels" || head === "videos" || head === "share") {
    const id = head === "share" ? (segments[2] ?? "") : (segments[1] ?? "");
    if (/^\d{5,25}$/.test(id) || /^[A-Za-z0-9_-]{3,}$/.test(id)) return id;
    return null;
  }

  // `permalink.php?id=…` (variante de escritorio de `story.php`).
  if (head === "permalink.php") {
    const id = parsed.searchParams.get("id") ?? "";
    if (/^\d{5,25}$/.test(id)) return id;
  }
  return null;
}

/** ¿Es la URL de un vídeo concreto (cualquier formato de enlace)? */
export function isFacebookVideoUrl(url: string | null | undefined): boolean {
  return extractFacebookVideoId(url) !== null;
}

/**
 * ¿Es la URL de un perfil/página (`facebook.com/<nombre>`, `profile.php?id=`)?
 *
 * Sólo se considera perfil una ruta única no reservada: el resto (portadas,
 * búsquedas, secciones) clasifica como `unsupported` en `lib/urlrules.ts`.
 */
export function isFacebookProfileUrl(url: string | null | undefined): boolean {
  if (!isFacebookUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  if (/^\/profile\.php$/i.test(parsed.pathname)) return Boolean(parsed.searchParams.get("id"));
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return false;
  return !RESERVED_PATHS.has(segments[0].toLowerCase());
}

/**
 * Entrada libre del usuario → URL normalizada.
 *
 * Acepta la URL a secas (`facebook.com/watch/?v=…`), como hace TikTok.
 */
export function inputToFacebookUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(?:[a-z0-9-]+\.)?(?:facebook\.com|fb\.watch|fb\.com)\//i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}
