/**
 * Registro de plataformas soportadas por Red.ly.
 *
 * Es la **fuente única** para la portada y las rutas `/download/[platform]`
 * y `/transcript/[platform]`.
 *
 * **Importante**: hoy sólo TikTok está verificado y es funcional. Las demás
 * plataformas existen en la estructura de navegación con estado
 * «Próximamente», pero **no** se les asigna ningún endpoint: `base.md` §2
 * prohíbe inventar APIs, y ni SavTikPro ni TikVid tienen nada comprobado
 * para YouTube, Facebook, Instagram, X ni Threads.
 *
 * Módulo sin imports: lo usan la portada (servidor) y las páginas de cliente.
 */

export type PlatformKind = "download" | "transcript";

export interface Platform {
  /** Segmento de URL: `/download/<slug>`. */
  slug: string;
  /** Nombre visible. */
  name: string;
  /** Iniciales de la tarjeta (sin emojis). */
  monogram: string;
  /** Color de marca, para el acento de la tarjeta. */
  accent: string;
  /** ¿Existe implementación real de descarga? Sólo TikTok. */
  ready: boolean;
  /** ¿Existe implementación real de transcripción? Ninguna hoy. */
  transcriptReady: boolean;
  /** Texto corto para la tarjeta. */
  blurb: string;
  /** Dominios principales (informativos; la validación real está en `lib/urls.ts`). */
  hosts: string[];
}

export const PLATFORMS: readonly Platform[] = [
  {
    slug: "tiktok",
    name: "TikTok",
    monogram: "TT",
    accent: "#fe2c55",
    ready: true,
    transcriptReady: false,
    blurb: "Un vídeo suelto o un perfil completo, con reanudación.",
    hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  },
  {
    slug: "youtube",
    name: "YouTube",
    monogram: "YT",
    accent: "#ff0000",
    ready: false,
    transcriptReady: false,
    blurb: "Vídeos, Shorts y directos de YouTube.",
    hosts: ["youtube.com", "youtu.be", "m.youtube.com"],
  },
  {
    slug: "facebook",
    name: "Facebook",
    monogram: "FB",
    accent: "#1877f2",
    ready: false,
    transcriptReady: false,
    blurb: "Publicaciones y Reels de Facebook.",
    hosts: ["facebook.com", "fb.watch", "m.facebook.com"],
  },
  {
    slug: "instagram",
    name: "Instagram",
    monogram: "IG",
    accent: "#e1306c",
    ready: false,
    transcriptReady: false,
    blurb: "Reels, vídeos e historias públicas.",
    hosts: ["instagram.com", "instagr.am"],
  },
  {
    slug: "twitter",
    name: "X (Twitter)",
    monogram: "X",
    accent: "#0f1419",
    ready: false,
    transcriptReady: false,
    blurb: "Vídeos incrustados en publicaciones de X.",
    hosts: ["twitter.com", "x.com", "t.co"],
  },
  {
    slug: "threads",
    name: "Threads",
    monogram: "TH",
    accent: "#101010",
    ready: false,
    transcriptReady: false,
    blurb: "Publicaciones con vídeo de Threads.",
    hosts: ["threads.net", "www.threads.net"],
  },
] as const;

/** Busca una plataforma por su segmento de URL. */
export function getPlatform(slug: string | null | undefined): Platform | null {
  if (!slug) return null;
  const key = slug.trim().toLowerCase();
  return PLATFORMS.find((platform) => platform.slug === key) ?? null;
}

/** ¿Está lista la funcionalidad pedida (`download` o `transcript`)? */
export function isReady(platform: Platform, kind: PlatformKind): boolean {
  return kind === "download" ? platform.ready : platform.transcriptReady;
}
