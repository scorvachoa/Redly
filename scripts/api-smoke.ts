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
import { GET as renderGET } from "../app/api/render/route";
import { POST as searchPOST } from "../app/api/search/route";
import { LoveInstaSource } from "../lib/loveinsta";

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
// Reel público verificado contra FSave (mint → resolve → render → fileUrl).
const FACEBOOK_VIDEO = "https://www.facebook.com/watch/?v=10153231379946729";
const FACEBOOK_PAGE = "https://www.facebook.com/NASA";
// Reel público verificado contra IGExport (ig-reels → CDN de Instagram) y
// contra LoveInsta (proxy.php → job de render → dl.iamworker.com).
const INSTAGRAM_POST = "https://www.instagram.com/reel/DeMbuYlBfMk/";
const INSTAGRAM_PROFILE = "https://www.instagram.com/NASA";
// Tweet público verificado contra iLoveX (proxy.php → job de render →
// dl.iamworker.com; el poll responde `Completed` al primer sondeo).
const X_TWEET = "https://x.com/SpaceX/status/2109957980011552839";
const X_PROFILE = "https://x.com/SpaceX";
// Publicación pública verificada contra SaveThreads (proxy.php → job de
// render → dl.iamworker.com; carrusel con fotos y vídeos en 720p).
const THREADS_POST = "https://www.threads.com/@mileycyrus/post/DWSFx_jErAQ";
const THREADS_PROFILE = "https://www.threads.com/@mileycyrus";

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

  // 7. Facebook: vídeo real (FSave) -----------------------------------------
  // Va antes que YouTube: así una incidencia aguas arriba de SnapYT no tapa
  // la verificación del resto de plataformas.
  console.log("\n[7] POST /api/search (vídeo de Facebook real)");
  const fbResponse = await searchPOST(jsonRequest("/api/search", { url: FACEBOOK_VIDEO }));
  const fbBody = (await fbResponse.json()) as {
    ok?: boolean;
    error?: string;
    result?: {
      title?: string;
      videoId?: string;
      downloads?: Array<{ quality?: string; kind?: string; format?: string; url: string }>;
    };
  };
  if (!fbBody.ok) console.log(`  ↳ ${fbBody.error ?? "(sin mensaje)"}`);
  assert(fbResponse.status === 200, `HTTP 200 (recibido ${fbResponse.status})`);
  assert(fbBody.ok === true, `respuesta ok=true (${fbBody.error ?? "sin error"})`);
  assert(Boolean(fbBody.result?.title), `título: ${fbBody.result?.title?.slice(0, 40)}`);

  const fbDownloads = fbBody.result?.downloads ?? [];
  assert(fbDownloads.length >= 1, `${fbDownloads.length} opciones de descarga`);
  // Las opciones de FSave son diferidas: toca resolver el render en servidor.
  const firstFb = fbDownloads[0];
  assert(
    Boolean(firstFb && firstFb.url.startsWith("/api/render?job=")),
    `la primera opción apunta a /api/render (${firstFb?.url.slice(0, 40)}…)`,
  );
  assert(
    fbDownloads.some((option) => option.kind === "audio"),
    "trae pista de audio (m4a)",
  );

  console.log("\n[8] Facebook: páginas sin listado");
  const fbPageSearch = await searchPOST(jsonRequest("/api/search", { url: FACEBOOK_PAGE }));
  assert(fbPageSearch.status === 400, "rechaza una página en /search (400)");
  const fbProfile = await profilePOST(jsonRequest("/api/profile", { url: FACEBOOK_PAGE }));
  assert(fbProfile.status === 501, "/api/profile de una página → 501 (sin listados)");

  console.log("\n[9] GET /api/render + /api/download (Facebook)");
  const renderResponse = await renderGET(new Request(`http://localhost${firstFb!.url}`));
  const renderBody = (await renderResponse.json()) as {
    ok?: boolean;
    error?: string;
    url?: string;
  };
  assert(
    renderResponse.status === 200,
    `render HTTP 200 (recibido ${renderResponse.status}: ${renderBody.error ?? "ok"})`,
  );
  assert(renderBody.ok === true && Boolean(renderBody.url), "render listo: URL temporal");
  assert(
    (renderBody.url ?? "").includes("iamworker.com"),
    "el archivo vive en el host permitido (iamworker.com)",
  );

  const fbDownloadResponse = await downloadGET(
    new Request(
      `http://localhost/api/download?url=${encodeURIComponent(renderBody.url ?? "")}&name=smoke-fb.mp4`,
    ),
  );
  assert(
    fbDownloadResponse.status === 200,
    `stream de Facebook HTTP 200 (recibido ${fbDownloadResponse.status})`,
  );
  const fbReader = fbDownloadResponse.body?.getReader();
  let fbReceived = 0;
  if (fbReader) {
    for (;;) {
      const { value, done } = await fbReader.read();
      if (done) break;
      fbReceived += value?.length ?? 0;
      if (fbReceived > 64 * 1024) break;
    }
    await fbReader.cancel();
  }
  assert(fbReceived > 0, `bytes del archivo de Facebook: ${fbReceived.toLocaleString()}`);

  // 10. Instagram: publicación real (IGExport) -------------------------------
  // Va antes que YouTube: así una incidencia aguas arriba de SnapYT no tapa
  // la verificación del resto de plataformas.
  console.log("\n[10] POST /api/search (reel de Instagram real)");
  const igResponse = await searchPOST(jsonRequest("/api/search", { url: INSTAGRAM_POST }));
  const igBody = (await igResponse.json()) as {
    ok?: boolean;
    error?: string;
    result?: {
      title?: string;
      videoId?: string;
      downloads?: Array<{ kind?: string; format?: string; url: string; hasAudio?: boolean }>;
    };
  };
  if (!igBody.ok) console.log(`  ↳ ${igBody.error ?? "(sin mensaje)"}`);
  assert(igResponse.status === 200, `HTTP 200 (recibido ${igResponse.status})`);
  assert(igBody.ok === true, `respuesta ok=true (${igBody.error ?? "sin error"})`);
  assert(Boolean(igBody.result?.title), `título: ${igBody.result?.title?.slice(0, 40)}`);
  assert(
    igBody.result?.videoId === "DeMbuYlBfMk",
    `videoId = código de la publicación (${igBody.result?.videoId})`,
  );

  const igDownloads = igBody.result?.downloads ?? [];
  assert(igDownloads.length >= 1, `${igDownloads.length} opciones de descarga`);
  const firstIg = igDownloads[0];
  // IGExport entrega el MP4 directo del CDN de Instagram (sin fase de render).
  assert(
    Boolean(firstIg && firstIg.url.startsWith("https://scontent-")),
    `opción directa en el CDN (${firstIg?.url.slice(0, 48)}…)`,
  );
  assert(firstIg?.kind === "video", "la opción es de vídeo");
  assert(firstIg?.hasAudio === true, "la opción declara audio");

  console.log("\n[11] Instagram: perfiles sin listado");
  const igProfileSearch = await searchPOST(jsonRequest("/api/search", { url: INSTAGRAM_PROFILE }));
  assert(igProfileSearch.status === 400, "rechaza un perfil en /search (400)");
  const igProfile = await profilePOST(jsonRequest("/api/profile", { url: INSTAGRAM_PROFILE }));
  assert(igProfile.status === 501, "/api/profile de un perfil → 501 (sin listados)");

  console.log("\n[12] GET /api/download (Instagram)");
  const igDownloadResponse = await downloadGET(
    new Request(
      `http://localhost/api/download?url=${encodeURIComponent(firstIg?.url ?? "")}&name=smoke-ig.mp4`,
    ),
  );
  assert(
    igDownloadResponse.status === 200,
    `stream de Instagram HTTP 200 (recibido ${igDownloadResponse.status})`,
  );
  const igDisposition = igDownloadResponse.headers.get("content-disposition") ?? "";
  assert(igDisposition.includes("attachment"), `Content-Disposition: ${igDisposition}`);
  const igReader = igDownloadResponse.body?.getReader();
  let igReceived = 0;
  if (igReader) {
    for (;;) {
      const { value, done } = await igReader.read();
      if (done) break;
      igReceived += value?.length ?? 0;
      if (igReceived > 64 * 1024) break;
    }
    await igReader.cancel();
  }
  assert(igReceived > 0, `bytes del archivo de Instagram: ${igReceived.toLocaleString()}`);

  // 13. Instagram: respaldo de LoveInsta (job → render → stream) ------------
  // IGExport es la fuente primaria [10]; aquí se ejercita el respaldo real:
  // búsqueda contra loveinsta.com (un sólo POST), resolución del job de render
  // por el `/api/render` existente y stream con bytes por `/api/download`.
  // La cadena en sí (primario → respaldo) está cubierta en tests unitarios.
  console.log("\n[13] Instagram vía LoveInsta (respaldo)");
  const liResult = await new LoveInstaSource().searchVideo(INSTAGRAM_POST);
  assert(
    liResult.videoId === "DeMbuYlBfMk",
    `videoId = código de la publicación (${liResult.videoId})`,
  );
  assert(Boolean(liResult.title), `título: ${liResult.title?.slice(0, 40)}`);

  const liDownloads = liResult.downloads ?? [];
  assert(liDownloads.length >= 1, `${liDownloads.length} opciones de descarga`);
  const firstLi = liDownloads[0];
  // Los vídeos de LoveInsta no son directos: llevan el job a `/api/render`.
  assert(
    Boolean(firstLi && firstLi.url.startsWith("/api/render?job=")),
    `opción con job de render (${firstLi?.url.slice(0, 48)}…)`,
  );
  assert(firstLi?.kind === "video", "la opción es de vídeo");
  assert(firstLi?.hasAudio === true, "la opción declara audio");
  assert(/^\d{3,4}p$/.test(firstLi?.quality ?? ""), `calidad del job (${firstLi?.quality})`);

  const liRenderResponse = await renderGET(new Request(`http://localhost${firstLi!.url}`));
  const liRenderBody = (await liRenderResponse.json()) as {
    ok?: boolean;
    error?: string;
    url?: string;
  };
  assert(
    liRenderResponse.status === 200,
    `render HTTP 200 (recibido ${liRenderResponse.status}: ${liRenderBody.error ?? "ok"})`,
  );
  assert(
    liRenderBody.ok === true && Boolean(liRenderBody.url?.startsWith("https://dl.iamworker.com/")),
    `job resuelto a dl.iamworker.com (${liRenderBody.url?.slice(0, 56)}…)`,
  );

  const liDownloadResponse = await downloadGET(
    new Request(
      `http://localhost/api/download?url=${encodeURIComponent(liRenderBody.url ?? "")}&name=smoke-li.mp4`,
    ),
  );
  assert(
    liDownloadResponse.status === 200,
    `stream de LoveInsta HTTP 200 (recibido ${liDownloadResponse.status})`,
  );
  const liReader = liDownloadResponse.body?.getReader();
  let liReceived = 0;
  if (liReader) {
    for (;;) {
      const { value, done } = await liReader.read();
      if (done) break;
      liReceived += value?.length ?? 0;
      if (liReceived > 64 * 1024) break;
    }
    await liReader.cancel();
  }
  assert(liReceived > 0, `bytes del archivo de LoveInsta: ${liReceived.toLocaleString()}`);

  // 14. X (Twitter): tweet real (iLoveX) ------------------------------------
  // El flujo completo: búsqueda → job de render por `/api/render?source=ilovex`
  // → stream con bytes por `/api/download`.
  console.log("\n[14] POST /api/search (tweet de X real)");
  const xResponse = await searchPOST(jsonRequest("/api/search", { url: X_TWEET }));
  const xBody = (await xResponse.json()) as {
    ok?: boolean;
    error?: string;
    result?: {
      title?: string;
      videoId?: string;
      downloads?: Array<{
        quality?: string;
        kind?: string;
        format?: string;
        url: string;
        hasAudio?: boolean;
      }>;
    };
  };
  if (!xBody.ok) console.log(`  ↳ ${xBody.error ?? "(sin mensaje)"}`);
  assert(xResponse.status === 200, `HTTP 200 (recibido ${xResponse.status})`);
  assert(xBody.ok === true, `respuesta ok=true (${xBody.error ?? "sin error"})`);
  assert(Boolean(xBody.result?.title), `título: ${xBody.result?.title?.slice(0, 40)}`);
  assert(xBody.result?.videoId === "2109957980011552839", `videoId = id del tweet (${xBody.result?.videoId})`);

  const xDownloads = xBody.result?.downloads ?? [];
  assert(xDownloads.length >= 1, `${xDownloads.length} opciones de descarga`);
  const firstX = xDownloads[0];
  // Las opciones de iLoveX son diferidas: resolución del job al pulsar.
  assert(
    Boolean(firstX && firstX.url.startsWith("/api/render?job=") && firstX.url.includes("source=ilovex")),
    `la primera opción apunta a /api/render con source=ilovex (${firstX?.url.slice(0, 56)}…)`,
  );
  assert(/^\d{3,4}p$/.test(firstX?.quality ?? ""), `calidad del tweet (${firstX?.quality})`);
  assert(firstX?.hasAudio === true, "la opción declara audio");

  console.log("\n[15] X (Twitter): perfiles sin listado");
  const xProfileSearch = await searchPOST(jsonRequest("/api/search", { url: X_PROFILE }));
  assert(xProfileSearch.status === 400, "rechaza un perfil en /search (400)");
  const xProfile = await profilePOST(jsonRequest("/api/profile", { url: X_PROFILE }));
  assert(xProfile.status === 501, "/api/profile de un perfil → 501 (sin listados)");

  console.log("\n[16] GET /api/render + /api/download (X)");
  const xRenderResponse = await renderGET(new Request(`http://localhost${firstX!.url}`));
  const xRenderBody = (await xRenderResponse.json()) as {
    ok?: boolean;
    error?: string;
    url?: string;
  };
  assert(
    xRenderResponse.status === 200,
    `render HTTP 200 (recibido ${xRenderResponse.status}: ${xRenderBody.error ?? "ok"})`,
  );
  assert(
    xRenderBody.ok === true && Boolean(xRenderBody.url?.startsWith("https://dl.iamworker.com/")),
    `job resuelto a dl.iamworker.com (${xRenderBody.url?.slice(0, 56)}…)`,
  );

  const xDownloadResponse = await downloadGET(
    new Request(
      `http://localhost/api/download?url=${encodeURIComponent(xRenderBody.url ?? "")}&name=smoke-x.mp4`,
    ),
  );
  assert(
    xDownloadResponse.status === 200,
    `stream de X HTTP 200 (recibido ${xDownloadResponse.status})`,
  );
  const xReader = xDownloadResponse.body?.getReader();
  let xReceived = 0;
  if (xReader) {
    for (;;) {
      const { value, done } = await xReader.read();
      if (done) break;
      xReceived += value?.length ?? 0;
      if (xReceived > 64 * 1024) break;
    }
    await xReader.cancel();
  }
  assert(xReceived > 0, `bytes del archivo de X: ${xReceived.toLocaleString()}`);

  // 17. YouTube: vídeo suelto ------------------------------------------------
  console.log("\n[17] POST /api/search (vídeo de YouTube real)");
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

  // 18. YouTube: validaciones de canales y búsquedas --------------------------
  console.log("\n[18] YouTube: validaciones de canales y búsquedas");
  const ytChannel = await searchPOST(jsonRequest("/api/search", { url: YOUTUBE_CHANNEL }));
  assert(ytChannel.status === 400, "rechaza un canal en /search (400)");

  // Los canales se clasifican como perfil, pero la fuente los rechaza (502):
  // el listado de canales de YouTube no se ofrece todavía.
  const ytChannelProfile = await profilePOST(jsonRequest("/api/profile", { url: YOUTUBE_CHANNEL }));
  assert(ytChannelProfile.status === 502, "/api/profile de un canal → 502 (rechazado)");

  const ytPlaylistSearch = await searchPOST(jsonRequest("/api/search", { url: YOUTUBE_PLAYLIST_BAD }));
  assert(ytPlaylistSearch.status === 400, "rechaza una lista de reproducción en /search (400)");

  // 19. YouTube: lista de reproducción real (vía YTMP3.gg) ----------------
  console.log("\n[19] POST /api/profile (lista de YouTube real)");
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

  // 20. Threads: publicación real (SaveThreads) ------------------------------
  // El flujo completo: búsqueda → job de render por `/api/render?source=savethreads`
  // → stream con bytes por `/api/download`.
  console.log("\n[20] POST /api/search (publicación de Threads real)");
  const thResponse = await searchPOST(jsonRequest("/api/search", { url: THREADS_POST }));
  const thBody = (await thResponse.json()) as {
    ok?: boolean;
    error?: string;
    result?: {
      title?: string;
      videoId?: string;
      downloads?: Array<{
        quality?: string;
        kind?: string;
        format?: string;
        url: string;
        hasAudio?: boolean;
      }>;
    };
  };
  if (!thBody.ok) console.log(`  ↳ ${thBody.error ?? "(sin mensaje)"}`);
  assert(thResponse.status === 200, `HTTP 200 (recibido ${thResponse.status})`);
  assert(thBody.ok === true, `respuesta ok=true (${thBody.error ?? "sin error"})`);
  assert(Boolean(thBody.result?.title), `título: ${thBody.result?.title?.slice(0, 40)}`);
  assert(
    thBody.result?.videoId === "DWSFx_jErAQ",
    `videoId = código del post (${thBody.result?.videoId})`,
  );

  const thDownloads = thBody.result?.downloads ?? [];
  assert(thDownloads.length >= 1, `${thDownloads.length} opciones de descarga`);
  const thVideos = thDownloads.filter((option) => option.kind === "video");
  const thImages = thDownloads.filter((option) => option.kind === "image");
  assert(thVideos.length >= 1, `${thVideos.length} vídeos (carrusel)`);
  assert(thImages.length >= 1, `${thImages.length} fotos (carrusel)`);
  const firstTh = thVideos[0];
  // Las opciones de vídeo de SaveThreads son diferidas: resolución del job al pulsar.
  assert(
    Boolean(
      firstTh && firstTh.url.startsWith("/api/render?job=") && firstTh.url.includes("source=savethreads"),
    ),
    `la primera opción de vídeo apunta a /api/render con source=savethreads (${firstTh?.url.slice(0, 56)}…)`,
  );
  assert(/^\d{2,5}p$/.test(firstTh?.quality ?? ""), `calidad del vídeo (${firstTh?.quality})`);
  assert(firstTh?.hasAudio === true, "la opción declara audio");
  // Las fotos sí son directas (host permitido: dl.iamworker.com).
  assert(
    Boolean(thImages[0]?.url.startsWith("https://dl.iamworker.com/")),
    `la primera foto es directa en dl.iamworker.com (${thImages[0]?.url.slice(0, 48)}…)`,
  );

  console.log("\n[21] Threads: perfiles sin listado");
  const thProfileSearch = await searchPOST(jsonRequest("/api/search", { url: THREADS_PROFILE }));
  assert(thProfileSearch.status === 400, "rechaza un perfil en /search (400)");
  const thProfile = await profilePOST(jsonRequest("/api/profile", { url: THREADS_PROFILE }));
  assert(thProfile.status === 501, "/api/profile de un perfil → 501 (sin listados)");

  console.log("\n[22] GET /api/render + /api/download (Threads)");
  const thRenderResponse = await renderGET(new Request(`http://localhost${firstTh!.url}`));
  const thRenderBody = (await thRenderResponse.json()) as {
    ok?: boolean;
    error?: string;
    url?: string;
  };
  assert(
    thRenderResponse.status === 200,
    `render HTTP 200 (recibido ${thRenderResponse.status}: ${thRenderBody.error ?? "ok"})`,
  );
  assert(
    thRenderBody.ok === true && Boolean(thRenderBody.url?.startsWith("https://dl.iamworker.com/")),
    `job resuelto a dl.iamworker.com (${thRenderBody.url?.slice(0, 56)}…)`,
  );

  const thDownloadResponse = await downloadGET(
    new Request(
      `http://localhost/api/download?url=${encodeURIComponent(thRenderBody.url ?? "")}&name=smoke-threads.mp4`,
    ),
  );
  assert(
    thDownloadResponse.status === 200,
    `stream de Threads HTTP 200 (recibido ${thDownloadResponse.status})`,
  );
  const thReader = thDownloadResponse.body?.getReader();
  let thReceived = 0;
  if (thReader) {
    for (;;) {
      const { value, done } = await thReader.read();
      if (done) break;
      thReceived += value?.length ?? 0;
      if (thReceived > 64 * 1024) break;
    }
    await thReader.cancel();
  }
  assert(thReceived > 0, `bytes del archivo de Threads: ${thReceived.toLocaleString()}`);

  console.log("\n✓ Smoke test de la API superado.");
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).message}`);
  process.exitCode = 1;
});
