/**
 * Resolución de URLs temporales y descarga en streaming.
 *
 * Port de `app/downloader.py`. Trata SnapCDN como un posible redireccionador
 * hacia el CDN de TikTok, sin asumir que todas las URLs son de ese dominio.
 * Las URLs firmadas/temporales sólo viven durante la ejecución: nunca se
 * guardan ni se registran completas en los logs.
 *
 * La API web abre la descarga con `openStream` y devuelve un `ReadableStream`.
 */

import {
  DOWNLOAD_HEADERS,
  DOWNLOAD_TIMEOUT,
  MAX_REDIRECTS,
  REQUEST_TIMEOUT,
  TRANSIENT_HTTP_STATUSES,
} from "./config";
import { DownloadError, UnavailableError } from "./exceptions";
import { fetchWithTimeout, headersInit } from "./http";
import type { RedirectInfo } from "./models";

// `sanitizeFilename` vive en `./sanitize` (sin dependencias de Node) para que
// el navegador también pueda usarlo; se reexporta aquí por compatibilidad.
export { sanitizeFilename } from "./sanitize";

/** Resuelve una URL temporal siguiendo redirecciones (sin descargar el cuerpo). */
export async function resolveUrl(url: string): Promise<RedirectInfo> {
  let current = url;
  let hops = 0;
  let status: number | null = null;

  while (hops <= MAX_REDIRECTS) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        current,
        { method: "GET", headers: headersInit(DOWNLOAD_HEADERS), redirect: "manual" },
        REQUEST_TIMEOUT * 1000,
      );
    } catch (error) {
      throw new DownloadError(`No se pudo resolver la URL temporal (${(error as Error)?.name ?? "Error"}).`);
    }

    status = response.status;
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(status) && location) {
      hops += 1;
      current = new URL(location, current).toString();
      // Descartar el cuerpo de la respuesta de redirección.
      if (response.body) await response.body.cancel().catch(() => undefined);
      continue;
    }
    break;
  }

  if (hops > MAX_REDIRECTS) {
    throw new DownloadError(`Demasiadas redirecciones (máximo ${MAX_REDIRECTS}).`);
  }

  return {
    originalUrl: url,
    finalUrl: current,
    redirected: hops > 0,
    statusCode: status,
    hops,
  };
}

export interface StreamDownload {
  stream: ReadableStream;
  contentType: string | null;
  contentLength: number | null;
  finalUrl: string;
}

/**
 * Abre la descarga como `ReadableStream` (para devolverla por la API web).
 *
 * Sigue las redirecciones manualmente y valida la respuesta. El caller decide
 * cómo empaquetarla en un `Response`.
 */
export async function openStream(url: string): Promise<StreamDownload> {
  const info = await resolveUrl(url);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      info.finalUrl,
      { method: "GET", headers: headersInit(DOWNLOAD_HEADERS), redirect: "follow" },
      DOWNLOAD_TIMEOUT * 1000,
    );
  } catch (error) {
    throw new DownloadError(`No se pudo iniciar la descarga (${(error as Error)?.name ?? "Error"}).`);
  }

  ensureSuccessful(response);

  if (!response.body) throw new DownloadError("La respuesta no trae cuerpo de descarga.");

  return {
    stream: response.body,
    contentType: response.headers.get("content-type"),
    contentLength: contentLength(response),
    finalUrl: info.finalUrl,
  };
}

function ensureSuccessful(response: Response): void {
  const status = response.status;
  if ([401, 403, 404, 410].includes(status)) {
    throw new UnavailableError("La URL temporal ha expirado.");
  }
  if (status >= 400) {
    throw new DownloadError(`El servidor respondió HTTP ${status}.`);
  }
  if (TRANSIENT_HTTP_STATUSES.has(status)) {
    throw new DownloadError(`El servidor respondió HTTP ${status}.`);
  }
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
