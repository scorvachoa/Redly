/**
 * Clasificación y normalización de URLs de Instagram.
 *
 * Homólogo de `lib/facebook-urls.ts` para la fuente de Instagram
 * (`lib/igexport.ts`): aquí sólo se decide **qué clase de URL es** (vídeo,
 * perfil) — la resolución del contenido es cosa del servicio.
 *
 * Patrones verificados empíricamente contra IGExport: `/reel/<código>`,
 * `/reels/<código>`, `/p/<código>` (publicación con vídeo o foto) y sus
 * variantes con prefijo de usuario (`/<usuario>/reel/<código>`), con query
 * (`?igsh=…`) y sin barra final. Los códigos observados tienen 11 caracteres
 * (`A-Za-z0-9_-`); se admite desde 5 por margen. Si el código no existe, el
 * servicio responde con su propio error, que la fuente convierte en
 * `UnavailableError`.
 *
 * Sin imports de Node: el navegador (destino de descargas) también lo usa.
 */

/** Dominios de Instagram (cualquier subdominio: `www.`, `m.`, `web.`…). */
const IG_HOSTS = ["instagram.com", "instagr.am"];

/** Segmentos de publicación (todos admiten el mismo flujo de resolución). */
const POST_PATHS = new Set(["reel", "reels", "p", "tv"]);

/** Segmentos inicial reservado: no cuenta como perfil. */
const RESERVED_PATHS = new Set([
  ...POST_PATHS,
  "stories",
  "story",
  "explore",
  "share",
  "share_reel",
  "direct",
  "accounts",
  "login",
  "logout",
  "about",
  "developer",
  "legal",
  "web",
  "api",
  "settings",
  "help",
  "challenge",
  "email",
  "embed",
  "archives",
  "terms",
  "privacy",
]);

/** Códigos de publicación de Instagram (`A-Za-z0-9_-`). */
const SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{5,}$/;

/** ¿La URL (ya normalizada) es de Instagram? Coincide por host. */
export function isInstagramUrl(url: string | null | undefined): boolean {
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
  return IG_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/**
 * Código (shortcode) de la publicación a la que apunta la URL, o `null`.
 *
 * Se aceptan las formas habituales: `/reel|reels|p|tv/<código>`,
 * `/<usuario>/(reel|reels|p|tv)/<código>` y los enlaces de comentarios
 * `/p/<código>/c/<id>/`.
 */
export function extractInstagramPostId(url: string | null | undefined): string | null {
  if (!isInstagramUrl(url)) return null;
  const parsed = new URL((url as string).trim());
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const head = (segments[0] ?? "").toLowerCase();
  if (POST_PATHS.has(head)) {
    const code = segments[1] ?? "";
    return SHORTCODE_PATTERN.test(code) ? code : null;
  }

  // Variante con prefijo de usuario: `/<usuario>/reel/<código>`.
  if (segments.length >= 3 && POST_PATHS.has((segments[1] ?? "").toLowerCase())) {
    const code = segments[2] ?? "";
    return SHORTCODE_PATTERN.test(code) ? code : null;
  }
  return null;
}

/** ¿Es la URL de una publicación concreta (vídeo o foto)? */
export function isInstagramPostUrl(url: string | null | undefined): boolean {
  return extractInstagramPostId(url) !== null;
}

/**
 * ¿Es la URL de un perfil (`instagram.com/<usuario>`)?
 *
 * Sólo se considera perfil una ruta única no reservada: el resto (historias,
 * explore, secciones) clasifica como `unsupported` en `lib/urlrules.ts`.
 * Los listados de perfil aún no están soportados (`supportsProfiles: false`).
 */
export function isInstagramProfileUrl(url: string | null | undefined): boolean {
  if (!isInstagramUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return false;
  return !RESERVED_PATHS.has(segments[0].toLowerCase());
}

/**
 * Entrada libre del usuario → URL normalizada.
 *
 * Acepta la URL a secas (`instagram.com/reel/…`), como hace TikTok.
 */
export function inputToInstagramUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(?:[a-z0-9-]+\.)?(?:instagram\.com|instagr\.am)\//i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}
