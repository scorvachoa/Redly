import { NextResponse } from "next/server";

import { clientKey, apiLimiter } from "@/lib/ratelimit";
import { detectPlatformSlug, sourceForPlatform } from "@/lib/sources";
import { searchAny } from "@/lib/savetik";
import { inputToTikTokUrl, isTikTokUrl, isProfileUrl } from "@/lib/urls";

import { errorResponse } from "../_responses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/search  { "url": "https://www.tiktok.com/@user/video/123" }
 *
 * Resuelve un vídeo suelto: intenta la fuente primaria (SavTikPro) y, si
 * falla, cae a TikVid. Devuelve el título, id, miniatura y las opciones de
 * descarga.
 *
 * La plataforma se resuelve por el host de la URL vía `lib/sources.ts`: si no
 * hay fuente verificada se responde 501 en lugar de intentar adivinar.
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

  const url =
    typeof (body as { url?: unknown })?.url === "string"
      ? inputToTikTokUrl((body as { url: string }).url)
      : "";

  if (!isTikTokUrl(url)) {
    return NextResponse.json(
      { ok: false, error: "La URL no parece una URL válida de TikTok." },
      { status: 400 },
    );
  }

  if (isProfileUrl(url)) {
    return NextResponse.json(
      { ok: false, error: "Esa URL es de un perfil. Usa POST /api/profile." },
      { status: 400 },
    );
  }

  const source = sourceForPlatform(detectPlatformSlug(url));
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "Esa plataforma todavía no tiene una fuente verificada." },
      { status: 501 },
    );
  }

  try {
    const result = await searchAny(url);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
