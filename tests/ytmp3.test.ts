import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError } from "@/lib/exceptions";
import { SnapYTSource } from "@/lib/snapyt";

const PLAYLIST = "https://www.youtube.com/playlist?list=PLtest123";
const CANAL = "https://www.youtube.com/@rickastley";
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

interface RecordedCall {
  url: string;
  method: string;
}

interface StubItem {
  id: string;
  title?: string;
  channel?: string;
  thumbnail?: string | null;
}

interface StubPage {
  items: StubItem[];
  nextPageToken?: string;
}

let calls: RecordedCall[] = [];
/** Páginas del servicio, indexadas por `pageToken` (`null` = primera página). */
let pages: Map<string | null, StubPage>;
let ogTitle: string | null;
/** Cuando está activo, el servicio de metadatos responde texto plano (no JSON). */
let forcePlainMeta: boolean;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html" } });
}

function plainResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

beforeEach(() => {
  calls = [];
  ogTitle = "Lista de prueba";
  forcePlainMeta = false;
  pages = new Map<string | null, StubPage>([
    [
      null,
      {
        items: [
          {
            id: "aaaaaaaaaaa",
            title: "Vídeo uno",
            channel: "Autor uno",
            thumbnail: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
          },
          { id: "bbbbbbbbbbb", title: "Vídeo dos", channel: "Autor dos", thumbnail: null },
        ],
        nextPageToken: "TOK1",
      },
    ],
    [
      "TOK1",
      { items: [{ id: "ccccccccccc", title: "Vídeo tres", channel: "Autor tres", thumbnail: null }] },
    ],
  ]);

  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    const parsed = new URL(url);

    if (parsed.hostname === "yt-meta.convert1s.com") {
      if (parsed.searchParams.get("id") !== "PLtest123") {
        // Id inválido: el servicio responde 500 con cuerpo de texto plano.
        return plainResponse("All attempts failed. Last error: YouTube API status 400", 500);
      }
      if (forcePlainMeta) {
        return plainResponse("esto no es json", 200);
      }
      const page = pages.get(parsed.searchParams.get("pageToken"));
      if (!page) return plainResponse("sin página", 500);
      return jsonResponse({
        items: page.items,
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      });
    }

    if (parsed.hostname === "www.youtube.com") {
      return htmlResponse(ogTitle ? `<meta property="og:title" content="${ogTitle}">` : "<html></html>");
    }

    throw new Error(`URL no soportada en el mock: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function metaCalls(): RecordedCall[] {
  return calls.filter((call) => call.url.includes("yt-meta.convert1s.com"));
}

function titleCalls(): RecordedCall[] {
  return calls.filter((call) => call.url.includes("www.youtube.com"));
}

describe("SnapYTSource.listProfilePage (listas vía YTMP3.gg)", () => {
  it("lista una página y mapea los vídeos a ProfileVideo", async () => {
    const source = new SnapYTSource();

    const page = await source.listProfilePage(PLAYLIST);

    expect(page.items).toHaveLength(2);
    const first = page.items[0]!;
    expect(first.id).toBe("aaaaaaaaaaa");
    expect(first.title).toBe("Vídeo uno");
    expect(first.channel).toBe("Autor uno");
    expect(first.thumbnail).toBe("https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg");
    // url y postUrl apuntan al watch URL: la descarga por lotes resuelve la
    // calidad máxima vía /api/search.
    expect(first.url).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    expect(first.postUrl).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    expect(page.page).toBe(1);
  });

  it("pide el listado a yt-meta y el título a la página de YouTube", async () => {
    const source = new SnapYTSource();

    const page = await source.listProfilePage(PLAYLIST);

    expect(metaCalls()[0]?.url).toContain("yt-meta.convert1s.com/playlist?id=PLtest123");
    expect(titleCalls()).toHaveLength(1);
    expect(titleCalls()[0]?.url).toContain("list=PLtest123");
    // El servicio no expone el total de la lista.
    expect(page.meta).toEqual({
      title: "Lista de prueba",
      channel: "Autor uno",
      total: null,
    });
  });

  it("pagina con el token opaco y no vuelve a pedir el título", async () => {
    const source = new SnapYTSource();

    const pageOne = await source.listProfilePage(PLAYLIST);
    expect(pageOne.nextCursor).toBe("TOK1");

    const pageTwo = await source.listProfilePage(PLAYLIST, "TOK1", 2);
    expect(pageTwo.items).toHaveLength(1);
    expect(pageTwo.items[0]?.id).toBe("ccccccccccc");
    expect(pageTwo.nextCursor).toBeNull();

    // La segunda llamada reutiliza el cursor como `pageToken`; el título sólo
    // se pide en la primera página.
    expect(metaCalls()[1]?.url).toContain("pageToken=TOK1");
    expect(titleCalls()).toHaveLength(1);
  });

  it("recorta la página al límite pedido", async () => {
    const source = new SnapYTSource();

    const page = await source.listProfilePage(PLAYLIST, null, 1, 1);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe("aaaaaaaaaaa");
  });

  it("con el título ausente el meta conserva el canal", async () => {
    ogTitle = null;
    const source = new SnapYTSource();

    const page = await source.listProfilePage(PLAYLIST);

    expect(page.meta).toEqual({ title: null, channel: "Autor uno", total: null });
  });

  it("rechaza un canal antes de tocar la red", async () => {
    const source = new SnapYTSource();

    await expect(source.listProfilePage(CANAL)).rejects.toThrow(RequestError);
    await expect(source.listProfilePage(CANAL)).rejects.toThrow(/canales/i);
    expect(calls).toHaveLength(0);
  });

  it("rechaza una URL que no es lista ni canal", async () => {
    const source = new SnapYTSource();

    await expect(source.listProfilePage(VIDEO)).rejects.toThrow(/lista de reproducción/i);
    expect(calls).toHaveLength(0);
  });

  it("convierte el 500 del servicio (id inválido) en error", async () => {
    const source = new SnapYTSource();

    await expect(
      source.listProfilePage("https://www.youtube.com/playlist?list=NOEXISTE"),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("falla si el servicio devuelve algo que no es JSON", async () => {
    forcePlainMeta = true;
    const source = new SnapYTSource();

    await expect(source.listProfilePage(PLAYLIST)).rejects.toThrow(/no JSON/);
  });
});
