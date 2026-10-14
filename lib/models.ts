/**
 * Modelos de datos de Red.ly.
 *
 * Port de `app/models.py`. Se usan interfaces ligeras (sin dependencia de una
 * librería de validación) porque los datos ya vienen de fuentes conocidas.
 */

/** Una opción de descarga ofrecida por el servicio. */
export interface DownloadOption {
  name: string;
  url: string;
  format?: string | null;
  quality?: string | null;
}

/** Etiqueta corta para la UI, por ejemplo `MP4 HD`. */
export function optionLabel(option: DownloadOption): string {
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
