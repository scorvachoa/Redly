/**
 * Reglas de URL por plataforma.
 *
 * Motivo de existir: las rutas de la API validaban con funciones de TikTok a
 * pelo (`isTikTokUrl`, `isProfileUrl`, `inputToTikTokUrl`) **antes** de mirar
 * el registro de fuentes, así que añadir una plataforma exigía tocarlas. Este
 * módulo concentra la clasificación en un registro equivalente al de
 * `lib/sources.ts`: la ruta resuelve las reglas por la URL y sólo delega.
 *
 * Apt navegador: lo usan las rutas (servidor) y `components/Downloader.tsx`
 * para decidir el flujo sin una ida y vuelta a la API.
 */

import {
  inputToTikTokUrl,
  isProfileUrl as isTikTokProfileUrl,
  isTikTokUrl,
} from "./urls";
import {
  inputToYouTubeUrl,
  isYouTubePlaylistUrl,
  isYouTubeProfileUrl,
  isYouTubeUrl,
  isYouTubeVideoUrl,
} from "./youtube-urls";

/** Qué clase de contenido representa una URL ya reconocida. */
export type UrlKind = "video" | "profile" | "unsupported";

export interface UrlRules {
  /** Slug de `lib/platforms.ts` al que pertenecen estas reglas. */
  readonly slug: string;
  /** ¿La URL (ya normalizada) es de esta plataforma? Coincide por host. */
  matches(url: string): boolean;
  /** Entrada libre del usuario → URL normalizada. */
  normalize(input: string): string;
  /** Clasifica una URL de esta plataforma. */
  classify(url: string): UrlKind;
}

const TIKTOK_RULES: UrlRules = {
  slug: "tiktok",
  matches: isTikTokUrl,
  normalize: inputToTikTokUrl,
  classify(url) {
    // Se conserva la tolerancia histórica de TikTok: todo lo que no sea perfil
    // se envía a la fuente, que responde con su propio mensaje si no es un vídeo.
    if (isTikTokProfileUrl(url)) return "profile";
    return "video";
  },
};

const YOUTUBE_RULES: UrlRules = {
  slug: "youtube",
  matches: isYouTubeUrl,
  normalize: inputToYouTubeUrl,
  classify(url) {
    // Canales y listas de reproducción comparten el modo «perfil» (listado).
    if (isYouTubeProfileUrl(url) || isYouTubePlaylistUrl(url)) return "profile";
    if (isYouTubeVideoUrl(url)) return "video";
    // Portadas, resultados de búsqueda…
    return "unsupported";
  },
};

/**
 * Registro de reglas, en orden de preferencia.
 *
 * Sólo entran plataformas con reglas verificadas; las demás siguen existiendo
 * en `lib/platforms.ts` y ninguna URL les casa (la entrada cae en `null`).
 */
export const URL_RULES: readonly UrlRules[] = [TIKTOK_RULES, YOUTUBE_RULES];

export interface ClassifiedUrl {
  slug: string;
  rules: UrlRules;
  /** URL normalizada lista para la fuente. */
  url: string;
  kind: UrlKind;
}

/**
 * Clasifica la entrada libre del usuario (URL completa o `@usuario` de TikTok).
 *
 * Devuelve `null` cuando ninguna regla reconoce la entrada: la ruta responde
 * `400` en lugar de intentar adivinar.
 */
export function classifyInput(input: string | null | undefined): ClassifiedUrl | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  for (const rules of URL_RULES) {
    const url = rules.normalize(raw);
    if (!rules.matches(url)) continue;
    return { slug: rules.slug, rules, url, kind: rules.classify(url) };
  }
  return null;
}
