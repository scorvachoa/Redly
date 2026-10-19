import { NextResponse } from "next/server";

import { RedlyError, UnavailableError } from "@/lib/exceptions";
import { apiLimiter, clientKey } from "@/lib/ratelimit";
import { prepareMergedDownload } from "@/lib/snapyt";
import { isYouTubeVideoUrl } from "@/lib/youtube-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La combinación espera la cola de SnapYT: se sube el límite de la función.
export const maxDuration = 120;

/**
 * GET /api/merge?yt=<URL de YouTube>&v=<índice de vídeo>&a=<índice de audio>
 *
 * Combina la pista de vídeo con la de audio en el servidor de SnapYT (el mismo
 * flujo `vd_mux_start` → `vd_mux_status` que usa la propia web) y devuelve la
 * URL temporal del archivo ya unido:
 *
 * ```json
 * { "ok": true, "url": "https://www.snapyt.app/wp-admin/admin-ajax.php?action=vd_mux&…" }
 * ```
 *
 * El cliente (Downloader) espera aquí —mostrando «Combinando…»— y después
 * descarga esa URL por `/api/download`, que ya valida el host contra
 * `ALLOWED_DOWNLOAD_HOSTS` y gestiona progreso, reintentos y límite de tasa.
 *
 * `v` y `a` no son arbitrarios: `prepareMergedDownload` los contrasta con las
 * opciones del preview recién resuelto, así que el servidor sólo puede lanzar
 * trabajos que la propia web ofrecería.
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
  const yt = searchParams.get("yt") ?? "";
  const v = searchParams.get("v") ?? "";
  const a = searchParams.get("a") ?? "";

  if (!isYouTubeVideoUrl(yt)) {
    return NextResponse.json(
      { ok: false, error: "Falta una URL válida de YouTube." },
      { status: 400 },
    );
  }
  if (!/^\d{1,2}$/.test(v) || !/^\d{1,2}$/.test(a)) {
    return NextResponse.json({ ok: false, error: "Calidad no válida." }, { status: 400 });
  }

  try {
    const url = await prepareMergedDownload(yt, v, a);
    return NextResponse.json({ ok: true, url });
  } catch (error) {
    if (error instanceof UnavailableError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 410 });
    }
    if (error instanceof RedlyError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, error: "No se pudo combinar el vídeo." },
      { status: 500 },
    );
  }
}
