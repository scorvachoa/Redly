/**
 * Service worker de Red.ly.
 *
 * Su único trabajo es habilitar la instalación como PWA y cachear los assets
 * **inmutables** de Next. Es deliberadamente conservador:
 *
 *   - Se cachea SÓLO `/​_next/static/…`, que lleva hash en el nombre y por
 *     tanto nunca cambia de contenido.
 *   - Todo lo demás (HTML, `/api/*`, miniaturas de terceros) va directo a la
 *     red, sin cachear. Así es imposible servir una página caducada o, peor,
 *     un token de descarga vencido.
 *
 * Si algún día se quiere cachear el HTML, hacerlo con estrategia
 * *network-first* y una versión de caché versionada explícitamente.
 */

const CACHE = "redly-static-v1";

self.addEventListener("install", () => {
  // Se toma el control sin esperar a cerrar las pestañas abiertas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Sólo peticiones de lectura del propio origen.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Fuera de la navegación principal: nada que hacer.
  if (request.mode === "navigate") return;

  // Único caso cacheado: assets con hash, inmutables.
  if (!url.pathname.startsWith("/_next/static/")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;

      const response = await fetch(request);
      // Sólo se guarda una respuesta válida; un 4xx/5xx no debe quedarse.
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
