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

  console.log("\n✓ Smoke test de la API superado.");
}

main().catch((error) => {
  console.error(`\n✗ ${(error as Error).message}`);
  process.exitCode = 1;
});
