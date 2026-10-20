/**
 * Clasificación y normalización de URLs de Threads.
 *
 * Homólogo de `lib/twitter-urls.ts` para la fuente de Threads
 * (`lib/savethreads.ts`): aquí sólo se decide **qué clase de URL es** (post,
 * perfil) — la resolución del contenido es cosa del servicio.
 *
 * Patrones verificados empíricamente contra SaveThreads: `/@usuario/post/<código>`
 * en `threads.com` y `threads.net` (el servicio acepta ambos dominios y las
 * variantes `www.`). El código del post es alfanumérico con guiones bajos
 * (p. ej. `DWSFx_jErAQ`) y a veces va seguido de un slug de texto legible.
 *
 * Sin imports de Node: el navegador (destino de descargas) también lo usa.
 */

/** Dominios de Threads (cualquier subdominio: `www.`, `mobile.`…). */
const THREADS_HOSTS = ["threads.com", "threads.net"];

/** Segmentos iniciales reservados: no cuentan como perfil. */
const RESERVED_PATHS = new Set([
  "search",
  "explore",
  "login",
  "logout",
  "signup",
  "tos",
  "privacy",
  "about",
  "help",
  "settings",
  "compose",
  "feed",
  "for_you",
  "following",
  "activity",
  "notifications",
  "messages",
  "saved",
  "shared",
  "tag",
  "t",
]);

/** ¿La URL (ya normalizada) es de Threads? Coincide por host. */
export function isThreadsUrl(url: string | null | undefined): boolean {
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
  return THREADS_HOSTS.some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  );
}

/**
 * Identificador del post al que apunta la URL, o `null` si no es un post.
 *
 * Formato observado: `/<usuario>/post/<código>` (con o sin segmentos de slug
 * legible al final, p. ej. `/last-night-at-the-premiere…`).
 */
export function extractThreadsPostId(url: string | null | undefined): string | null {
  if (!isThreadsUrl(url)) return null;
  const parsed = new URL((url as string).trim());
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 3) return null;
  if (segments[1].toLowerCase() !== "post") return null;
  const code = segments[2] ?? "";
  return /^[A-Za-z0-9_-]{6,}$/.test(code) ? code : null;
}

/** ¿Es la URL de un post concreto (cualquier formato de enlace)? */
export function isThreadsPostUrl(url: string | null | undefined): boolean {
  return extractThreadsPostId(url) !== null;
}

/**
 * ¿Es la URL de un perfil (`threads.com/@usuario`)?
 *
 * Sólo se considera perfil la ruta única `@usuario` no reservada; el resto
 * (búsquedas, tags) clasifica como `unsupported` en `lib/urlrules.ts`.
 */
export function isThreadsProfileUrl(url: string | null | undefined): boolean {
  if (!isThreadsUrl(url)) return false;
  const parsed = new URL((url as string).trim());
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return false;
  const first = segments[0] ?? "";
  if (!first.startsWith("@") || first.length < 2) return false;
  return !RESERVED_PATHS.has(first.slice(1).toLowerCase());
}

/**
 * Entrada libre del usuario → URL normalizada.
 *
 * Acepta la URL a secas (`threads.com/@user/post/Código`), como hace
 * Facebook/X.
 */
export function inputToThreadsUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(?:[a-z0-9-]+\.)?(?:threads\.com|threads\.net)\//i.test(raw)) {
    return `https://${raw}`;
  }
  return raw;
}
