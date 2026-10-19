import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestError, UnavailableError } from "@/lib/exceptions";
import { prepareMergedDownload } from "@/lib/snapyt";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const CANAL = "https://www.youtube.com/@rickastley";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const PREVIEW_HTML = fixture("snapyt_preview.html");

const STATUS_URL = "https://www.snapyt.app/wp-admin/admin-ajax.php?action=vd_mux_status&job=job1&nonce=cn";
const DOWNLOAD_URL =
  "https://www.snapyt.app/wp-admin/admin-ajax.php?action=vd_mux&job=job1&nonce=cn&tg=137%2B140";

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

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "Content-Type": "text/html" } });
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
    if (queue.length === 0) throw new Error("no hay respuestas encoladas");
    return queue.shift() as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Coloca el flujo previo estándar: nonce → redirect → preview. */
function queuePreview(): void {
  queue.push(jsonResponse({ success: true, data: { nonce: "abc123def4" } }));
  queue.push(
    jsonResponse({
      success: true,
      data: {
        redirect:
          "https://www.snapyt.app/video-preview/?preview_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&q=test",
      },
    }),
  );
  queue.push(htmlResponse(PREVIEW_HTML));
}

/** Respuesta de `vd_mux_start` con las tres URLs del trabajo. */
function startResponse(): Response {
  return jsonResponse({
    success: true,
    data: {
      job_id: "job1",
      poll_interval: 2500,
      px_used: 0,
      status_url: STATUS_URL,
      cancel_url: "https://www.snapyt.app/wp-admin/admin-ajax.php?action=vd_mux_cancel&job=job1&nonce=cn",
      download_url: DOWNLOAD_URL,
    },
  });
}

function muxStarts(): RecordedCall[] {
  return calls.filter((call) => call.body.includes("action=vd_mux_start"));
}

// ---------------------------------------------------------------------------
// prepareMergedDownload
// ---------------------------------------------------------------------------
describe("prepareMergedDownload", () => {
  it("resuelve preview → start → estado done y devuelve el enlace", async () => {
    queuePreview();
    queue.push(startResponse());
    queue.push(jsonResponse({ success: true, data: { status: "done", download_url: DOWNLOAD_URL } }));

    const url = await prepareMergedDownload(VIDEO, "5", "17");

    expect(url).toBe(DOWNLOAD_URL);
    expect(calls).toHaveLength(5);

    // Las tres primeras llamadas son las de siempre (nonce/redirect/preview).
    expect(calls[0].body).toContain("action=vd_fresh_nonce");
    expect(calls[1].body).toContain("action=process_video_url");
    expect(calls[2].method).toBe("GET");
    expect(calls[2].url).toContain("video-preview");

    // El arranque lleva pid/nonce del formulario y la ruta directa (px=0).
    const start = muxStarts()[0];
    expect(start.method).toBe("POST");
    expect(start.url).toContain("admin-ajax.php");
    expect(start.body).toContain("pid=TESTPID0000000000");
    expect(start.body).toContain("nonce=TESTNONCE0");
    expect(start.body).toContain("&v=5");
    expect(start.body).toContain("&a=17");
    expect(start.body).toContain("&px=0");

    // La consulta de estado usa la URL que devolvió el arranque.
    expect(calls[4].method).toBe("GET");
    expect(calls[4].url).toBe(STATUS_URL);
  });

  it("rechaza una URL que no es un vídeo sin llegar a la red", async () => {
    await expect(prepareMergedDownload(CANAL, "5", "17")).rejects.toBeInstanceOf(RequestError);
    expect(calls).toHaveLength(0);
  });

  it("rechaza índices que no son números sin llegar a la red", async () => {
    await expect(prepareMergedDownload(VIDEO, "abc", "17")).rejects.toBeInstanceOf(RequestError);
    await expect(prepareMergedDownload(VIDEO, "5", "x")).rejects.toBeInstanceOf(RequestError);
    expect(calls).toHaveLength(0);
  });

  it("valida v/a contra las opciones del preview recién resuelto", async () => {
    queuePreview();

    await expect(prepareMergedDownload(VIDEO, "99", "17")).rejects.toBeInstanceOf(RequestError);
    // Sólo el flujo de preview: nunca se lanza un trabajo.
    expect(calls).toHaveLength(3);
    expect(muxStarts()).toHaveLength(0);
  });

  it("si la ruta directa falla, reintenta en la de reserva (px=1)", async () => {
    queuePreview();
    queue.push(startResponse());
    queue.push(
      jsonResponse({
        success: true,
        data: { status: "error", message: "No se pudo combinar en la ruta directa." },
      }),
    );
    queue.push(startResponse());
    queue.push(jsonResponse({ success: true, data: { status: "done", download_url: DOWNLOAD_URL } }));

    const url = await prepareMergedDownload(VIDEO, "5", "17");

    expect(url).toBe(DOWNLOAD_URL);
    const starts = muxStarts();
    expect(starts).toHaveLength(2);
    expect(starts[0].body).toContain("&px=0");
    expect(starts[1].body).toContain("&px=1");
  });

  it("espera la puerta de inicio cuando el servidor pide retry_in", async () => {
    queuePreview();
    queue.push(jsonResponse({ success: false, data: { retry_in: 1, message: "Starting." } }));
    queue.push(startResponse());
    queue.push(jsonResponse({ success: true, data: { status: "done", download_url: DOWNLOAD_URL } }));

    const url = await prepareMergedDownload(VIDEO, "5", "17");

    expect(url).toBe(DOWNLOAD_URL);
    // Dos envíos: el primero en la puerta, el segundo cuando ya respondió.
    expect(muxStarts()).toHaveLength(2);
  });

  it("un estado 404 en la consulta se reporta como no disponible", async () => {
    queuePreview();
    queue.push(startResponse());
    queue.push(new Response("gone", { status: 404 }));
    queue.push(startResponse());
    queue.push(new Response("gone", { status: 404 }));

    await expect(prepareMergedDownload(VIDEO, "5", "17")).rejects.toBeInstanceOf(UnavailableError);
    expect(muxStarts()).toHaveLength(2);
  });

  it("un enlace de descarga fuera de la lista blanca no se reintenta", async () => {
    queuePreview();
    queue.push(startResponse());
    queue.push(
      jsonResponse({
        success: true,
        data: { status: "done", download_url: "https://evil.example.com/merged.mp4" },
      }),
    );

    await expect(prepareMergedDownload(VIDEO, "5", "17")).rejects.toThrow(/no permitido/);
    // Error no reintentable: sólo un arranque.
    expect(muxStarts()).toHaveLength(1);
  });

  it("si el arranque falla del todo, se propaga el mensaje del servicio", async () => {
    queuePreview();
    queue.push(jsonResponse({ success: false, data: { message: "Merge unavailable." } }));
    queue.push(jsonResponse({ success: false, data: { message: "Merge unavailable." } }));

    await expect(prepareMergedDownload(VIDEO, "5", "17")).rejects.toThrow("Merge unavailable.");
    expect(muxStarts()).toHaveLength(2);
  });
});
