import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import { anonymousKey, SavetikSource, searchAny } from "@/lib/savetik";

const PERFIL = "https://www.tiktok.com/@scout2015";
const VIDEO = "https://www.tiktok.com/@scout2015/video/6718335390845095173";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const PROFILE_HTML = fixture("savetik_profile_page.html");
const DETAIL_HTML = fixture("savetik_detail.html");

interface RecordedCall {
  url: string;
  method: string;
  body: string;
}

let calls: RecordedCall[] = [];
let queue: Response[] = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function profileBody(data: string, nextCursor?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { status: "ok", pageType: "profile", data };
  if (nextCursor !== undefined) body.next_cursor = nextCursor;
  return body;
}

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : "";
    calls.push({ url, method, body });
    if (method === "GET") return new Response("ok", { status: 200 });
    if (queue.length === 0) throw new Error("no hay respuestas encoladas");
    return queue.shift() as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function posts(): RecordedCall[] {
  return calls.filter((call) => call.method === "POST");
}

function params(call: RecordedCall): URLSearchParams {
  return new URLSearchParams(call.body);
}

// ---------------------------------------------------------------------------
// Clasificación de URLs (compartida con el cliente)
// ---------------------------------------------------------------------------
describe("anonymousKey", () => {
  it("es estable y distinta por URL", () => {
    expect(anonymousKey("https://x/a")).toBe(anonymousKey("https://x/a"));
    expect(anonymousKey("https://x/a")).not.toBe(anonymousKey("https://x/b"));
    expect(anonymousKey("https://x/a")).toHaveLength(16);
  });
});

// ---------------------------------------------------------------------------
// Tarjetas de perfil
// ---------------------------------------------------------------------------
describe("listProfile", () => {
  it("extrae los campos de cada tarjeta", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const items = await source.listProfile(PERFIL, 1);

    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first.id).toBe("7694475743509646622");
    expect(first.title).toBe("Why did Stella do THAT? #pool #fail");
    expect(first.channel).toBe("Scout, Suki & Stella");
    expect(first.views).toBe("1.8K");
    expect(first.url).toContain("https://pro.snapcdn.app/dl?token=FAKE_TOKEN_A");
    expect(first.format).toBe("mp4");
    expect(first.thumbnail).toBe("https://cdn.example/thumb1.jpeg");
  });

  it("pagina con cursor y page incrementales", async () => {
    const page2 = PROFILE_HTML.replace("7123456789012345678", "9999999999999999999");
    queue.push(jsonResponse(profileBody(PROFILE_HTML, "1759000000")));
    queue.push(jsonResponse(profileBody(page2)));
    const source = new SavetikSource();

    const items = await source.listProfile(PERFIL);

    expect(items.map((item) => item.id)).toEqual([
      "7694475743509646622",
      "7001234567890123456",
      "7123456789012345678",
      "9999999999999999999",
    ]);
    expect(posts()).toHaveLength(2);
    expect(params(posts()[0]).get("cursor")).toBe("0");
    expect(params(posts()[0]).get("page")).toBe("1");
    expect(params(posts()[1]).get("cursor")).toBe("1759000000");
    expect(params(posts()[1]).get("page")).toBe("2");
  });

  it("respeta maxVideos y no pide más páginas", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const items = await source.listProfile(PERFIL, 2);

    expect(items).toHaveLength(2);
    expect(posts()).toHaveLength(1);
  });

  it("quita la barra final del payload (evita 404)", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    await source.listProfile(`${PERFIL}/`, 1);

    expect(params(posts()[0]).get("q")).toBe(PERFIL);
  });

  it("nunca envía cursor vacío", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    await source.listProfile(PERFIL, 1);

    const cursor = params(posts()[0]).get("cursor");
    expect(cursor).not.toBe("");
    expect(cursor).not.toBeNull();
  });

  it("deduplica los vídeos repetidos entre páginas", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML, "111")));
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const items = await source.listProfile(PERFIL);

    expect(items).toHaveLength(3);
  });

  it("rechaza una URL que no es de perfil", async () => {
    const source = new SavetikSource();
    await expect(source.listProfile(VIDEO)).rejects.toBeInstanceOf(RequestError);
    expect(posts()).toHaveLength(0);
  });

  it("invoca onPage tras cada página", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();
    const seen: Array<[number, number]> = [];

    await source.listProfile(PERFIL, 1, (page, total) => seen.push([page, total]));

    expect(seen).toEqual([[1, 1]]);
  });
});

// ---------------------------------------------------------------------------
// listProfilePage (una petición = una página)
// ---------------------------------------------------------------------------
describe("listProfilePage", () => {
  it("devuelve una página y el cursor para la siguiente", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML, "1759000000")));
    const source = new SavetikSource();

    const page = await source.listProfilePage(PERFIL);

    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBe("1759000000");
    expect(page.page).toBe(1);
    expect(posts()).toHaveLength(1);
  });

  it("devuelve nextCursor null en la última página", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const page = await source.listProfilePage(PERFIL);

    expect(page.nextCursor).toBeNull();
  });

  it("normaliza el cursor vacío a 0 (con vacío SavTikPro responde 404)", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    await source.listProfilePage(PERFIL, "");

    expect(params(posts()[0]).get("cursor")).toBe("0");
  });

  it("reutiliza el cursor recibido y el número de página", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    await source.listProfilePage(PERFIL, "42", 7);

    expect(params(posts()[0]).get("cursor")).toBe("42");
    expect(params(posts()[0]).get("page")).toBe("7");
  });

  it("recorta la página al límite pedido", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const page = await source.listProfilePage(PERFIL, null, 1, 2);

    expect(page.items).toHaveLength(2);
  });

  it("sin HTML devuelve página vacía y sin cursor", async () => {
    queue.push(jsonResponse({ status: "ok", data: "" }));
    const source = new SavetikSource();

    const page = await source.listProfilePage(PERFIL);

    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it("si el servicio devuelve el mismo cursor, corta el bucle", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML, "0")));
    const source = new SavetikSource();

    const page = await source.listProfilePage(PERFIL);

    expect(page.nextCursor).toBeNull();
  });

  it("rechaza una URL que no es de perfil", async () => {
    const source = new SavetikSource();
    await expect(source.listProfilePage(VIDEO)).rejects.toBeInstanceOf(RequestError);
  });
});

// ---------------------------------------------------------------------------
// listProfilePending (salta lo ya descargado)
// ---------------------------------------------------------------------------
describe("listProfilePending", () => {
  it("devuelve sólo los pendientes y cuenta los omitidos", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();
    const done = new Set(["7694475743509646622"]);

    const result = await source.listProfilePending(PERFIL, (item) => done.has(item.id));

    expect(result.items.map((item) => item.id)).toEqual([
      "7001234567890123456",
      "7123456789012345678",
    ]);
    expect(result.skipped).toBe(1);
  });

  it("pagina hasta reunir el número de pendientes pedido", async () => {
    // Página 1 entera ya descargada; la 2 aporta uno nuevo.
    const page2 = PROFILE_HTML.replace("7123456789012345678", "9999999999999999999");
    queue.push(jsonResponse(profileBody(PROFILE_HTML, "111")));
    queue.push(jsonResponse(profileBody(page2)));
    const source = new SavetikSource();
    const done = new Set([
      "7694475743509646622",
      "7001234567890123456",
      "7123456789012345678",
    ]);

    const result = await source.listProfilePending(PERFIL, (item) => done.has(item.id), 1);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("9999999999999999999");
    expect(result.skipped).toBe(3);
    expect(posts()).toHaveLength(2);
  });

  it("se detiene cuando se agota el cursor", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const result = await source.listProfilePending(PERFIL, () => true, 5);

    expect(result.items).toHaveLength(0);
    expect(result.skipped).toBe(3);
    expect(posts()).toHaveLength(1);
  });

  it("invoca onPage con pendientes y omitidos", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();
    const seen: Array<[number, number, number]> = [];

    await source.listProfilePending(
      PERFIL,
      (item) => item.id === "7694475743509646622",
      undefined,
      (page, pending, skipped) => seen.push([page, pending, skipped]),
    );

    expect(seen).toEqual([[1, 2, 1]]);
  });

  it("acepta un isDone asíncrono", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const result = await source.listProfilePending(
      PERFIL,
      async (item) => item.id === "7694475743509646622",
    );

    expect(result.items).toHaveLength(2);
    expect(result.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// searchVideo
// ---------------------------------------------------------------------------
describe("searchVideo", () => {
  it("parsea el HTML de detalle", async () => {
    queue.push(jsonResponse({ status: "ok", pageType: "detail", data: DETAIL_HTML }));
    const source = new SavetikSource();

    const result = await source.searchVideo(VIDEO);

    expect(result.videoId).toBe("6718335390845095173");
    expect(result.downloads.length).toBeGreaterThanOrEqual(2);
  });

  it("lanza UnavailableError si no hay datos", async () => {
    queue.push(jsonResponse({ status: "ok", data: "" }));
    const source = new SavetikSource();

    await expect(source.searchVideo(VIDEO)).rejects.toBeInstanceOf(UnavailableError);
  });

  it("propaga el mensaje cuando status no es ok", async () => {
    queue.push(jsonResponse({ status: "fail", statusCode: 404, message: "Video not found." }));
    const source = new SavetikSource();

    await expect(source.searchVideo(VIDEO)).rejects.toThrow("Video not found.");
  });

  it("HTTP 404 se traduce en contenido no disponible", async () => {
    queue.push(jsonResponse({}, 404));
    const source = new SavetikSource();

    await expect(source.listProfile(PERFIL)).rejects.toBeInstanceOf(UnavailableError);
  });

  it("reintenta ante errores transitorios", async () => {
    queue.push(jsonResponse({}, 503));
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const items = await source.listProfile(PERFIL, 1);

    expect(items).toHaveLength(1);
    expect(posts()).toHaveLength(2);
  });

  it("lanza error si la respuesta no es JSON", async () => {
    queue.push(new Response("<html>no json</html>", { status: 200 }));
    const source = new SavetikSource();

    await expect(source.searchVideo(VIDEO)).rejects.toBeInstanceOf(RequestError);
  });
});

// ---------------------------------------------------------------------------
// searchAny (fallback)
// ---------------------------------------------------------------------------
describe("searchAny", () => {
  it("usa SavTikPro cuando funciona", async () => {
    queue.push(jsonResponse({ status: "ok", pageType: "detail", data: DETAIL_HTML }));
    const onFallback = vi.fn();

    const result = await searchAny(VIDEO, { onFallback });

    expect(result.downloads.length).toBeGreaterThan(0);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("cae a TikVid cuando SavTikPro no devuelve opciones", async () => {
    queue.push(jsonResponse({ status: "ok", data: "" }));
    const onFallback = vi.fn();
    const tikvid = {
      search: vi.fn().mockResolvedValue({
        videoId: "1",
        downloads: [{ name: "MP4", url: "https://cdn.example/x.mp4", format: "mp4", quality: "hd" }],
      }),
    };

    const result = await searchAny(VIDEO, { tikvid: tikvid as never, onFallback });

    expect(result.videoId).toBe("1");
    expect(onFallback).toHaveBeenCalled();
    expect(tikvid.search).toHaveBeenCalledWith(VIDEO);
  });

  it("propaga el error si ambas fuentes fallan", async () => {
    queue.push(jsonResponse({ status: "ok", data: "" }));
    const tikvid = {
      search: vi.fn().mockRejectedValue(new RequestError("sin suerte")),
    };

    await expect(searchAny(VIDEO, { tikvid: tikvid as never })).rejects.toThrow("sin suerte");
  });
});

describe("selectores de tarjeta con fallback", () => {
  /**
   * El contenedor `.video-item` es lo bastante estable como para darlo por
   * supuesto, pero el interior cambia de nombre cada vez que el servicio
   * rediseña. Antes cualquier cambio ahí devolvía una lista vacía en silencio;
   * ahora se cae a los selectores de respaldo de `PROFILE_SELECTORS`.
   */
  const RENAMED_HTML = `
    <div class="video-item">
      <a class="dl-btn" data-name="scout2015_6718335390845095173_hd.mp4"
         href="https://pro.snapcdn.app/dl?token=abc">dl</a>
      <h3>Título renombrado</h3>
      <span class="author-name">canal</span>
      <span class="view-count">1.2M</span>
      <img src="https://cdn.example/t.jpg" />
    </div>
  `;

  it("sigue extrayendo cuando renombran las clases internas", async () => {
    queue.push(jsonResponse(profileBody(RENAMED_HTML)));
    const source = new SavetikSource();

    const result = await source.listProfilePage(PERFIL);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Título renombrado");
    expect(result.items[0].channel).toBe("canal");
    expect(result.items[0].views).toBe("1.2M");
    expect(result.items[0].thumbnail).toBe("https://cdn.example/t.jpg");
    expect(result.items[0].format).toBe("mp4");
  });

  it("el enlace cae a href de snapcdn si no hay .pro-dl-link", async () => {
    queue.push(jsonResponse(profileBody(RENAMED_HTML)));
    const source = new SavetikSource();

    const result = await source.listProfilePage(PERFIL);

    expect(result.items[0].url).toContain("snapcdn.app");
  });

  it("el id sale del nombre del archivo cuando trae uno embebido", async () => {
    queue.push(jsonResponse(profileBody(RENAMED_HTML)));
    const source = new SavetikSource();

    const result = await source.listProfilePage(PERFIL);

    // Id de TikTok (19 dígitos) embebido en el data-name del enlace.
    expect(result.items[0].id).toBe("6718335390845095173");
  });

  it("una tarjeta sin enlace se descarta y no rompe el resto", async () => {
    const html = `
      <div class="video-item"><h3>sin enlace</h3></div>
      ${RENAMED_HTML}
    `;
    queue.push(jsonResponse(profileBody(html)));
    const source = new SavetikSource();

    const result = await source.listProfilePage(PERFIL);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Título renombrado");
  });

  it("con los selectores primarios intactos se comporta igual que antes", async () => {
    queue.push(jsonResponse(profileBody(PROFILE_HTML)));
    const source = new SavetikSource();

    const result = await source.listProfilePage(PERFIL);

    expect(result.items.length).toBeGreaterThan(0);
  });
});

describe("contrato ContentSource", () => {
  it("SavetikSource declara id y plataformas", () => {
    const source = new SavetikSource();

    expect(source.id).toBe("savetikpro");
    expect(source.platforms).toContain("tiktok");
  });
});
