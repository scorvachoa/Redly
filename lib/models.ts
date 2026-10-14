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
}

/** Nombre corto para listados y logs (nunca incluye la URL). */
export function profileDisplayName(video: ProfileVideo, max = 60): string {
  const base = video.title || video.id;
  return base.length <= max ? base : `${base.slice(0, max - 3)}...`;
}

/** Estado de un vídeo dentro de un lote. */
export type BatchItemState = "ok" | "skipped" | "error";

/** Resultado de un vídeo dentro del lote (sin URLs). */
export interface BatchItemResult {
  key: string;
  state: BatchItemState;
  file?: string | null;
  bytes?: number | null;
  title?: string | null;
  error?: string | null;
}

/** Resumen de la ejecución de un lote. */
export interface BatchReport {
  results: BatchItemResult[];
  downloaded: number;
  skipped: number;
  failed: number;
}

/** Frase de resumen corta para CLI/API. */
export function summarize(report: BatchReport): string {
  return `${report.downloaded} descargado(s) · ${report.skipped} omitido(s) · ${report.failed} fallo(s)`;
}
