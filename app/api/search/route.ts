import { NextResponse } from "next/server";

import { clientKey, apiLimiter } from "@/lib/ratelimit";
import { getPlatform } from "@/lib/platforms";
import { sourceForPlatform } from "@/lib/sources";
import { classifyInput } from "@/lib/urlrules";

import { errorResponse } from "../_responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/search  { "url": "https://www.tiktok.com/@user/video/123" }
 *
 * Resuelve un vídeo suelto contra la fuente de su plataforma (TikTok e
 * Instagram con fallback incluido, YouTube vía SnapYT). Devuelve el título,
 * id, miniatura y
 * las opciones de descarga.
 *
 * La plataforma y el tipo de URL se deciden con `lib/urlrules.ts` antes de
 * tocar la fuente: si no hay reglas ni fuente verificada se responde `400`/`501`
 * en lugar de intentar adivinar.
 */
export async function POST(request: Request): Promise<NextResponse> {
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

  const raw = typeof (body as { url?: unknown })?.url === "string"
    ? (body as { url: string }).url
    : "";
  const classified = classifyInput(raw);
  if (!classified) {
    return NextResponse.json(
      { ok: false, error: "La URL no parece de una plataforma soportada." },
      { status: 400 },
    );
  }

  const name = getPlatform(classified.slug)?.name ?? "esa plataforma";
  const source = sourceForPlatform(classified.slug);
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "Esa plataforma todavía no tiene una fuente verificada." },
      { status: 501 },
    );
  }

  if (classified.kind === "profile") {
    if (source.supportsProfiles === false) {
      return NextResponse.json(
        { ok: false, error: `Los canales de ${name} aún no están disponibles.` },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Esa URL es de un perfil. Usa POST /api/profile." },
      { status: 400 },
    );
  }

  if (classified.kind === "unsupported") {
    return NextResponse.json(
      { ok: false, error: `Esa URL de ${name} no corresponde a un vídeo concreto.` },
      { status: 400 },
    );
  }

  try {
    const result = await source.searchVideo(classified.url);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
