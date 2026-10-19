/**
 * Modelos de datos de Red.ly.
 *
 * Port de `app/models.py`. Se usan interfaces ligeras (sin dependencia de una
 * librería de validación) porque los datos ya vienen de fuentes conocidas.
 */

/** Tipo de medio de una opción. Las publicaciones de fotos de TikTok devuelven imágenes. */
export type MediaKind = "video" | "audio" | "image";

/** Formatos que se consideran imagen (carrusel de TikTok, `photomode`). */
const IMAGE_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "avif"]);
/** Formatos que se consideran sólo audio. */
const AUDIO_FORMATS = new Set(["mp3", "m4a", "aac", "wav", "ogg"]);

/** Deduce el tipo de medio a partir del formato ya detectado. */
export function kindFromFormat(format: string | null | undefined): MediaKind {
  const value = (format ?? "").toLowerCase();
  if (IMAGE_FORMATS.has(value)) return "image";
  if (AUDIO_FORMATS.has(value)) return "audio";
  return "video";
}

/** Una opción de descarga ofrecida por el servicio. */
export interface DownloadOption {
  name: string;
  url: string;
  format?: string | null;
  quality?: string | null;
  /** `image` en publicaciones de carrusel; el resto es vídeo o audio. */
  kind?: MediaKind | null;
  /** Miniatura de la foto (sólo en publicaciones de fotos). */
  thumbnail?: string | null;
  /**
   * ¿La pista trae audio por sí misma?
   *
   * `true` en la progresiva de YouTube y los MP4 de TikTok; `false` en las
   * pistas `video-only` de SnapYT (el audio va aparte o se combina al
   * descargar). `undefined` cuando la fuente no lo declara: la UI no muestra
   * etiqueta en ese caso.
   */
  hasAudio?: boolean | null;
}

/** Etiqueta corta para la UI, por ejemplo `MP4 HD`. */
export function optionLabel(option: DownloadOption): string {
  if (option.kind === "image") return (option.format ?? "JPEG").toUpperCase();
  const parts = [option.format ? option.format.toUpperCase() : "OPCION"];
  if (option.quality && option.quality !== "standard") {
    parts.push(option.quality.toUpperCase());
  }
  return parts.join(" ");
}

/** Metadatos y opciones extraídos de la respuesta del servicio. */
export interface TikTokResult {
  videoId?: string | null;
  title?: string | null;
  thumbnail?: string | null;
  downloads: DownloadOption[];
}

/**
 * Opción de máxima calidad de un resultado, si la hay.
 *
 * El listado de perfil sólo ofrece el MP4 **estándar** (verificado: 12
 * tarjetas, 12 enlaces, 0 con `_hd`); el HD sólo aparece al analizar el post.
 * Devuelve `null` cuando no hay HD: en ese caso hay que conservar la opción
 * original, porque sustituirla por otra podría cambiarle el formato.
 *
 * YouTube no usa la etiqueta `hd`: trae la resolución (`1080p`, `720p`…).
 * Si ninguna opción es HD, se elige la de mayor altura numérica; si tampoco la
 * hay (sólo calidades sin número), sigue devolviendo `null` con el mismo
 * significado de «conserva la original».
 */
export function bestQualityOption(result: TikTokResult): DownloadOption | null {
  const hd = result.downloads.find(
    (option) => (option.quality ?? "").toLowerCase() === "hd",
  );
  if (hd) return hd;

  let best: DownloadOption | null = null;
  let bestHeight = -1;
  for (const option of result.downloads) {
    if (option.kind === "image" || option.kind === "audio") continue;
    const match = /(\d{3,4})\s*p/i.exec(option.quality ?? "");
    if (!match) continue;
    const height = Number(match[1]);
    if (height > bestHeight) {
      bestHeight = height;
      best = option;
    }
  }
  return best;
}

/**
 * Calidad con la que se baja cada vídeo de un lote (perfil o lista).
 *
 * - `recommended`: la mejor opción **directa** (ya con audio). Es el
 *   comportamiento histórico: en YouTube la progresiva, en TikTok el MP4 HD.
 * - `max`: la de mayor resolución entre las útiles, incluida la que SnapYT
 *   sirve como URL de combinación (`/api/merge?…`, p. ej. 1080p). Las pistas
 *   mudas que no admiten combinación se descartan: bajar un vídeo sin sonido
 *   sería peor que conformarse con una resolución menor.
 * - `audio`: **sólo la pista de sonido** (MP3 convertido u opus/m4a original),
 *   la de mayor bitrate. No compite con el vídeo: es un objetivo distinto, un
 *   archivo de audio por cada vídeo del lote.
 *
 * Devuelve `null` cuando no hay ninguna opción descargable en el modo pedido.
 */
export type BatchQuality = "recommended" | "max" | "audio";

/** Bitrate numérico de una pista de audio (`"320 kbps"` → 320). Sin dato: 0. */
function optionBitrate(option: DownloadOption): number {
  const match = /(\d{2,4})\s*kbps/i.exec(option.quality ?? "");
  return match ? Number(match[1]) : 0;
}

/**
 * Mejor pista de audio entre las opciones: la de mayor bitrate (MP3 convertido
 * u opus/m4a original). A igual bitrate se conserva la primera, que es la del
 * servicio (mismo criterio estable que en `toDownloads` de SnapYT).
 */
function bestAudioOption(downloads: DownloadOption[]): DownloadOption | null {
  let best: DownloadOption | null = null;
  for (const option of downloads) {
    if (option.kind !== "audio") continue;
    if (!best || optionBitrate(option) > optionBitrate(best)) best = option;
  }
  return best;
}

export function batchOption(result: TikTokResult, mode: BatchQuality): DownloadOption | null {
  if (mode === "audio") return bestAudioOption(result.downloads);

  const videos = result.downloads.filter(
    (option) => option.kind !== "image" && option.kind !== "audio",
  );
  const usable =
    mode === "max"
      ? videos.filter((option) => option.hasAudio === true || option.url.startsWith("/"))
      : videos.filter((option) => !option.url.startsWith("/"));
  return bestQualityOption({ ...result, downloads: usable });
}

/** Resultado de resolver una URL temporal (SnapCDN u otra). */
export interface RedirectInfo {
  originalUrl: string;
  finalUrl: string;
  redirected: boolean;
  statusCode?: number | null;
  hops: number;
}

/** Un vídeo listado a partir de un perfil (fuente de lote). */
export interface ProfileVideo {
  id: string;
  title?: string | null;
  channel?: string | null;
  views?: string | null;
  thumbnail?: string | null;
  url: string;
  format?: string | null;
  /** URL del propio post (`buildVideoUrl`): necesaria para pedir la calidad máxima. */
  postUrl?: string | null;
}
