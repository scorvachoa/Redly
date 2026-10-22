import { describe, expect, it, vi } from "vitest";

import { TtlCache } from "@/lib/cache";
import { UnavailableError } from "@/lib/exceptions";
import type { TikTokResult } from "@/lib/models";
import { RateLimiter } from "@/lib/ratelimit";
import { TelegramApi, TelegramApiError } from "@/lib/telegram";
import { handleTelegramUpdate, isWebhookSecretValid, type BotDeps } from "@/lib/telegram-bot";

// ---------------------------------------------------------------------------
// Dobles de prueba
// ---------------------------------------------------------------------------

interface ApiCall {
  method: string;
  args: unknown[];
}

class FakeApi {
  readonly calls: ApiCall[] = [];
  /** Fallos inyectados por método (se consumen uno por llamada). */
  readonly failNext = new Map<string, number>();

  record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  of(method: string): ApiCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  messages(): string[] {
    return this.of("sendMessage").map((call) => call.args[1] as string);
  }

  takeFailure(method: string): TelegramApiError | null {
    const remaining = this.failNext.get(method) ?? 0;
    if (remaining <= 0) return null;
    this.failNext.set(method, remaining - 1);
    return new TelegramApiError({ method, message: "wrong file identifier", statusCode: 400 });
  }
}

function makeApi(): FakeApi & TelegramApi {
  const fake = new FakeApi() as FakeApi & TelegramApi;
  fake.sendMessage = (chatId: number, text: string) => {
    fake.record("sendMessage", chatId, text);
    return Promise.resolve({ message_id: 1, chat: { id: chatId, type: "private" } });
  };
  fake.sendChatAction = (chatId: number, action: string) => {
    fake.record("sendChatAction", chatId, action);
    return Promise.resolve();
  };
  fake.sendVideo = (chatId: number, media: unknown, options?: unknown) => {
    fake.record("sendVideo", chatId, media, options);
    const failure = fake.takeFailure("sendVideo");
    if (failure) return Promise.reject(failure);
    return Promise.resolve({ message_id: 2, chat: { id: chatId, type: "private" } });
  };
  fake.sendPhoto = (chatId: number, media: unknown, options?: unknown) => {
    fake.record("sendPhoto", chatId, media, options);
    const failure = fake.takeFailure("sendPhoto");
    if (failure) return Promise.reject(failure);
    return Promise.resolve({ message_id: 3, chat: { id: chatId, type: "private" } });
  };
  fake.sendMediaGroup = (chatId: number, photos: string[], caption?: string | null) => {
    fake.record("sendMediaGroup", chatId, photos, caption);
    const failure = fake.takeFailure("sendMediaGroup");
    if (failure) return Promise.reject(failure);
    return Promise.resolve([{ message_id: 4, chat: { id: chatId, type: "private" } }]);
  };
  fake.sendDocument = (chatId: number, media: unknown) => {
    fake.record("sendDocument", chatId, media);
    return Promise.resolve({ message_id: 5, chat: { id: chatId, type: "private" } });
  };
  return fake;
}

const CHAT = 111;

interface HarnessOptions {
  allowed?: string[];
  limiterMax?: number;
  searchVideo?: (url: string) => Promise<TikTokResult>;
  resolvePreparedUrl?: (relativeUrl: string) => Promise<string>;
  fetchFile?: (url: string) => Promise<{ blob: Blob; contentType: string | null }>;
  maxFileBytes?: number;
}

function harness(options: HarnessOptions = {}) {
  const api = makeApi();
  const deps: BotDeps = {
    api,
    allowedChatIds: new Set(options.allowed ?? [String(CHAT)]),
    limiter: new RateLimiter({ windowSeconds: 60, max: options.limiterMax ?? 20 }),
    seenUpdates: new TtlCache<boolean>({ maxEntries: 100 }),
    searchVideo: options.searchVideo ?? (async () => TIKTOK_RESULT),
    resolvePreparedUrl:
      options.resolvePreparedUrl ?? (async () => "https://cdn.test/preparado.mp4"),
    fetchFile:
      options.fetchFile ??
      (async () => ({ blob: new Blob(["video"]), contentType: "video/mp4" })),
    maxFileBytes: options.maxFileBytes ?? 50 * 1024 * 1024,
  };
  return { api, deps };
}

function updateWith(text: string | undefined, chatId = CHAT, updateId = 1): unknown {
  return {
    update_id: updateId,
    message: {
      message_id: updateId * 10,
      chat: { id: chatId, type: "private" },
      date: 0,
      ...(text === undefined ? {} : { text }),
    },
  };
}

// ---------------------------------------------------------------------------
// Resultados de ejemplo (patrones de las fuentes reales)
// ---------------------------------------------------------------------------

const TIKTOK_RESULT: TikTokResult = {
  videoId: "7311111111111111111",
  title: "Vídeo de prueba",
  downloads: [
    {
      name: "SD",
      url: "https://cdn.test/sd.mp4",
      format: "mp4",
      quality: "standard",
      kind: "video",
      hasAudio: true,
    },
    {
      name: "HD",
      url: "https://cdn.test/hd.mp4",
      format: "mp4",
      quality: "hd",
      kind: "video",
      hasAudio: true,
    },
  ],
};

const PHOTOS_RESULT: TikTokResult = {
  videoId: "7322222222222222222",
  title: "Publicación con fotos",
  downloads: [
    { name: "1", url: "https://cdn.test/1.jpg", format: "jpg", kind: "image" },
    { name: "2", url: "https://cdn.test/2.jpg", format: "jpg", kind: "image" },
    { name: "3", url: "https://cdn.test/3.jpg", format: "jpg", kind: "image" },
  ],
};

const YT_MERGE_RESULT: TikTokResult = {
  videoId: "dQw4w9WgXcQ",
  title: "YouTube 1080p",
  downloads: [
    {
      name: "1080p",
      url: "/api/merge?yt=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&v=1080&a=128",
      format: "mp4",
      quality: "1080p",
      kind: "video",
    },
    {
      name: "720p",
      url: "https://cdn.test/720.mp4",
      format: "mp4",
      quality: "720p",
      kind: "video",
      hasAudio: true,
    },
  ],
};

const MIXED_RESULT: TikTokResult = {
  videoId: "7333333333333333333",
  title: "Vídeo y fotos",
  downloads: [
    {
      name: "HD",
      url: "https://cdn.test/mix.mp4",
      format: "mp4",
      quality: "hd",
      kind: "video",
      hasAudio: true,
    },
    { name: "1", url: "https://cdn.test/mix1.jpg", format: "jpg", kind: "image" },
    { name: "2", url: "https://cdn.test/mix2.jpg", format: "jpg", kind: "image" },
  ],
};

const TIKTOK_VIDEO = "https://www.tiktok.com/@usuario/video/7311111111111111111";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isWebhookSecretValid", () => {
  it("acepta sólo una coincidencia exacta", () => {
    expect(isWebhookSecretValid("abc123", "abc123")).toBe(true);
    expect(isWebhookSecretValid("abc124", "abc123")).toBe(false);
    expect(isWebhookSecretValid("abc", "abc123")).toBe(false);
    expect(isWebhookSecretValid(null, "abc123")).toBe(false);
    expect(isWebhookSecretValid(undefined, "abc123")).toBe(false);
  });

  it("un secreto vacío en config nunca valida", () => {
    expect(isWebhookSecretValid("", "")).toBe(false);
    expect(isWebhookSecretValid("cualquiera", "")).toBe(false);
  });
});

describe("handleTelegramUpdate · comandos y allowlist", () => {
  it("/start responde la ayuda sin analizar nada", async () => {
    const searchVideo = vi.fn(async () => TIKTOK_RESULT);
    const { api, deps } = harness({ searchVideo });

    await handleTelegramUpdate(updateWith("/start"), deps);

    expect(api.messages()).toHaveLength(1);
    expect(api.messages()[0]).toContain("TikTok, YouTube, Facebook, Instagram, X o Threads");
    expect(searchVideo).not.toHaveBeenCalled();
  });

  it("/help funciona igual y un comando desconocido avisa", async () => {
    const { api, deps } = harness();

    await handleTelegramUpdate(updateWith("/help@redly_bot", CHAT, 1), deps);
    await handleTelegramUpdate(updateWith("/foo", CHAT, 2), deps);

    const messages = api.messages();
    expect(messages[0]).toContain("Red.ly bot");
    expect(messages[1]).toContain("Comando no reconocido");
  });

  it("ignora los chats fuera de la allowlist sin contestar", async () => {
    const { api, deps } = harness({ allowed: ["999"] });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    expect(api.calls).toHaveLength(0);
  });

  it("una allowlist vacía no deja entrar a nadie", async () => {
    const { api, deps } = harness({ allowed: [] });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    expect(api.calls).toHaveLength(0);
  });

  it("ignora los mensajes sin texto", async () => {
    const { api, deps } = harness();

    await handleTelegramUpdate(updateWith(undefined), deps);

    expect(api.calls).toHaveLength(0);
  });
});

describe("handleTelegramUpdate · clasificación", () => {
  it("una entrada no reconocida pide una URL soportada", async () => {
    const { api, deps } = harness();

    await handleTelegramUpdate(updateWith("hola, ¿qué tal?"), deps);

    expect(api.messages()[0]).toContain("No reconozco esa URL");
  });

  it("una URL de perfil avisa que use la web", async () => {
    const { api, deps } = harness();

    await handleTelegramUpdate(updateWith("https://www.tiktok.com/@scout2015"), deps);

    expect(api.messages()[0]).toContain("perfiles");
    expect(api.messages()[0]).toContain("https://red-ly.vercel.app");
  });

  it("una URL sin vídeo concreto se descarta con su mensaje", async () => {
    const { api, deps } = harness();

    await handleTelegramUpdate(updateWith("https://www.youtube.com/"), deps);

    expect(api.messages()[0]).toContain("no corresponde a un vídeo concreto");
  });

  it("extrae la URL de un texto de compartir de TikTok y ignora el enlace promocional", async () => {
    const searchVideo = vi.fn(async () => TIKTOK_RESULT);
    const { api, deps } = harness({ searchVideo });

    await handleTelegramUpdate(
      updateWith(
        "¡Echa un vistazo al vídeo de 🍄𝐃𝐉 𝐊𝐀𝐓𝐀𝐋𝐄𝐘𝐀🦋! #TikTok https://vm.tiktok.com/ZSgPuHxtw/ " +
          "Esta publicación se ha compartido a través de TikTok Lite. Para disfrutar de más " +
          "publicaciones, descarga TikTok Lite: https://www.tiktok.com/tiktoklite",
      ),
      deps,
    );

    expect(searchVideo).toHaveBeenCalledTimes(1);
    expect(searchVideo).toHaveBeenCalledWith("https://vm.tiktok.com/ZSgPuHxtw/");
    expect(api.of("sendVideo")).toHaveLength(1);
  });

  it("con texto alrededor funciona en cualquier plataforma y recorta la puntuación final", async () => {
    const searchVideo = vi.fn(async () => YT_MERGE_RESULT);
    const resolvePreparedUrl = vi.fn(async () => "https://cdn.test/combinado.mp4");
    const { api, deps } = harness({ searchVideo, resolvePreparedUrl });

    await handleTelegramUpdate(
      updateWith("Mira este vídeo que me acaban de pasar: https://youtu.be/dQw4w9WgXcQ ¡increíble!"),
      deps,
    );

    expect(searchVideo).toHaveBeenCalledWith("https://youtu.be/dQw4w9WgXcQ");
    expect(api.of("sendVideo")).toHaveLength(1);
  });

  it("un texto de compartir con una URL de perfil sigue avisando para usar la web", async () => {
    const { api, deps } = harness();

    await handleTelegramUpdate(
      updateWith("Sígueme en TikTok: https://www.tiktok.com/@scout2015 para ver más vídeos"),
      deps,
    );

    expect(api.messages()[0]).toContain("perfiles");
  });
});

describe("handleTelegramUpdate · envío de vídeo", () => {
  it("envía el vídeo en la mejor calidad directamente, sin preguntar", async () => {
    const searchVideo = vi.fn(async () => TIKTOK_RESULT);
    const { api, deps } = harness({ searchVideo });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    expect(searchVideo).toHaveBeenCalledTimes(1);
    const videos = api.of("sendVideo");
    expect(videos).toHaveLength(1);
    const media = videos[0].args[1] as { url?: string; file?: unknown };
    expect(media.url).toBe("https://cdn.test/hd.mp4");
    expect(media.file).toBeUndefined();
    const options = videos[0].args[2] as { caption?: string };
    expect(options.caption).toBe("Vídeo de prueba");
  });

  it("resuelve la combinación de YouTube antes de enviar", async () => {
    const searchVideo = vi.fn(async () => YT_MERGE_RESULT);
    const resolvePreparedUrl = vi.fn(async (_relativeUrl: string) => "https://cdn.test/combinado.mp4");
    const { api, deps } = harness({ searchVideo, resolvePreparedUrl });

    await handleTelegramUpdate(updateWith("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), deps);

    expect(resolvePreparedUrl).toHaveBeenCalledTimes(1);
    const relative = resolvePreparedUrl.mock.calls[0][0] as string;
    expect(relative.startsWith("/api/merge?")).toBe(true);
    const media = api.of("sendVideo")[0].args[1] as { url?: string };
    expect(media.url).toBe("https://cdn.test/combinado.mp4");
  });

  it("si Telegram no baja la URL, sube el archivo como respaldo", async () => {
    const { api, deps } = harness();
    api.failNext.set("sendVideo", 1);

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    const videos = api.of("sendVideo");
    expect(videos).toHaveLength(2);
    expect((videos[0].args[1] as { url?: string }).url).toBe("https://cdn.test/hd.mp4");
    const fallback = videos[1].args[1] as { url?: string; file?: { filename: string } };
    expect(fallback.url).toBeUndefined();
    expect(fallback.file?.filename).toBe("Redly_7311111111111111111.mp4");
  });

  it("un archivo que supera el límite se explica al usuario", async () => {
    const { api, deps } = harness({
      maxFileBytes: 10,
      fetchFile: async () => ({ blob: new Blob(["01234567890"]), contentType: "video/mp4" }),
    });
    api.failNext.set("sendVideo", 1);

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    expect(api.messages()[0]).toContain("supera el límite");
  });
});

describe("handleTelegramUpdate · fotos", () => {
  it("varias fotos se envían como álbum con el título en la primera", async () => {
    const searchVideo = vi.fn(async () => PHOTOS_RESULT);
    const { api, deps } = harness({ searchVideo });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    const groups = api.of("sendMediaGroup");
    expect(groups).toHaveLength(1);
    const photos = groups[0].args[1] as string[];
    expect(photos).toEqual(["https://cdn.test/1.jpg", "https://cdn.test/2.jpg", "https://cdn.test/3.jpg"]);
    expect(groups[0].args[2]).toBe("Publicación con fotos");
    expect(api.of("sendVideo")).toHaveLength(0);
  });

  it("una foto sola va con sendPhoto y su fallback", async () => {
    const single: TikTokResult = {
      videoId: "7344444444444444444",
      title: "Foto única",
      downloads: [{ name: "1", url: "https://cdn.test/una.jpg", format: "jpg", kind: "image" }],
    };
    const { api, deps } = harness({ searchVideo: async () => single });
    api.failNext.set("sendPhoto", 1);

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    const photos = api.of("sendPhoto");
    expect(photos).toHaveLength(2);
    expect((photos[0].args[1] as { url?: string }).url).toBe("https://cdn.test/una.jpg");
    const fallback = photos[1].args[1] as { file?: { filename: string } };
    expect(fallback.file?.filename).toBe("Redly_7344444444444444444.jpg");
  });

  it("un resultado mixto envía el vídeo y después las fotos", async () => {
    const { api, deps } = harness({ searchVideo: async () => MIXED_RESULT });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    expect(api.of("sendVideo")).toHaveLength(1);
    const groups = api.of("sendMediaGroup");
    expect(groups).toHaveLength(1);
    expect(groups[0].args[1]).toEqual(["https://cdn.test/mix1.jpg", "https://cdn.test/mix2.jpg"]);
  });
});

describe("handleTelegramUpdate · errores y control", () => {
  it("UnavailableError se muestra con su propio texto", async () => {
    const { api, deps } = harness({
      searchVideo: async () => {
        throw new UnavailableError("El contenido solicitado no existe o es privado.");
      },
    });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    expect(api.messages()[0]).toBe("El contenido solicitado no existe o es privado.");
  });

  it("un fallo genérico del servicio pide reintentar", async () => {
    const { api, deps } = harness({
      searchVideo: async () => {
        throw new Error("boom");
      },
    });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO), deps);

    expect(api.messages()[0]).toContain("El servicio no respondió");
  });

  it("limita por chat y avisa al pasarse", async () => {
    const { api, deps } = harness({ limiterMax: 1 });

    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO, CHAT, 1), deps);
    await handleTelegramUpdate(updateWith(TIKTOK_VIDEO, CHAT, 2), deps);

    expect(api.messages().at(-1)).toContain("Demasiadas peticiones");
  });

  it("un update repetido (reintento del webhook) se procesa una sola vez", async () => {
    const searchVideo = vi.fn(async () => TIKTOK_RESULT);
    const { api, deps } = harness({ searchVideo });
    const payload = updateWith(TIKTOK_VIDEO);

    await handleTelegramUpdate(payload, deps);
    await handleTelegramUpdate(payload, deps);

    expect(searchVideo).toHaveBeenCalledTimes(1);
    expect(api.of("sendVideo")).toHaveLength(1);
  });

  it("ignora updates con forma ajena a un mensaje", async () => {
    const { api, deps } = harness();

    await handleTelegramUpdate({ update_id: 1, callback_query: {} }, deps);
    await handleTelegramUpdate("no soy un update", deps);
    await handleTelegramUpdate(null, deps);

    expect(api.calls).toHaveLength(0);
  });
});
