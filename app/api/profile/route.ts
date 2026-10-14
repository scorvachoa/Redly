import { NextResponse } from "next/server";

import { API_PROFILE_MAX } from "@/lib/config";
import { PROFILE_PAGE_TTL_MS, profilePageCache, profilePageKey } from "@/lib/cache";
import { clientKey, apiLimiter } from "@/lib/ratelimit";
import { detectPlatformSlug, sourceForPlatform } from "@/lib/sources";
import { isProfileUrl } from "@/lib/urls";

import { errorResponse } from "../_responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/profile  { "url": "https://www.tiktok.com/@user", "max": 20, "cursor": "20" }
 *
 * Devuelve **una página** de vídeos del perfil y el `next_cursor` para pedir la
 * siguiente. El paginado lo hace el cliente invocación a invocación: así cada
 * llamada es corta y no se choca con `maxDuration` de la función.
 *
 * `max` es el tope **por invocación** (recortado a `API_PROFILE_MAX`).
 * `cursor` ausente o vacío empieza en la primera página.
 *
 * La fuente se elige por el host de la URL (`lib/sources.ts`), no se instancia
 * a pelo, de modo que añadir otra plataforma no exige tocar esta ruta.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // El límite se comprueba antes de parsear el cuerpo: así un flood no llega
  // ni a deserializar JSON.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const payload = (body ?? {}) as {
    url?: unknown;
    max?: unknown;
    cursor?: unknown;
    page?: unknown;
  };
  const url = typeof payload.url === "string" ? payload.url.trim() : "";

  if (!isProfileUrl(url)) {
    return NextResponse.json(
      { ok: false, error: "Esa URL no parece la de un perfil de TikTok." },
      { status: 400 },
    );
  }

  // La URL pasa el filtro de TikTok; aún así se resuelve la fuente por host
  // para no dar por hecho que sólo puede existir una.
  const source = sourceForPlatform(detectPlatformSlug(url));
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "Esa plataforma todavía no tiene una fuente verificada." },
      { status: 501 },
    );
  }

  const requested = typeof payload.max === "number" && Number.isFinite(payload.max)
    ? Math.max(1, Math.floor(payload.max))
    : API_PROFILE_MAX;
  const max = Math.min(requested, API_PROFILE_MAX);

  const cursor = typeof payload.cursor === "string" && payload.cursor.trim() !== ""
    ? payload.cursor.trim()
    : null;
  const page = typeof payload.page === "number" && Number.isFinite(payload.page)
    ? Math.max(1, Math.floor(payload.page))
    : 1;

  const key = profilePageKey(url, cursor, page);
  const cached = profilePageCache.get(key) as Awaited<ReturnType<typeof source.listProfilePage>> | undefined;
  if (cached) {
    return NextResponse.json({
      ok: true,
      count: cached.items.length,
      max,
      page: cached.page,
      items: cached.items,
      next_cursor: cached.nextCursor,
      cached: true,
    });
  }

  try {
    const result = await source.listProfilePage(url, cursor, page, max);
    // TTL corto a propósito: el enlace de descarga de cada tarjeta es un token
    // JWT de ~1 h, así que servirlo más tarde que eso daría enlaces muertos.
    profilePageCache.set(key, result, PROFILE_PAGE_TTL_MS);
    return NextResponse.json({
      ok: true,
      count: result.items.length,
      max,
      page: result.page,
      items: result.items,
      next_cursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
