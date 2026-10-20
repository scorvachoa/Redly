/**
 * Clasificación y normalización de URLs de X (Twitter).
 *
 * Homólogo de `lib/facebook-urls.ts` para la fuente de X (`lib/ilovex.ts`):
 * aquí sólo se decide **qué clase de URL es** (tweet, perfil) — la resolución
 * del contenido es cosa del servicio.
 *
 * Patrones verificados empíricamente contra iLoveX: `/usuario/status/<id>` y
 * `/i/status/<id>`, tanto en `x.com` como en `twitter.com` (el servicio acepta
 * ambos dominios y también las variantes `www.`/`mobile.`). Los enlaces cortos
 * `t.co` **no** se clasifican como tweet: pueden apuntar a un perfil u otra
 * cosa, y resolverlos exigiría seguir la redirección (fuera del alcance
 * verificado).
 *
 * Sin imports de Node: el navegador (destino de descargas) también lo usa.
 */

/** Dominios de X/Twitter (cualquier subdominio: `www.`, `mobile.`…). */
const X_HOSTS = ["x.com", "twitter.com"];

/** Segmentos iniciales reservados: no cuentan como perfil. */
const RESERVED_PATHS = new Set([
  "i",
  "home",
  "explore",
  "search",
  "notifications",
  "messages",
  "compose",
  "settings",
  "login",
  "logout",
  "signup",
  "tos",
  "privacy",
  "about",
  "help",
  "jobs",
  "verified",
  "intent",
  "share",
  "hashtag",
  "topic",
  "topics",
  "lists",
  "bookmarks",
  "communities",
  "premium",
  "follower_requests",
]);

/** ¿La URL (ya normalizada) es de X/Twitter? Coincide por host. */
export function isTwitterUrl(url: string | null | undefined): boolean {
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
  return X_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/**
 * Identificador del tweet al que apunta la URL, o `null` si no es un tweet.
 *
 * Se aceptan las formas habituales: `/<usuario>/status/<id>` (con o sin
 * segmentos de foto al final, p. ej. `/photo/1`) y `/i/status/<id>`.
 */
export function extractTweetId(url: string | null | undefined): string | null {
  if (!isTwitterUrl(url)) return null;
  const parsed = new URL((url as string).trim());
  const segments = parsed.pathname.split("/").filter(Boolean);
  const statusIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "status" || segment.toLowerCase() === "statuses",
  );
  if (statusIndex < 0) return null;
  const id = segments[statusIndex + 1] ?? "";
  return /^\d{5,25}$/.test(id) ? id : null;
}

/** ¿Es la URL de un tweet concreto (cualquier formato de enlace)? */
export function isTweetUrl(url: string | null | undefined): boolean {
  return extractTweetId(url) !== null;
}

/**
 * ¿Es la URL de un perfil (`x.com/<usuario>`)?
 *
 * Sólo se considera perfil una ruta única no reservada: el resto (búsquedas,
 * hashtags, ajustes) clasifica como `unsupported` en `lib/urlrules.ts`.
 */
export function isTwitterProfileUrl(url: string | null | undefined): boolean {
  if (!isTwitterUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return false;
  return !RESERVED_PATHS.has(segments[0].toLowerCase());
}

/**
 * Entrada libre del usuario → URL normalizada.
 *
 * Acepta la URL a secas (`x.com/user/status/123`), como hace Facebook.
 */
export function inputToTwitterUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(?:[a-z0-9-]+\.)?(?:x\.com|twitter\.com)\//i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}
