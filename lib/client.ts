/**
 * Cliente del flujo HTTP de TikVid (fallback).
 *
 * Port de `app/client.py`. Consume `POST https://tikvid.io/api/ajaxSearch` y
 * parsea el HTML con `parser.ts`. Se usa como respaldo cuando SavTikPro no
 * resuelve un vídeo suelto.
 */

import {
  HEADERS,
  RETRY_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  TIKVID_AJAX_SEARCH_URL,
  TRANSIENT_HTTP_STATUSES,
} from "./config";
import { RequestError, UnavailableError } from "./exceptions";
import { fetchWithTimeout, headersInit, sleep } from "./http";
import type { TikTokResult } from "./models";
import { parseSearchHtml } from "./parser";

export interface TikVidClientOptions {
  debug?: boolean;
}

export class TikVidClient {
  readonly debug: boolean;
  lastHttpStatus: number | null = null;
  lastLogicalStatus: string | null = null;

  constructor(options: TikVidClientOptions = {}) {
    this.debug = options.debug ?? false;
  }

  /** Envía la URL de TikTok a TikVid y devuelve los datos parseados. */
  async search(url: string): Promise<TikTokResult> {
    const payload = new URLSearchParams({ q: url, lang: "en" });
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await fetchWithTimeout(
          TIKVID_AJAX_SEARCH_URL,
          {
            method: "POST",
            headers: headersInit(HEADERS),
            body: payload,
          },
        );
        this.lastHttpStatus = response.status;

        if (TRANSIENT_HTTP_STATUSES.has(response.status)) {
          lastError = new RequestError(`TikVid respondió HTTP ${response.status}.`);
        } else if (response.status === 404) {
          throw new UnavailableError("El contenido solicitado no existe o es privado.");
        } else if (response.status >= 400) {
          throw new RequestError(`TikVid respondió HTTP ${response.status}.`);
        } else {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            lastError = new RequestError("TikVid devolvió una respuesta no JSON.");
          }
          if (body !== undefined) {
            return this.validateBody(body, url);
          }
        }
      } catch (error) {
        if (error instanceof UnavailableError) throw error;
        if (error instanceof RequestError) {
          lastError = error;
        } else {
          lastError = new RequestError(
            `Error de red contra TikVid (${(error as Error)?.name ?? "Error"}).`,
          );
        }
      }

      if (attempt < RETRY_ATTEMPTS - 1) {
        await sleep(RETRY_BACKOFF_SECONDS * (attempt + 1));
      }
    }

    throw lastError ?? new RequestError("TikVid no respondió.");
  }

  private validateBody(body: unknown, url: string): TikTokResult {
    if (typeof body !== "object" || body === null) {
      throw new RequestError("Respuesta inesperada de TikVid.");
    }
    const record = body as Record<string, unknown>;
    const status = String(record.status ?? "").toLowerCase();
    this.lastLogicalStatus = status || "ok";

    if (status !== "ok" && status !== "") {
      const message = String(record.message ?? record.msg ?? "").trim();
      throw new UnavailableError(message || "TikVid no encontró el contenido solicitado.");
    }

    const html = typeof record.data === "string" ? record.data : "";
    if (!html.trim()) {
      throw new UnavailableError("El servicio no devolvió datos para esa URL.");
    }

    const result = parseSearchHtml(html);
    if (result.downloads.length === 0) {
      throw new UnavailableError("No se encontraron opciones de descarga.");
    }
    return result;
  }
}
