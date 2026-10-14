/**
 * Utilidades de descarga en streaming desde el navegador.
 *
 * Están fuera de React a propósito: son funciones puras sobre `fetch` y
 * `FileSystemWritableStream`, de modo que se pueden testear sin montar un
 * componente y reutilizarlas si algún día aparece una segunda UI (por ejemplo
 * la app de escritorio anunciada).
 */

import type { FileSink } from "./fsaccess";

/** Formatea bytes a una cadena legible (`1.4 MB`). */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "?";
  let amount = value;
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return index === 0
    ? `${Math.round(amount)} ${units[index]}`
    : `${amount.toFixed(1)} ${units[index]}`;
}

/**
 * ¿La URL parece la de un perfil (`/@usuario`)?
 *
 * Se mantiene aquí la comprobación de forma y no en `lib/urls.ts` porque esa
 * librería está pensada para el servidor y validando de forma estricta; aquí
 * basta con decidir qué flujo de la UI abrir.
 */
export function isProfileLike(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return /^\/@[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Descarga `/api/download?...` siguiendo el stream para mostrar progreso real
 * y escribiendo cada trozo en el `sink` indicado. Devuelve los bytes
 * descargados.
 *
 * El destino se pasa como **fábrica** y no como instancia porque el nombre
 * final del archivo se conoce a mitad de stream (cabecera
 * `Content-Disposition`), y sólo entonces se puede abrir el fichero en disco.
 */
export async function downloadWithProgress(
  target: string,
  suggestedName: string,
  makeSink: (filename: string, contentType: string) => FileSink | Promise<FileSink>,
  onProgress: (done: number, total: number | null) => void,
): Promise<number> {
  const response = await fetch(target);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // mantener message
    }
    throw new Error(message);
  }

  const lengthHeader = response.headers.get("content-length");
  const total = lengthHeader ? Number.parseInt(lengthHeader, 10) : null;
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const filename = filenameMatch?.[1] || suggestedName;
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";

  if (!response.body) throw new Error("Respuesta sin cuerpo.");

  const sink = await makeSink(filename, contentType);
  const reader = response.body.getReader();
  let done = 0;

  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      if (value) {
        await sink.write(value);
        done += value.length;
        onProgress(done, total);
      }
    }
    await sink.close();
  } catch (error) {
    await sink.abort().catch(() => undefined);
    throw error;
  }
  return done;
}

/** Etiqueta de progreso para un tramo de descarga. */
export function progressLabel(
  done: number,
  total: number | null,
  prefix?: string,
): string {
  const body = total && total > 0
    ? `${formatBytes(done)} de ${formatBytes(total)} · ${Math.min(Math.round((done / total) * 100), 100)}%`
    : `${formatBytes(done)} descargados`;
  return prefix ? `${prefix} · ${body}` : body;
}
