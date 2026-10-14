import { NextResponse } from "next/server";

import { isAllowedDownloadHost, urlHost } from "@/lib/config";
import { DownloadError, RedlyError, UnavailableError } from "@/lib/exceptions";
import { openStream, sanitizeFilename } from "@/lib/downloader";
import { apiLimiter, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La descarga puede durar bastante: se sube el límite de la función.
export const maxDuration = 60;

/**
 * GET /api/download?url=<token temporal>&name=<nombre sugerido>
 *
 * Sigue las redirecciones del CDN y hace streaming del archivo al cliente con
 * `Content-Disposition: attachment`.
 *
 * **Anti proxy abierto**: sólo se aceptan URLs cuyo host esté en la lista
 * blanca de CDNs de TikTok/SnapCDN (`lib/config.ts`). Cualquier otra URL se
 * rechaza con 400.
 *
 * **Límite de tasa**: la descarga consume el ancho de banda de la función
 * serverless, así que el proxy es el punto donde más sale a cuenta acotar.
 */
export async function GET(request: Request): Promise<Response> {
  const limit = apiLimiter.check(clientKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "Demasiadas peticiones. Espera unos segundos.",
        retry_after: limit.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url") ?? "";
  const name = searchParams.get("name");

  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Falta una URL válida." }, { status: 400 });
  }

  const host = urlHost(url);
  if (!isAllowedDownloadHost(host)) {
    return NextResponse.json(
      { error: "El host de descarga no está permitido." },
      { status: 400 },
    );
  }

  try {
    const download = await openStream(url);

    // Nombre de archivo seguro para el navegador.
    const fallback = inferFilename(download.finalUrl);
    const filename = sanitizeFilename(name && name.trim() ? name : fallback);

    const headers = new Headers({
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    if (download.contentType) headers.set("Content-Type", download.contentType);
    if (download.contentLength !== null) {
      headers.set("Content-Length", String(download.contentLength));
    }

    return new Response(download.stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof UnavailableError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 410 });
    }
    if (error instanceof DownloadError || error instanceof RedlyError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, error: "No se pudo descargar el archivo." },
      { status: 500 },
    );
  }
}

/** Intenta adivinar el nombre del archivo a partir de la URL final del CDN. */
function inferFilename(finalUrl: string): string {
  try {
    const pathname = new URL(finalUrl).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {
    // ignorar
  }
  return "Redly.mp4";
}
