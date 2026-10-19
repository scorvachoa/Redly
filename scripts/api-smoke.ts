/**
 * Smoke test de la capa API de Red.ly.
 *
 * Invoca los handlers de `app/api/*` con `Request` reales (exactamente lo que
 * Next ejecuta en producción) contra la red real, sin necesidad de levantar el
 * servidor. Se descarta tras la verificación.
 *
 *   npx tsx scripts/api-smoke.ts
 */

import { readFileSync } from "node:fs";

import { GET as downloadGET } from "../app/api/download/route";
import { GET as mergeGET } from "../app/api/merge/route";
import { POST as profilePOST } from "../app/api/profile/route";
import { POST as searchPOST } from "../app/api/search/route";

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

const VIDEO_URL = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
const PROFILE_URL = "https://www.tiktok.com/@scout2015";
const YOUTUBE_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YOUTUBE_CHANNEL = "https://www.youtube.com/@dazegreen";
const YOUTUBE_PLAYLIST_BAD = "https://www.youtube.com/playlist?list=PL1234567890";
// Lista pública corta (3 vídeos) usada para verificar el listado real.
const YOUTUBE_PLAYLIST =
  "https://www.youtube.com/playlist?list=PLo6SgbXOmkypx2OnccNBHzj7V4wFZ600e";

async function main(): Promise<void> {
  // 1. POST /api/search con un vídeo real ---------------------------------
  console.log("\n[1] POST /api/search (vídeo real)");
  const searchResponse = await searchPOST(jsonRequest("/api/search", { url: VIDEO_URL }));
  const searchBody = (await searchResponse.json()) as {
    ok?: boolean;
    error?: string;
    result?: { title?: string; videoId?: string; downloads?: unknown[] };
  };
  assert(searchResponse.status === 200, `HTTP 200 (recibido ${searchResponse.status})`);
  assert(searchBody.ok === true, "respuesta ok=true");
  assert(Boolean(searchBody.result?.title), `título: ${searchBody.result?.title?.slice(0, 40)}`);
  assert(
    (searchBody.result?.downloads?.length ?? 0) >= 2,
    `${searchBody.result?.downloads?.length} opciones de descarga`,
  );

  // 2. Validaciones de la API (sin red) -----------------------------------
  console.log("\n[2] Validaciones de /api/search");
  const badUrl = await searchPOST(jsonRequest("/api/search", { url: "https://example.com/x" }));
  assert(badUrl.status === 400, "rechaza URL que no es de TikTok (400)");

  const profileAsVideo = await searchPOST(jsonRequest("/api/search", { url: PROFILE_URL }));
  assert(profileAsVideo.status === 400, "rechaza una URL de perfil en /search (400)");

  // 3. POST /api/profile ---------------------------------------------------
  console.log("\n[3] POST /api/profile (perfil real)");
  const profileResponse = await profilePOST(jsonRequest("/api/profile", { url: PROFILE_URL, max: 3 }));
  const profileBody = (await profileResponse.json()) as {
    ok?: boolean;
    count?: number;
    items?: Array<{ id: string; title?: string; url: string; format?: string }>;
  };
  assert(profileResponse.status === 200, `HTTP 200 (recibido ${profileResponse.status})`);
  assert(profileBody.ok === true, "respuesta ok=true");
  assert((profileBody.items?.length ?? 0) >= 1, `${profileBody.count} vídeos listados`);
  assert(
    Boolean(profileBody.items?.[0]?.url.startsWith("https://pro.snapcdn.app/")),
    "el primer enlace es de pro.snapcdn.app",
  );
  // El JSON de la API no debe filtrar el token en campos distintos de `url`
  // (el propio campo `url` es temporal y se consume al momento).
  const first = profileBody.items?.[0];
  assert(Boolean(first?.id && first?.title), `primer vídeo: ${first?.title?.slice(0, 30)}`);

  // 3b. Paginación por cursor ---------------------------------------------
  console.log("\n[3b] POST /api/profile paginado con cursor");
  const pageOneResponse = await profilePOST(
    jsonRequest("/api/profile", { url: PROFILE_URL, max: 2 }),
  );
  const pageOne = (await pageOneResponse.json()) as {
    ok?: boolean;
    page?: number;
    next_cursor?: string | null;
    items?: Array<{ id: string }>;
  };
  assert(pageOne.ok === true, "primera página ok=true");
  assert(
    typeof pageOne.next_cursor === "string" && pageOne.next_cursor !== "",
    `next_cursor de la página 1: ${pageOne.next_cursor}`,
  );

  const pageTwoResponse = await profilePOST(
    jsonRequest("/api/profile", {
      url: PROFILE_URL,
      max: 2,
      cursor: pageOne.next_cursor,
      page: 2,
    }),
  );
  const pageTwo = (await pageTwoResponse.json()) as {
    ok?: boolean;
    page?: number;
    items?: Array<{ id: string }>;
  };
  assert(pageTwo.ok === true, "segunda página ok=true");
  assert(pageTwo.page === 2, `page=2 (recibido ${String(pageTwo.page)})`);

  const pageOneIds = new Set((pageOne.items ?? []).map((item) => item.id));
  const overlap = (pageTwo.items ?? []).filter((item) => pageOneIds.has(item.id));
  assert(overlap.length === 0, "sin solape de vídeos entre páginas");
  assert(
    (pageTwo.items ?? []).length > 0,
    `${pageTwo.items?.length ?? 0} vídeos nuevos en la página 2`,
  );

  // 4. Validaciones de /api/profile ---------------------------------------
  console.log("\n[4] Validaciones de /api/profile");
  const notProfile = await profilePOST(jsonRequest("/api/profile", { url: VIDEO_URL }));
  assert(notProfile.status === 400, "rechaza una URL de vídeo (400)");

  // 5. GET /api/download (stream real + anti proxy abierto) ---------------
  console.log("\n[5] GET /api/download (stream real)");
  assert(first, "hay un enlace de descarga para probar");

  const downloadResponse = await downloadGET(
    new Request(
      `http://localhost/api/download?url=${encodeURIComponent(first.url)}&name=smoke.mp4`,
    ),
  );
  assert(
    downloadResponse.status === 200,
    `HTTP 200 del stream (recibido ${downloadResponse.status})`,
  );
  const disposition = downloadResponse.headers.get("content-disposition") ?? "";
  assert(disposition.includes("attachment"), `Content-Disposition: ${disposition}`);

  // Leer una parte del stream para confirmar que viajan bytes reales.
  const reader = downloadResponse.body?.getReader();
  assert(reader, "la respuesta trae un body stream legible");
  let received = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value?.length ?? 0;
      if (received > 64 * 1024) break; // basta con una muestra
    }
    await reader.cancel();
  }
  assert(received > 0, `bytes recibidos del CDN: ${received.toLocaleString()}`);

  console.log("\n[6] GET /api/download rechaza hosts no permitidos");
  const proxyAttack = await downloadGET(
    new Request("http://localhost/api/download?url=" + encodeURIComponent("http://evil.example.com/x")),
  );
  assert(proxyAttack.status === 400, "rechaza un host fuera de la lista blanca (400)");

  // 7. YouTube: vídeo suelto ------------------------------------------------
  console.log("\n[7] POST /api/search (vídeo de YouTube real)");
  const ytResponse = await searchPOST(jsonRequest("/api/search", { url: YOUTUBE_VIDEO }));
  const ytBody = (await ytResponse.json()) as {
    ok?: boolean;
    error?: string;
    result?: {
      title?: string;
      videoId?: string;
      downloads?: Array<{ quality?: string; kind?: string; format?: string; url: string }>;
    };
  };
  // Fuente única de YouTube: SnapYT (nonce → preview → proxy de descarga).
  if (!ytBody.ok) console.log(`  ↳ ${ytBody.error ?? "(sin mensaje)"}`);
  assert(ytResponse.status === 200, `HTTP 200 (recibido ${ytResponse.status})`);
  assert(ytBody.ok === true, `respuesta ok=true (${ytBody.error ?? "sin error"})`);
  assert(Boolean(ytBody.result?.title), `título: ${ytBody.result?.title?.slice(0, 40)}`);

  const ytDownloads = ytBody.result?.downloads ?? [];
  assert(ytDownloads.length >= 1, `${ytDownloads.length} opciones de descarga`);

  const resolutionOf = (quality?: string): number => {
    const match = /(\d{3,4})p/.exec(quality ?? "");
    return match ? Number(match[1]) : 0;
  };
  const ytVideos = ytDownloads.filter((option) => option.kind === "video");
  let descending = true;
  for (let i = 1; i < ytVideos.length; i += 1) {
    if (resolutionOf(ytVideos[i - 1]?.quality) < resolutionOf(ytVideos[i]?.quality)) {
      descending = false;
    }
  }
  assert(
    ytVideos.length < 2 || descending,
    `opciones de vídeo ordenadas: ${ytVideos.map((option) => option.quality).join(", ")}`,
  );

  // La opción de máxima calidad es `video-only` en SnapYT: su URL debe ser la
  // ruta de combinación de Red.ly, no un enlace directo.
  const firstYt = ytDownloads[0];
  assert(
    Boolean(firstYt && firstYt.url.startsWith("/api/merge?")),
    `la primera opción combina vídeo+audio (${firstYt?.url.slice(0, 40)}…)`,
  );

  // Fase 1: SnapYT une las pistas en su servidor y devuelve la URL temporal.
  const mergeResponse = await mergeGET(new Request(`http://localhost${firstYt!.url}`));
  const mergeBody = (await mergeResponse.json()) as { ok?: boolean; error?: string; url?: string };
  assert(
    mergeResponse.status === 200,
    `merge HTTP 200 (recibido ${mergeResponse.status}: ${mergeBody.error ?? "ok"})`,
  );
  assert(mergeBody.ok === true && Boolean(mergeBody.url), "combinación lista: URL temporal");

  // Fase 2: descarga normal del archivo ya con audio.
  const ytDownloadResponse = await downloadGET(
    new Request(
      `http://localhost/api/download?url=${encodeURIComponent(mergeBody.url ?? "")}&name=smoke-yt.mp4`,
    ),
  );
  assert(
    ytDownloadResponse.status === 200,
    `stream de YouTube HTTP 200 (recibido ${ytDownloadResponse.status})`,
  );
  const ytReader = ytDownloadResponse.body?.getReader();
  let ytReceived = 0;
  if (ytReader) {
    for (;;) {
      const { value, done } = await ytReader.read();
      if (done) break;
      ytReceived += value?.length ?? 0;
      if (ytReceived > 64 * 1024) break;
    }
    await ytReader.cancel();
  }
  assert(ytReceived > 0, `bytes del archivo combinado: ${ytReceived.toLocaleString()}`);

  // 8. YouTube: validaciones de canales y búsquedas --------------------------
  console.log("\n[8] YouTube: validaciones de canales y búsquedas");
  const ytChannel = await searchPOST(jsonRequest("/api/search", { url: YOUTUBE_CHANNEL }));
  assert(ytChannel.status === 400, "rechaza un canal en /search (400)");

  // Los canales se clasifican como perfil, pero la fuente los rechaza (502):
  // el listado de canales de YouTube no se ofrece todavía.
  const ytChannelProfile = await profilePOST(jsonRequest("/api/profile", { url: YOUTUBE_CHANNEL }));
  assert(ytChannelProfile.status === 502, "/api/profile de un canal → 502 (rechazado)");

  const ytPlaylistSearch = await searchPOST(jsonRequest("/api/search", { url: YOUTUBE_PLAYLIST_BAD }));
  assert(ytPlaylistSearch.status === 400, "rechaza una lista de reproducción en /search (400)");

  // 9. YouTube: lista de reproducción real (vía YTMP3.gg) ----------------
  console.log("\n[9] POST /api/profile (lista de YouTube real)");
  const ytPlaylistResponse = await profilePOST(
    jsonRequest("/api/profile", { url: YOUTUBE_PLAYLIST, max: 3 }),
  );
  const ytPlaylistBody = (await ytPlaylistResponse.json()) as {
    ok?: boolean;
    error?: string;
    count?: number;
    meta?: { title?: string | null; channel?: string | null; total?: number | null } | null;
    items?: Array<{ id: string; title?: string; url: string; postUrl?: string }>;
  };
  if (!ytPlaylistBody.ok) console.log(`  ↳ ${ytPlaylistBody.error ?? "(sin mensaje)"}`);
  assert(
    ytPlaylistResponse.status === 200,
    `HTTP 200 (recibido ${ytPlaylistResponse.status}: ${ytPlaylistBody.error ?? "ok"})`,
  );
  assert(ytPlaylistBody.ok === true, "respuesta ok=true");
  assert((ytPlaylistBody.items?.length ?? 0) >= 1, `${ytPlaylistBody.count} vídeos listados`);
  // El título viene del og:title de la propia página de YouTube (best-effort).
  assert(
    Boolean(ytPlaylistBody.meta?.title),
    `meta con el título de la lista (${ytPlaylistBody.meta?.title?.slice(0, 40)})`,
  );
  // El canal se deduce del primer vídeo listado (YTMP3 no expone el autor de la lista).
  assert(
    Boolean(ytPlaylistBody.meta?.channel),
    `meta con el canal (${ytPlaylistBody.meta?.channel?.slice(0, 40)})`,
  );
  const ytPlFirst = ytPlaylistBody.items?.[0];
  assert(Boolean(ytPlFirst?.id && ytPlFirst?.title), `primer vídeo: ${ytPlFirst?.title?.slice(0, 30)}`);
  assert(
    Boolean(ytPlFirst?.postUrl?.startsWith("https://www.youtube.com/watch")),
    `postUrl apunta al watch URL (${ytPlFirst?.postUrl?.slice(0, 40)}…)`,
  );

  console.log("\n✓ Smoke test de la API superado.");
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).message}`);
  process.exitCode = 1;
});
