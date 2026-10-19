import { NextResponse } from "next/server";

import { API_PROFILE_MAX } from "@/lib/config";
import { PROFILE_PAGE_TTL_MS, profilePageCache, profilePageKey } from "@/lib/cache";
import { clientKey, apiLimiter } from "@/lib/ratelimit";
import { getPlatform } from "@/lib/platforms";
import { sourceForPlatform } from "@/lib/sources";
import { classifyInput } from "@/lib/urlrules";

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
 * Las reglas de URL salen de `lib/urlrules.ts` y la fuente de `lib/sources.ts`:
 * añadir otra plataforma no exige tocar esta ruta, y las fuentes sin listado
 * (YouTube en fase 1) se descartan con `501` antes de invocarlas.
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
  const raw = typeof payload.url === "string" ? payload.url : "";
  const classified = classifyInput(raw);

  if (!classified || classified.kind !== "profile") {
    return NextResponse.json(
      { ok: false, error: "Esa URL no parece la de un perfil." },
      { status: 400 },
    );
  }

  // Las reglas ya han reconocido la plataforma; aún así se resuelve la fuente
  // por su registro para no dar por hecho que sólo puede existir una.
  const source = sourceForPlatform(classified.slug);
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "Esa plataforma todavía no tiene una fuente verificada." },
      { status: 501 },
    );
  }
  if (source.supportsProfiles === false) {
    const name = getPlatform(classified.slug)?.name ?? "esa plataforma";
    return NextResponse.json(
      { ok: false, error: `Los canales de ${name} aún no están disponibles.` },
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

  const key = profilePageKey(classified.url, cursor, page);
  const cached = profilePageCache.get(key) as Awaited<ReturnType<typeof source.listProfilePage>> | undefined;
  if (cached) {
    return NextResponse.json({
      ok: true,
      count: cached.items.length,
      max,
      page: cached.page,
      items: cached.items,
      meta: cached.meta ?? null,
      next_cursor: cached.nextCursor,
      cached: true,
    });
  }

  try {
    const result = await source.listProfilePage(classified.url, cursor, page, max);
    // TTL corto a propósito: el enlace de descarga de cada tarjeta es un token
    // JWT de ~1 h, así que servirlo más tarde que eso daría enlaces muertos.
    profilePageCache.set(key, result, PROFILE_PAGE_TTL_MS);
    return NextResponse.json({
      ok: true,
      count: result.items.length,
      max,
      page: result.page,
      items: result.items,
      meta: result.meta ?? null,
      next_cursor: result.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
