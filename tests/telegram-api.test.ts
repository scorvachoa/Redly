import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramApi, TelegramApiError } from "@/lib/telegram";

const TOKEN = "TESTTOKEN";

let calls: { url: string; body: unknown; isForm: boolean }[] = [];
let queue: Response[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    calls.push({ url, body, isForm: typeof FormData !== "undefined" && body instanceof FormData });
    if (queue.length === 0) throw new Error("no hay respuestas encoladas");
    return queue.shift() as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function api(): TelegramApi {
  return new TelegramApi({ token: TOKEN, baseUrl: "https://telegram.test" });
}

function ok(result: unknown = true): Response {
  return jsonResponse({ ok: true, result });
}

describe("TelegramApi", () => {
  it("apunta al método con el token en la URL", async () => {
    queue.push(ok({ message_id: 1, chat: { id: 5, type: "private" } }));

    await api().sendMessage(5, "hola");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://telegram.test/bot${TOKEN}/sendMessage`);
    expect(calls[0].isForm).toBe(false);
    expect(calls[0].body).toEqual({ chat_id: 5, text: "hola" });
  });

  it("devuelve el `result` de la respuesta", async () => {
    queue.push(ok({ id: 7, is_bot: true, username: "redly_bot" }));

    const me = await api().getMe();

    expect(me.username).toBe("redly_bot");
  });

  it("convierte `ok: false` en TelegramApiError con la descripción", async () => {
    queue.push(jsonResponse({ ok: false, error_code: 400, description: "chat not found" }, 400));

    const error = await api().sendMessage(5, "hola").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).message).toBe("chat not found");
    expect((error as TelegramApiError).method).toBe("sendMessage");
    expect((error as TelegramApiError).statusCode).toBe(400);
    expect((error as TelegramApiError).retryable).toBe(false);
  });

  it("marca como reintentables los 429 y los 5xx", async () => {
    queue.push(jsonResponse({ ok: false, error_code: 429, description: "flood" }, 429));
    const first = await api().sendMessage(5, "x").catch((e: unknown) => e);
    expect((first as TelegramApiError).retryable).toBe(true);

    queue.push(jsonResponse({ ok: false, error_code: 502, description: "bad" }, 502));
    const second = await api().sendMessage(5, "x").catch((e: unknown) => e);
    expect((second as TelegramApiError).retryable).toBe(true);
  });

  it("rechaza un token vacío sin llamar a la red", async () => {
    const disabled = new TelegramApi({ token: "" });

    const error = await disabled.getMe().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect(calls).toHaveLength(0);
  });

  it("envía sendVideo con URL como JSON", async () => {
    queue.push(ok({ message_id: 2, chat: { id: 5, type: "private" } }));

    await api().sendVideo(5, { url: "https://cdn.test/v.mp4" }, { caption: "título" });

    expect(calls[0].isForm).toBe(false);
    expect(calls[0].body).toEqual({
      chat_id: 5,
      video: "https://cdn.test/v.mp4",
      caption: "título",
      supports_streaming: true,
    });
  });

  it("envía sendVideo con archivo como multipart", async () => {
    queue.push(ok({ message_id: 3, chat: { id: 5, type: "private" } }));

    await api().sendVideo(5, { file: { blob: new Blob(["x"]), filename: "Redly_1.mp4" } });

    expect(calls[0].isForm).toBe(true);
    const form = calls[0].body as FormData;
    expect(form.get("chat_id")).toBe("5");
    expect(form.get("video")).toBeInstanceOf(File);
    expect((form.get("video") as File).name).toBe("Redly_1.mp4");
  });

  it("sendMediaGroup lleva el caption sólo en la primera foto", async () => {
    queue.push(ok([{ message_id: 4, chat: { id: 5, type: "private" } }]));

    await api().sendMediaGroup(5, ["https://cdn.test/1.jpg", "https://cdn.test/2.jpg"], "t");

    const body = calls[0].body as { media: { type: string; media: string; caption?: string }[] };
    expect(body.media).toHaveLength(2);
    expect(body.media[0].caption).toBe("t");
    expect(body.media[1].caption).toBeUndefined();
    expect(body.media.every((item) => item.type === "photo")).toBe(true);
  });

  it("setWebhook incluye el secreto como `secret_token`", async () => {
    queue.push(ok(true));

    await api().setWebhook("https://app.test/api/telegram/webhook", "SECRETO");

    expect(calls[0].body).toEqual({
      url: "https://app.test/api/telegram/webhook",
      drop_pending_updates: true,
      secret_token: "SECRETO",
    });
  });

  it("sendChatAction no propaga errores (es cosmético)", async () => {
    queue.push(jsonResponse({ ok: false, description: "nope" }, 400));

    await expect(api().sendChatAction(5, "typing")).resolves.toBeUndefined();
  });

  it("un cuerpo sin JSON se convierte en error con el estado HTTP", async () => {
    queue.push(new Response("<html>nope</html>", { status: 502 }));

    const error = await api().getMe().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).statusCode).toBe(502);
  });
});
