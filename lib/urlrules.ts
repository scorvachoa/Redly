/**
 * Reglas de URL por plataforma.
 *
 * Motivo de existir: las rutas de la API validaban con funciones de TikTok a
 * pelo (`isTikTokUrl`, `isProfileUrl`, `inputToTikTokUrl`) **antes** de mirar
 * el registro de fuentes, así que añadir una plataforma exigía tocarlas. Este
 * módulo concentra la clasificación en un registro equivalente al de
 * `lib/sources.ts`: la ruta resuelve las reglas por la URL y sólo delega.
 *
 * Apt navegador: lo usan las rutas (servidor) y
 * `components/HomeDownloader.tsx` (buscador general de la portada) para
 * resaltar la red detectada mientras se escribe.
 */

import { getPlatform } from "./platforms";
import {
  inputToFacebookUrl,
  isFacebookProfileUrl,
  isFacebookUrl,
  isFacebookVideoUrl,
} from "./facebook-urls";
import {
  inputToInstagramUrl,
  isInstagramPostUrl,
  isInstagramProfileUrl,
  isInstagramUrl,
} from "./instagram-urls";
import {
  inputToTikTokUrl,
  isProfileUrl as isTikTokProfileUrl,
  isTikTokUrl,
} from "./urls";
import {
  inputToThreadsUrl,
  isThreadsPostUrl,
  isThreadsProfileUrl,
  isThreadsUrl,
} from "./threads-urls";
import {
  inputToTwitterUrl,
  isTweetUrl,
  isTwitterProfileUrl,
  isTwitterUrl,
} from "./twitter-urls";
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

const FACEBOOK_RULES: UrlRules = {
  slug: "facebook",
  matches: isFacebookUrl,
  normalize: inputToFacebookUrl,
  classify(url) {
    // Sólo se resuelven vídeos/reels concretos; las páginas de Facebook no
    // tienen listado (`supportsProfiles: false` en la fuente).
    if (isFacebookVideoUrl(url)) return "video";
    if (isFacebookProfileUrl(url)) return "profile";
    return "unsupported";
  },
};

const INSTAGRAM_RULES: UrlRules = {
  slug: "instagram",
  matches: isInstagramUrl,
  normalize: inputToInstagramUrl,
  classify(url) {
    // Reels, `/p/` con vídeo y publicaciones de fotos entran por el mismo
    // flujo (la fuente cae a `/api/ig-photo/` si no hay vídeo); los perfiles
    // no tienen listado (`supportsProfiles: false` en la fuente).
    if (isInstagramPostUrl(url)) return "video";
    if (isInstagramProfileUrl(url)) return "profile";
    return "unsupported";
  },
};

const TWITTER_RULES: UrlRules = {
  slug: "twitter",
  matches: isTwitterUrl,
  normalize: inputToTwitterUrl,
  classify(url) {
    // Sólo se resuelven tweets concretos; los perfiles de X no tienen listado
    // (`supportsProfiles: false` en la fuente). Los enlaces cortos `t.co` no
    // casan con las reglas (pueden apuntar a cualquier cosa): la ruta
    // responde 400 sin inventar un destino.
    if (isTweetUrl(url)) return "video";
    if (isTwitterProfileUrl(url)) return "profile";
    return "unsupported";
  },
};

const THREADS_RULES: UrlRules = {
  slug: "threads",
  matches: isThreadsUrl,
  normalize: inputToThreadsUrl,
  classify(url) {
    // Sólo se resuelven publicaciones concretas (`/@usuario/post/<código>`);
    // los perfiles no tienen listado (`supportsProfiles: false` en la fuente).
    if (isThreadsPostUrl(url)) return "video";
    if (isThreadsProfileUrl(url)) return "profile";
    return "unsupported";
  },
};

/**
 * Registro de reglas, en orden de preferencia.
 *
 * Sólo entran plataformas con reglas verificadas; las demás siguen existiendo
 * en `lib/platforms.ts` y ninguna URL les casa (la entrada cae en `null`).
 */
export const URL_RULES: readonly UrlRules[] = [
  TIKTOK_RULES,
  YOUTUBE_RULES,
  FACEBOOK_RULES,
  INSTAGRAM_RULES,
  TWITTER_RULES,
  THREADS_RULES,
];

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

/**
 * Resultado de resolver la entrada del buscador general de la portada.
 *
 * `ok: true` lleva la URL ya normalizada y el slug al que hay que navegar;
 * `ok: false` lleva el mensaje que se muestra bajo el campo. Los textos son
 * copy de interfaz y replican el de `components/Downloader.tsx`, para que
 * llegar desde la portada o escribir en la página de la plataforma diga lo
 * mismo.
 */
export type SearchResolution =
  | { ok: true; slug: string; url: string; kind: UrlKind }
  | { ok: false; error: string };

/**
 * Decide a qué página lleva una entrada del buscador general.
 *
 * El buscador no sabe de plataformas: clasifica con las mismas reglas que la
 * API y el descargador, comprueba que la destino esté disponible y devuelve
 * tanto el destino (`/download/<slug>?url=…`) como el motivo si no procede
 * navegar. Sólo se admite descarga (`kind` vídeo/perfil): la transcripción
 * todavía no tiene ninguna fuente.
 */
export function resolveSearchInput(input: string | null | undefined): SearchResolution {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Pega la URL de un vídeo o de un perfil público." };

  const classified = classifyInput(raw);
  if (!classified) {
    return {
      ok: false,
      error: "No reconozco esa URL. Prueba con un enlace de TikTok, YouTube, Facebook, Instagram, X o Threads.",
    };
  }

  const platform = getPlatform(classified.slug);
  if (!platform || !platform.ready) {
    return { ok: false, error: `${platform?.name ?? "Esa plataforma"} aún no está disponible.` };
  }
  if (classified.kind === "profile" && platform.profilesReady !== true) {
    return { ok: false, error: `Los canales de ${platform.name} aún no están disponibles.` };
  }
  if (classified.kind === "unsupported") {
    return { ok: false, error: `Esa URL de ${platform.name} no corresponde a un vídeo concreto.` };
  }

  return { ok: true, slug: classified.slug, url: classified.url, kind: classified.kind };
}
