# Plan: integración de YouTube en Red.ly

## 0. Contexto (resultado del análisis)

- El proyecto es **Next.js 15 + TypeScript** (App Router, Vercel, serverless), no Python. Sin BD, sin claves, sin OAuth: sólo URLs públicas.
- Arquitectura por **registro**: contrato `ContentSource` en `lib/sources.ts:27-41` + registro en `lib/sources.ts:54`; registro de plataformas en `lib/platforms.ts:37` (YouTube ya existe con `ready: false` en la línea 49).
- Hoy sólo TikTok funciona, vía scraping a SavTikPro (primaria) y TikVid (fallback).
- **Decisión tomada por el usuario**: fuente = **`https://app.ytdown.to/es30/`** (mismo patrón "tercero intermedio" que TikTok); **alcance fase 1 = vídeo suelto** (Shorts y `youtu.be` incluidos).

### Hallazgo crítico del spike previo (verificado ya)

El endpoint real de YTDown es:

```
POST https://app.ytdown.to/proxy.php
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
Referer: https://app.ytdown.to/es30/          (rutas de locale: /es30/, /en26/, /id29/…)
body: url=<URL de YouTube>
respuesta: JSON (o string JSON) con { api: { id, title, imagePreviewUrl, userInfo, mediaStats, mediaItems[] } }
mediaItems[]: { type: "Video"|"Audio", mediaQuality, mediaRes, mediaFileSize, mediaDuration,
                mediaExtension, mediaThumbnail, mediaPreviewUrl, mediaUrl, mediaTask }
```
(Fuente: gist público `RIFKIror/da9132a4b4b239e54d24c3e75a049ed0`.)

**Riesgo mayor**: `app.ytdown.to` está detrás de un **managed challenge de Cloudflare**. Probado desde esta máquina con `curl` (UA completo + headers de navegador + `sec-ch-ua`/`sec-fetch-*`) y con **Node 24 `fetch` (undici)** → **403 "Just a moment..."** en `/`, `/es30/` y `/proxy.php`. `ytdown.to` sólo hace 301 a `app.ytdown.to`. **Todavía no se ha confirmado que un cliente de servidor (Vercel) pueda llamar a la API.** Esto decide todo lo demás.

---

## Fase 0 — Spike empírico (GO / NO-GO) 🔴 bloqueante

Objetivo: responder 7 preguntas antes de escribir código de producción.

1. **¿Proxy responde a un cliente de servidor?**
   - 0a. Capturar una respuesta **real** desde el navegador del usuario (DevTools → Network → `proxy.php` → copiar respuesta) para tener el JSON exacto.
   - 0b. Reintentar desde Node con `fetch` (ya falla desde esta IP) y, clave, **desde un entorno Vercel** (rama de prueba + `npm run smoke` ampliado): la IP/reputación puede cambiar el resultado.
   - 0c. Si el challenge aparece siempre: probar variantes baratas (HTTP/2 con un cliente que lo soporte, warm-up GET previo con cookies, ruta de locale exacta como Referer).
2. **Forma real del JSON**: ¿`api` viene como objeto o string? ¿Cuál es la URL de descarga válida: `mediaPreviewUrl`, `mediaUrl` ( etiquetado "worker" en el gist) o ambas? ¿Devuelve varias calidades en `mediaItems` o una sola?
3. **Hosts de las URLs de descarga resultantes** (googlevideo, CDN propio de YTDown…) → son los que hay que meter en `ALLOWED_DOWNLOAD_HOSTS` (`lib/config.ts:186`).
4. **Caducidad** de esas URLs (~6 h si son googlevideo) → importa para el proxy y el caché.
5. **Formas de URL aceptadas**: `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `m.youtube.com`, ¿listas `list=`?
6. **MP3**: `mediaTask: "render"` ⇒ ¿viene ya renderizado o hay que re-petición/polling?
7. **¿Requiere cookies `cf_clearance`?** Si sí → NO-GO serverless con este origen.

**Criterio GO**: al menos un camino reproducible desde Node sin navegador que devuelva JSON con URLs de descarga descargables vía `/api/download`.

**Planes alternativos si NO-GO** (decidir en el momento, en este orden):
1. Descubrir endpoint alternativo sin challenge inspeccionando el JS del front de YTDown (desde el navegador del usuario, que sí pasa el challenge).
2. Otro servicio intermedio tipo cobalt (mismo patrón, sin claves).
3. Scraping directo Innertube (`ytInitialPlayerResponse` → `streamingData`), sin terceros.

**Entregable de fase 0**: `tests/fixtures/ytdown_search.json` (respuesta real anonimizada) + notas en el README con las reglas empíricas.

---

## Fase 1 — Implementación (vídeo suelto)

### 1. Configuración — `lib/config.ts`
- Nuevas exportaciones con `envStr`, siguiendo el patrón existente:
  - `YTDOWN_BASE_URL` (def. `https://app.ytdown.to`), `YTDOWN_PROXY_URL` (def. `${base}/proxy.php`), `YTDOWN_REFERER_PATH` (def. `/es30/`), `YTDOWN_LANG` si hace falta.
  - `YTDOWN_HEADERS` (mismo estilo que `SAVETIK_HEADERS`, línea 85).
- Ampliar `ALLOWED_DOWNLOAD_HOSTS` (línea 186) con los hosts verificados en la fase 0 (p. ej. `googlevideo.com` + los del CDN de YTDown).

### 2. URLs de YouTube — nuevo `lib/youtube-urls.ts`
Módulo **apt navegador** (sin `node:*`), paralelo a `lib/urls.ts`:
- `isYouTubeUrl`, `isYouTubeVideoUrl` (`watch`, `youtu.be/<id>`, `/shorts/`, `/embed/`, `/live/`, `m.`), `isYouTubeProfileUrl` (`/@handle`, `/channel/UC…`, `/c/`, `/user/`), `isYouTubePlaylistUrl`, `extractYouTubeVideoId`, `normalizeYouTubeUrl`, `inputToYouTubeUrl` (fase 1: sólo trim; `@handle` se trata como perfil).

### 3. Generalizar la validación de las rutas (punto de dolor principal)
Hoy `app/api/search/route.ts:43-60` y `app/api/profile/route.ts:55-62` validan con funciones **hardcodeadas a TikTok** *antes* de consultar el registro. Cambio mínimo y afín a la filosofía del proyecto — **nuevo `lib/urlrules.ts`** (apt navegador):

```ts
interface UrlRules {
  slug: string;
  matches(url: string): boolean;      // ¿la URL es de esta plataforma?
  isVideo(url: string): boolean;
  isProfile(url: string): boolean;
  normalize(input: string): string;   // entrada del usuario → URL
}
```
- Registro con reglas TikTok (envolviendo `lib/urls.ts`) y reglas YouTube (envolviendo `lib/youtube-urls.ts`).
- `rulesForUrl(input)` → `{ slug, rules }` o `null`.
- Flujo nuevo de `POST /api/search`:
  1. rate limit (igual),
  2. `rulesForUrl(input)` → si `null` ⇒ 400 "URL no reconocida",
  3. `url = rules.normalize(input)`; si `rules.isProfile(url)` ⇒ 400 con mensaje específico (si la fuente no soporta perfiles: "Los canales de YouTube aún no están disponibles"),
  4. `source = sourceForPlatform(slug)` ⇒ 501 si `null`,
  5. **`result = await source.searchVideo(url)`** (hoy llama a `searchAny` a pelo, línea 71).
- `POST /api/profile`: mismas reglas; si `!source.supportsProfiles` ⇒ 501 con mensaje claro.
- Contrato `ContentSource`: añadir **`readonly supportsProfiles?: boolean`** (por defecto `true`; YTDown lo pone a `false` en fase 1). `listProfilePage` de YTDown lanza `RequestError` (nunca debe llegar a llamarse).

### 4. Fachada TikTok — `lib/savetik.ts`
- Para que la ruta pueda decir `source.searchVideo(url)` sin perder el fallback SavTik→TikVid, envolver la fachada actual en una clase `TikTokSource implements ContentSource` (`id: "tiktok"`, `platforms: ["tiktok"]`, `searchVideo` = `searchAny` actual, `listProfilePage` = la de `SavetikSource`). Cambio quirúrgico, sin tocar la lógica interna de reintentos.

### 5. Fuente YouTube — nuevo `lib/ytdown.ts`
`class YtDownSource implements ContentSource` (`id: "ytdown"`, `platforms: ["youtube"]`, `supportsProfiles: false`), calco del patrón de `SavetikSource` (`lib/savetik.ts:74-235`):
- `searchVideo(url)`:
  1. `warmUp()` opcional (GET de la home de locale, como `savetik.ts:225`),
  2. `POST YTDOWN_PROXY_URL` con `URLSearchParams { url }` + `YTDOWN_HEADERS` y `fetchWithTimeout` (`lib/http.ts`),
  3. reintentos idénticos a los actuales: `RETRY_ATTEMPTS`, backoff `RETRY_BACKOFF_SECONDS`, `TRANSIENT_HTTP_STATUSES` → reintenta; `404`/contenido no disponible → `UnavailableError`; cuerpo no-JSON → `RequestError`,
  4. parse tolerante (objeto o string JSON) → mapeo al modelo canónico `TikTokResult`:
     - `videoId = api.id`, `title = api.title`, `thumbnail = api.imagePreviewUrl`,
     - `downloads`: `mediaItems` con `type === "Video"` → `{ name, url, format: "mp4", quality: <mediaRes>, kind: "video" }`; `type === "Audio"`/MP3 → `{ format: "mp3", kind: "audio" }` (sólo si fase 0 confirma que llega listo).
- Ordenar opciones de mayor a menor calidad (por altura p. ej. `1080p`) y marcar la mejor como candidata a "máxima calidad".

### 6. Calidad máxima — `lib/models.ts`
- `bestQualityOption` (línea 62) hoy sólo busca `quality === "hd"`. Extenderlo con ranking fallback: si ninguna opción es `hd`, elegir la de mayor resolución (`(\d{3,4})p`) manteniendo el comportamiento TikTok intacto (test en `tests/models.test.ts`).

### 7. Registro — `lib/sources.ts` y `lib/platforms.ts`
- `SOURCES: [new TikTokSource(), new YtDownSource()]` (`sources.ts:54`).
- `lib/platforms.ts:53`: `youtube.ready = true` **sólo al final**, cuando todo esté verificado (esto alone activa `/download/youtube` con la UI real vía `app/download/[platform]/page.tsx:38` y la tarjeta de la portada).

### 8. Proxy de descarga — `app/api/download/route.ts`
- Sin cambios de código salvo lo que exija la fase 0: allowlist (punto 1) y, si las URLs lo piden, `Referer`/`Origin` en `DOWNLOAD_HEADERS` (`lib/config.ts:95`) —decidir con datos.
- `inferFilename` fallback `Redly.mp4` ya existe (línea 95); el nombre real lo manda el cliente.

### 9. UI — `components/Downloader.tsx` (+ copy)
- `DEFAULT_STATUS` (línea 51) y mensajes (líneas 261, 286) → genéricos usando la prop `platform` ya disponible (`Pega una URL de {platform.name}…`).
- `inputToTikTokUrl` (línea 259) → `rules.normalize` del registro `urlrules`.
- `isProfileLike` (línea 271, de `lib/download-stream.ts:34`): interceptar **antes** si la URL es un canal/playlist de YouTube → status "Los canales de YouTube llegarán en una fase posterior" (evita el 400 confuso de `/api/profile`).
- `optionFilename` (línea 81): el id sólo se usa si es numérico → YouTube usa ids alfanuméricos (`dQw4w9WgXcQ`) y acabaría todo en `Redly_video.mp4`. Ampliar la validación a `[A-Za-z0-9_-]{6,}`.
- `fetchBestQualityUrl`/`bestQualityOption` (línea 102) funcionan sin cambios si el postUrl de YouTube se resuelve igual.
- Copy de `ComingSoon.tsx` (líneas 69-82): ya no aplica a YouTube; sólo se actualiza si queda texto que afirme "sólo TikTok" (`app/page.tsx:106`, `app/layout.tsx:10` → "TikTok y YouTube disponibles").

### 10. Tests (Vitest, sin red)
- Nuevo `tests/youtube-urls.test.ts`: clasificación de `watch`, `youtu.be`, `shorts`, `embed`, `live`, `m.`, perfiles/playlists como no-vídeo, entradas inválidas.
- Nuevo `tests/ytdown.test.ts` (calco de `tests/savetik.test.ts`): mapeo del fixture real → `TikTokResult`, orden de calidades, reintentos ante 429/5xx, 404 → `UnavailableError`, cuerpo corrupto → `RequestError`, `supportsProfiles === false`.
- Fixture: `tests/fixtures/ytdown_search.json` (capturado en fase 0, anonimizado).
- Nuevos `tests/urlrules.test.ts`: detección por plataforma, TikTok no regresa, YouTube sin fuente → 501.
- Actualizar: `tests/platforms.test.ts:41` (afirma "sólo TikTok ready" → pasar a TikTok+YouTube), `tests/sources.test.ts` (registro y `detectPlatformSlug` de youtube), `tests/models.test.ts` (ranking de resolución).

### 11. Smoke con red — `scripts/api-smoke.ts`
- Añadir casos YouTube: vídeo real → 200 con opciones; canal → error esperado; URL YouTube fuera de allowlist en `/api/download` → 400.

### 12. Documentación
- `README.md`: sección YouTube (endpoint, payload, reglas empíricas, limitaciones: sin canales aún, caducidad de URLs, Cloudflare).
- `.env.example`: nuevas variables `YTDOWN_*`.
- `app/layout.tsx` / portada / `privacidad` / `creditos`: ajustar el copy "sólo TikTok" donde corresponda (líneas listadas en el punto 9).

---

## Orden de ejecución y verificación

1. Fase 0 (spike) → fixture + decisión GO/NO-GO.
2. `lib/youtube-urls.ts` + tests.
3. `lib/ytdown.ts` + fixture + tests.
4. `lib/urlrules.ts` + refactor de rutas + `TikTokSource` + tests.
5. `lib/models.ts` (ranking) + `optionFilename` + UI/copy.
6. `platforms.ready = true`, allowlist, docs.
7. Verificación en cada bloque: `npm run lint`, `npm run typecheck`, `npm test`; al final `npm run build` y `npm run smoke` (con red).

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Cloudflare bloquea a clientes de servidor | Todo la fase 1 | Fase 0 antes de código; planes alternativos definidos |
| Cambios de plantilla/JSON de YTDown | Fuente rota | Selectores/campos con fallback (patrón `SELECTORS` de `config.ts:104`) + fixtures |
| URLs de descarga de caducidad corta | Enlaces muertos | El análisis y la descarga son inmediatos; sin caché en fase 1 |
| MP3 asíncrono (`mediaTask: render`) | Audio no disponible | Confirmar en fase 0; si asíncrono, omitir MP3 en fase 1 |
| `ready: true` sin verificación completa | UX rota | Activar la flag en el último paso, tras smoke |
