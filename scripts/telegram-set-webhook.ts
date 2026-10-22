/**
 * Registra (o borra) el webhook del bot de Telegram.
 *
 *   npm run telegram:webhook -- https://red-ly.vercel.app
 *   npm run telegram:webhook -- https://red-ly.vercel.app --delete
 *
 * Lee `TELEGRAM_BOT_TOKEN` y `TELEGRAM_WEBHOOK_SECRET` del entorno o de
 * `.env.local` (cargado a mano: los scripts no pasan por Next). Si falta el
 * secreto se genera uno y se imprime: cópialo a Vercel como
 * `TELEGRAM_WEBHOOK_SECRET` para que el webhook lo valide.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TelegramApi } from "../lib/telegram";

/** Carga `.env` y `.env.local` sin dependencias (los scripts no usan Next). */
function loadDotEnv(): void {
  for (const file of [".env", ".env.local"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  }
}

/** Secreto aleatorio suficientemente largo para `secret_token` de Telegram. */
function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fail(message: string): never {
  console.error(`  ✗ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadDotEnv();

  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith("--")));
  const baseUrl = (args[0] ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\/.+/.test(baseUrl)) {
    fail("Indica la URL pública al final: npm run telegram:webhook -- https://tu-app.vercel.app");
  }

  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) fail("Falta TELEGRAM_BOT_TOKEN (en el entorno o en .env.local).");

  let secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!secret && !flags.has("--delete")) {
    secret = randomSecret();
    console.log("  · Secreto generado. Añádelo en Vercel como TELEGRAM_WEBHOOK_SECRET:");
    console.log(`    TELEGRAM_WEBHOOK_SECRET=${secret}\n`);
  }

  const api = new TelegramApi({ token });
  const me = await api.getMe().catch((error: Error) => fail(`getMe falló: ${error.message}`));
  console.log(`  · Bot: @${me.username ?? me.id}`);

  if (flags.has("--delete")) {
    await api.deleteWebhook().catch((error: Error) => fail(`deleteWebhook falló: ${error.message}`));
    console.log("  ✓ Webhook borrado.");
    return;
  }

  const url = `${baseUrl}/api/telegram/webhook`;
  await api
    .setWebhook(url, secret)
    .catch((error: Error) => fail(`setWebhook falló: ${error.message}`));
  console.log(`  ✓ Webhook registrado: ${url}`);
  console.log("  · Telegram enviará los updates con la cabecera del secreto configurado.");
}

main().catch((error: Error) => fail(error.message));
