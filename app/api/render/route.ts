import { NextResponse } from "next/server";

import { RedlyError, UnavailableError } from "@/lib/exceptions";
import { isFsaveJobUrl, resolveRenderJob } from "@/lib/fsave";
import { isIlovexJobUrl, resolveIlovexRenderJob } from "@/lib/ilovex";
import { isSavethreadsJobUrl, resolveSavethreadsRenderJob } from "@/lib/savethreads";
import { apiLimiter, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El render de FSave/iLoveX/SaveThreads tarda 1–2 sondeos; se reserva margen para los reintentos.
export const maxDuration = 60;

/**
 * GET /api/render?job=<URL de trabajo>&source=<ilovex|savethreads>
 *
 * Resuelve un trabajo de render (`mediaUrl` de cada opción de descarga) a la
 * URL directa del archivo:
 *
 * ```json
 * { "ok": true, "url": "https://dl.iamworker.com/s31/v5/download/…" }
 * ```
 *
 * El cliente (Downloader) espera aquí —mostrando «Preparando…»— y después
 * descarga esa URL por `/api/download`, que valida el host contra
 * `ALLOWED_DOWNLOAD_HOSTS` y gestiona progreso, reintentos y límite de tasa.
 *
 * El `job` no es arbitrario: se contrasta con el patrón observado del CDN de
 * cada servicio. FSave, iLoveX y SaveThreads comparten familia de CDN
 * (`worker*.com`), así que el parámetro `source` decide qué sondeo usar
 * (`ilovex` → iLoveX y `savethreads` → SaveThreads, sin sesión; por defecto →
 * FSave, con `dt` fresco en cada invocación).
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
  const job = searchParams.get("job") ?? "";
  const source = (searchParams.get("source") ?? "").trim().toLowerCase();

  try {
    if (source === "ilovex") {
      if (!isIlovexJobUrl(job)) {
        return NextResponse.json(
          { ok: false, error: "La URL de trabajo no es válida." },
          { status: 400 },
        );
      }
      const { url } = await resolveIlovexRenderJob(job);
      return NextResponse.json({ ok: true, url });
    }

    if (source === "savethreads") {
      if (!isSavethreadsJobUrl(job)) {
        return NextResponse.json(
          { ok: false, error: "La URL de trabajo no es válida." },
          { status: 400 },
        );
      }
      const { url } = await resolveSavethreadsRenderJob(job);
      return NextResponse.json({ ok: true, url });
    }

    if (!isFsaveJobUrl(job)) {
      return NextResponse.json(
        { ok: false, error: "La URL de trabajo no es válida." },
        { status: 400 },
      );
    }
    const { url } = await resolveRenderJob(job);
    return NextResponse.json({ ok: true, url });
  } catch (error) {
    if (error instanceof UnavailableError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 410 });
    }
    if (error instanceof RedlyError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, error: "No se pudo preparar el archivo." },
      { status: 500 },
    );
  }
}
