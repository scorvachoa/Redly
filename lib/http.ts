/**
 * Utilidades HTTP compartidas.
 *
 * Node 20+ trae `fetch` (undici) de forma global, así que no se necesita una
 * librería de peticiones. Aquí sólo se envuelven timeout y pausas.
 */

import { REQUEST_TIMEOUT } from "./config";

/** Pausa asíncrona (para reintentos y separación del lote). */
export function sleep(seconds: number): Promise<void> {
  if (!seconds || seconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/** `fetch` con timeout global en milisegundos. */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT * 1000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Acepta sólo claves/string de cabeceras conocidas para tipar `headers`. */
export function headersInit(headers: Record<string, string>): Record<string, string> {
  return { ...headers };
}
