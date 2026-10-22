import { NextResponse } from "next/server";

import { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } from "@/lib/config";
import {
  createBotDeps,
  handleTelegramUpdate,
  isWebhookSecretValid,
} from "@/lib/telegram-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Un envío grande (vídeo + descarga de respaldo) puede tardar: se reserva
// margen dentro del tope serverless.
export const maxDuration = 60;

/**
 * POST /api/telegram/webhook
 *
 * Recibe los updates del bot de Telegram (registrado con `secret_token` por
 * `npm run telegram:webhook`). Antes de tocar nada se valida la cabecera
 * `X-Telegram-Bot-Api-Secret-Token` con comparación en tiempo constante.
 *
 * Siempre responde **200** cuando el secreto es correcto —incluso si el
 * procesado falla—: si Telegram no recibe 200, reintenta el update (el dedupe
 * por `update_id` de `lib/telegram-bot.ts` evita dobles envíos).
 *
 * Sin `TELEGRAM_BOT_TOKEN` el bot está desactivado: responde 200 vacío.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: "Bot desactivado." }, { status: 200 });
  }

  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!isWebhookSecretValid(secret, TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: "Secreto inválido." }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  // `handleTelegramUpdate` no lanza: los errores se notifican al usuario (si
  // es posible) y el webhook responde 200 igual para no entrar en reintentos.
  await handleTelegramUpdate(update, createBotDeps());
  return NextResponse.json({ ok: true });
}
