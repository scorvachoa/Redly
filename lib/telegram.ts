/**
 * Cliente de la Bot API de Telegram, con fetch nativo (sin dependencias).
 *
 * Motivo de existir: el proyecto no quiere librerías de bots (grammY,
 * telegraf…); aquí sólo se envuelven los métodos que el bot necesita, con los
 * mismos criterios que el resto del repo: sin cookies, sin tokens personales
 * (el token es el del bot, configurable por entorno) y con errores claros.
 *
 * Apt servidor: lo usan `lib/telegram-bot.ts` (lógica) y
 * `scripts/telegram-set-webhook.ts` (registro del webhook). No importa
 * `next/*`.
 */

import { DOWNLOAD_TIMEOUT, REQUEST_TIMEOUT } from "./config";
import { fetchWithTimeout } from "./http";

export const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

// ---------------------------------------------------------------------------
// Tipos mínimos de la Bot API (sólo lo que el bot usa)
// ---------------------------------------------------------------------------

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  username?: string;
  first_name?: string;
  title?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  /** Soporte para mensajes reenviados con enlace (la web de Telegram). */
  forward_origin?: unknown;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  callback_query?: unknown;
}

/** Respuesta normalizada de un método de envío. */
export interface TelegramSentMessage {
  message_id: number;
  chat: TelegramChat;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/**
 * Fallo de la Bot API: método, código HTTP y la `description` del cuerpo.
 *
 * `retryable` marca los fallos transitorios (429, 5xx): el bot no reintenta
 * por sí mismo (el webhook vuelve a llegar con el mismo `update_id`), pero el
 * dato queda para los logs.
 */
export class TelegramApiError extends Error {
  readonly method: string;
  readonly statusCode: number | null;
  readonly description: string | null;
  readonly retryable: boolean;

  constructor(options: {
    method: string;
    message: string;
    statusCode?: number | null;
    description?: string | null;
  }) {
    super(options.message);
    this.name = "TelegramApiError";
    this.method = options.method;
    this.statusCode = options.statusCode ?? null;
    this.description = options.description ?? null;
    this.retryable = this.statusCode === 429 || (this.statusCode !== null && this.statusCode >= 500);
  }
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/** Un medio que Telegram acepta como URL o como archivo subido. */
export interface TelegramMediaInput {
  /** URL que Telegram descarga directamente (tope 50 MB). */
  url?: string;
  /** Archivo a subir vía multipart (fallback cuando la URL no sirve). */
  file?: { blob: Blob; filename: string };
}

export interface TelegramApiOptions {
  /** Token del bot (@BotFather). Cadena vacía = cliente desactivado. */
  token: string;
  /** Base de la API (sobreescribible en tests). */
  baseUrl?: string;
}

type TelegramPayload = Record<string, unknown> | FormData;

export class TelegramApi {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: TelegramApiOptions) {
    this.token = options.token ?? "";
    this.baseUrl = (options.baseUrl ?? TELEGRAM_API_BASE_URL).replace(/\/+$/, "");
  }

  /** ¿Hay token configurado? Fuera de `false`, el bot está desactivado. */
  get enabled(): boolean {
    return this.token !== "";
  }

  /**
   * Llama a un método de la Bot API.
   *
   * `FormData` se envía tal cual (fetch pone el boundary); cualquier otro
   * payload va como JSON. Un `ok: false` de la API se convierte en
   * `TelegramApiError` con el mensaje de `description`.
   */
  async call<T>(method: string, payload: TelegramPayload, timeoutMs?: number): Promise<T> {
    if (!this.enabled) {
      throw new TelegramApiError({ method, message: "Bot de Telegram sin token configurado." });
    }
    const isForm = payload instanceof FormData;
    const response = await fetchWithTimeout(
      `${this.baseUrl}/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: isForm ? undefined : { "Content-Type": "application/json" },
        body: isForm ? payload : JSON.stringify(payload),
      },
      timeoutMs ?? REQUEST_TIMEOUT * 1000,
    );

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new TelegramApiError({
        method,
        message: `Telegram respondió HTTP ${response.status} sin JSON.`,
        statusCode: response.status,
      });
    }

    const record = (body ?? {}) as { ok?: unknown; result?: unknown; description?: unknown };
    if (record.ok !== true) {
      const description =
        typeof record.description === "string" && record.description
          ? record.description
          : null;
      throw new TelegramApiError({
        method,
        message: description ?? `Telegram rechazó ${method} (HTTP ${response.status}).`,
        statusCode: response.status,
        description,
      });
    }
    return record.result as T;
  }

  // --- Métodos de gestión -------------------------------------------------

  getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe", {});
  }

  setWebhook(url: string, secretToken?: string): Promise<boolean> {
    const payload: Record<string, unknown> = { url, drop_pending_updates: true };
    if (secretToken) payload.secret_token = secretToken;
    return this.call<boolean>("setWebhook", payload);
  }

  deleteWebhook(): Promise<boolean> {
    return this.call<boolean>("deleteWebhook", { drop_pending_updates: false });
  }

  // --- Métodos de envío ---------------------------------------------------

  sendMessage(chatId: number, text: string): Promise<TelegramSentMessage> {
    return this.call<TelegramSentMessage>(
      "sendMessage",
      { chat_id: chatId, text },
      REQUEST_TIMEOUT * 1000,
    );
  }

  /** Acción de estado («escribiendo…» / «subiendo vídeo…»); siempre best-effort. */
  async sendChatAction(chatId: number, action: "typing" | "upload_video" | "upload_photo"): Promise<void> {
    try {
      await this.call<boolean>("sendChatAction", { chat_id: chatId, action }, 10_000);
    } catch {
      // Cosmético: un fallo aquí no debe abortar el envío del resultado.
    }
  }

  sendVideo(
    chatId: number,
    media: TelegramMediaInput,
    options?: { caption?: string | null; supportsStreaming?: boolean },
  ): Promise<TelegramSentMessage> {
    return this.call<TelegramSentMessage>(
      "sendVideo",
      mediaPayload("video", chatId, media, {
        ...(options?.caption ? { caption: options.caption } : {}),
        supports_streaming: options?.supportsStreaming ?? true,
      }),
      DOWNLOAD_TIMEOUT * 1000,
    );
  }

  sendPhoto(
    chatId: number,
    media: TelegramMediaInput,
    options?: { caption?: string | null },
  ): Promise<TelegramSentMessage> {
    return this.call<TelegramSentMessage>(
      "sendPhoto",
      mediaPayload("photo", chatId, media, options?.caption ? { caption: options.caption } : {}),
      DOWNLOAD_TIMEOUT * 1000,
    );
  }

  sendDocument(
    chatId: number,
    media: TelegramMediaInput,
    options?: { caption?: string | null },
  ): Promise<TelegramSentMessage> {
    return this.call<TelegramSentMessage>(
      "sendDocument",
      mediaPayload("document", chatId, media, options?.caption ? { caption: options.caption } : {}),
      DOWNLOAD_TIMEOUT * 1000,
    );
  }

  /**
   * Envía un álbum de fotos (2–10 elementos, sólo URL).
   *
   * La Bot API no admite archivos en `sendMediaGroup`: cuando una foto tenga
   * que subirse, el caller la envía una a una con `sendPhoto`.
   */
  sendMediaGroup(
    chatId: number,
    photos: string[],
    caption?: string | null,
  ): Promise<TelegramSentMessage[]> {
    const media = photos.map((photo, index) => ({
      type: "photo",
      media: photo,
      ...(caption && index === 0 ? { caption } : {}),
    }));
    return this.call<TelegramSentMessage[]>(
      "sendMediaGroup",
      { chat_id: chatId, media },
      DOWNLOAD_TIMEOUT * 1000,
    );
  }
}

/**
 * Cuerpo de un método con medio: JSON con la URL, o `FormData` con el archivo.
 */
function mediaPayload(
  field: "video" | "photo" | "document",
  chatId: number,
  media: TelegramMediaInput,
  extra: Record<string, unknown>,
): TelegramPayload {
  if (media.file) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null) continue;
      form.append(key, String(value));
    }
    form.append(field, media.file.blob, media.file.filename);
    return form;
  }
  return { chat_id: chatId, [field]: media.url, ...extra };
}
