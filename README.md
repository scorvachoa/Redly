# Red.ly

Cliente TypeScript/Next.js de los servicios **TikVid/SavTikPro** (TikTok),
**SnapYT/YTMP3** (YouTube), **FSave** (Facebook), **IGExport/LoveInsta**
(Instagram), **iLoveX** (X) y **SaveThreads** (Threads): analiza una URL,
muestra las opciones de descarga, o lista un **perfil completo** de TikTok y
descarga en lote con historial y reanudación.

Aplicación web: interfaz en el navegador + API propia que hace de proxy.

**Web desplegada:** <https://red-ly.vercel.app/>

> **No es una API oficial** de ninguno de esos servicios. Trabaja sólo con
> URLs públicas y peticiones HTTP normales, sin autenticación, sin cookies
> personales y sin medidas de evasión: no se saltan CAPTCHAs ni controles de
> acceso.

---

## Requisitos e instalación

* Node.js 20+ (probado en Node 24.11.1 / npm 11.14.1)
* Internet sólo para el uso real (los tests no la necesitan)

```bash
npm install
npm run dev        # Next.js en http://localhost:3000
```

## Compilar / verificar

```bash
npm run build      # build de producción (Next 15)
npm run typecheck  # tsc --noEmit
npm test           # vitest (sin red)
npm run smoke      # handlers de la API contra la red real
```

---

## Interfaz

| Ruta | Contenido |
| --- | --- |
| `/` | Portada: buscador general (detecta la red), plataformas, «Obtener programa» |
| `/download/<plataforma>` | Descargador: `tiktok`, `youtube`, `facebook`, `instagram`, `twitter`, `threads`; el resto, «Próximamente». Acepta `?url=<enlace>`: rellena el campo y analiza solo |
| `/transcript/<plataforma>` | Transcripción (todas «Próximamente») |
| `/privacidad` · `/creditos` | Política de datos · créditos y licencias |

El registro de plataformas vive en `lib/platforms.ts`; una ruta desconocida
cae en el 404 propio. Sólo se implementan las plataformas con fuente
comprobada: no se inventan APIs.

**Buscador general** (`components/HomeSearch.tsx`): un único campo para todas
las redes; mientras se escribe, `lib/urlrules.ts` clasifica la entrada y un
chip indica la red y el tipo detectado (vídeo, perfil, lista). Al enviar se
navega a `/download/<slug>?url=<normalizada>`; `Downloader` recoge el
parámetro, rellena su campo y lanza el análisis. Si la entrada no sirve, el
motivo se cuenta en la propia portada.

**Estilo y PWA:** Tailwind CSS v4 (`@apply` sobre clases semánticas en
`app/globals.css`); tema claro/oscuro con `data-theme` en `<html>`. Web
instalable: manifiesto + service worker que cachea **sólo** `/_next/static/`;
botón de instalación en `components/InstallApp.tsx`. El favicon —llama con el
degradado de la marca— está en `app/icon.svg`; los derivados se regeneran con
`node scripts/make-favicon.cjs`.

**Descargas e historial:** cada perfil se guarda en su subcarpeta
(`@scout2015` → `scout2015/`). Con «Elegir carpeta» (`showDirectoryPicker`,
Chromium) se escribe en streaming; el resto va a Descargas del navegador. El
historial (`localStorage`, sólo estado y nombres — nunca URLs ni tokens —)
marca lo ya descargado, lo excluye del lote y permite reanudar.

---

## API

Cinco rutas bajo `/api`, implementadas como Route Handlers de Next.js:

| Ruta | Método | Descripción |
| --- | --- | --- |
| `/api/search` | `POST { url }` | analiza **un vídeo**: título, ID, miniatura y opciones |
| `/api/profile` | `POST { url, max?, cursor?, page? }` | **una página** de perfil + `next_cursor` |
| `/api/merge` | `GET ?yt=&v=&a=` | combina vídeo+audio de YouTube en SnapYT |
| `/api/render` | `GET ?job=&source=` | resuelve un trabajo de render (FSave/LoveInsta/iLoveX/SaveThreads) |
| `/api/download` | `GET ?url=&name=` | proxy de streaming con `Content-Disposition: attachment` |

* `/api/profile` devuelve **una página** por invocación (`max` por defecto
  100, `next_cursor: null` = fin) y acepta el perfil abreviado `@usuario`.
* `/api/download` sólo acepta hosts de `ALLOWED_DOWNLOAD_HOSTS`
  (`lib/config.ts`): no sirve como proxy abierto.
* Límite de tasa compartido (`lib/ratelimit.ts`): **30 req / 60 s** por
  cliente (por instancia en serverless), con `429` y `Retry-After`.
* Caché de páginas de perfil: 60 s, techo 200 entradas, LRU (`lib/cache.ts`).
* El navegador habla **sólo** con la API de Red.ly (sin CORS hacia terceros).
  `vercel.json` fija `maxDuration: 60`; `/api/merge` sube a 120.

```bash
curl -X POST localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@usuario/video/123"}'
```

### Fuentes de contenido

La clasificación sale de `lib/urlrules.ts`; la fuente se resuelve por slug en
`lib/sources.ts` (contrato `ContentSource` + registro):

| Fuente | `id` | Plataforma | Notas |
| --- | --- | --- | --- |
| `TikTokSource` | `tiktok` | TikTok | fallback SavTikPro → TikVid; perfiles con paginación |
| `SnapYTSource` | `snapyt` | YouTube | única fuente; vídeo suelto + listas (vía YTMP3.gg) |
| `FsaveSource` | `fsave` | Facebook | única fuente; vídeo suelto (mint → resolve → render) |
| `InstagramSource` | `instagram` | Instagram | fallback IGExport → LoveInsta; publicación suelta |
| `IlovexSource` | `ilovex` | X (Twitter) | única fuente; tweet suelto (resolve → render) |
| `SavethreadsSource` | `savethreads` | Threads | única fuente; publicación suelta (resolve → render) |

Añadir una plataforma = implementar el contrato y registrarla, sin tocar las
rutas: sin reglas → `400`; con reglas pero sin fuente → `501`.

En YouTube, las calidades altas se descargan **con audio** combinando las
pistas en el servidor de SnapYT (`/api/merge`); las listas de reproducción se
enumeran vía la API de metadatos de YTMP3.gg (hasta 100 vídeos por página) y
el lote permite elegir entre la opción **recomendada**, **máxima calidad**
(con combinación) o **solo audio**.

---

## Arquitectura

```text
Redly/
├── app/
│   ├── page.tsx                # portada (servidor)
│   ├── download/[platform]/    # UI del descargador; resto: "Próximamente"
│   ├── transcript/[platform]/  # todas "Próximamente"
│   └── api/                    # search, profile, merge, render, download
├── public/                     # sw.js + iconos PWA
├── components/
│   ├── SiteHeader.tsx · SiteFooter.tsx · ThemeToggle.tsx · InstallApp.tsx
│   ├── HomeSearch.tsx          # buscador general de la portada
│   ├── Downloader.tsx          # orquestador del descargador
│   ├── downloader/             # piezas presentacionales
│   └── icons.tsx               # SVG incrustados (FA6), sin react-icons
├── lib/                        # núcleo portable (sin next/*, apt navegador)
│   ├── platforms.ts · sources.ts · urlrules.ts · config.ts · models.ts
│   ├── http.ts · parser.ts · client.ts · savetik.ts · snapyt.ts · ytmp3.ts
│   ├── fsave.ts · igexport.ts · loveinsta.ts · ilovex.ts · savethreads.ts
│   ├── *-urls.ts · ratelimit.ts · cache.ts · history.ts · sanitize.ts
│   ├── download-stream.ts · fsaccess.ts · downloader.ts · site.ts
├── scripts/                    # api-smoke, extract-icons, make-favicon
├── tests/                      # vitest, sin red (+ fixtures HTML/JSON)
├── vercel.json · vitest.config.ts · .env.example
└── postcss.config.mjs
```

Separación de responsabilidades: `lib/http.ts` no parsea HTML, `lib/parser.ts`
no hace peticiones y los Route Handlers son delgados (sólo orquestan `lib/`).
`lib/` no importa `next/` (los tests lo usan tal cual); `sanitize`, `urls`,
`models`, `history` y `fsaccess` tampoco importan `node:*`, así que el
navegador los usa directamente (destino de descargas e historial web).

---

## Tests

`npm test`: **388 tests en 25 ficheros, sin Internet** (fetch mockeado y
fixtures HTML anonimizadas en `tests/fixtures/`): clasificación de URLs por
plataforma, contrato `ContentSource`, cada fuente (mint HMAC, render, errores
del servicio, reintentos), merge de YouTube, paginación de perfiles, límite de
tasa, caché, historial y utilidades.

`npm run smoke` (opcional, **sí** necesita Internet) invoca los handlers
reales: paginación de un perfil, el flujo de combinación de YouTube, el
listado de una lista de reproducción, y el flujo completo de cada plataforma
hasta los bytes del MP4.

---

## Configuración

Todo lo configurable vive en `lib/config.ts` (se lee de `.env`; copia
`.env.example` a `.env.local`):

```text
SAVETIK_* TIKVID_* SNAPYT_* YT_YTMP3_* FSAVE_* IGEXPORT_*
INSTAGRAM_OEMBED_URL LOVEINSTA_* ILOVEX_* SAVETHREADS_*
REQUEST_TIMEOUT / DOWNLOAD_TIMEOUT / MAX_REDIRECTS
RETRY_ATTEMPTS / RETRY_BACKOFF_SECONDS
API_PROFILE_MAX · RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS
PROFILE_CACHE_TTL_MS
```

`ALLOWED_DOWNLOAD_HOSTS` **no** es variable de entorno: es la lista fija de
CDNs, dentro de `lib/config.ts`.

---

## Despliegue en Vercel

1. Importa el repositorio (framework detectado: Next.js).
2. Sin secretos ni claves: el proyecto trabaja con URLs públicas.
3. No hay FS persistente entre invocaciones: el historial vive en el
   navegador y el lote pagina `/api/profile` invocación a invocación.

---

## Limitaciones

* TikVid, SavTikPro, SnapYT, FSave, IGExport, LoveInsta, iLoveX y
  SaveThreads **no tienen APIs públicas documentadas**: endpoints, HTML,
  claves embebidas y CDNs pueden cambiar sin aviso. Una respuesta HTML en
  lugar de JSON se reporta como error claro.
* Las URLs temporales expiran (`403/404/410`): si el token caducó, hay que
  volver a analizar.
* **TikTok**: vídeo suelto, fotos y perfiles con paginación. El listado de
  perfil no incluye publicaciones de fotos (hay que pegar su URL) y el
  scraping directo de `tiktok.com` no está implementado (WAF).
* **YouTube**: vídeo suelto y listas de reproducción (vía YTMP3.gg); sin
  canales ni transcripción. Las calidades altas dependen de la cola de
  combinación de SnapYT (90 s de tope).
* **Facebook, Instagram, X y Threads**: sólo publicaciones sueltas; sin
  listados de perfiles (`/api/profile` → `501`), sin transcripción y, en
  general, una sola calidad por vídeo. Los tokens de descarga caducan pronto:
  se resuelven al pulsar, sin cachear.
* `/transcript/*` existe en la navegación pero está «Próximamente»: no hay
  ninguna fuente comprobada de transcripciones.
* No hay base de datos, usuarios ni cuentas. Elegir la carpeta de destino
  sólo funciona en Chromium (Chrome/Edge/Opera) y no se persiste entre
  recargas.
* Si un análisis de perfil es muy largo, los enlaces de `/api/profile` pueden
  caducar (~1 h): hay que volver a analizar.

---

## Licencia / uso responsable

Proyecto de estudio técnico. Trabaja sólo con URLs públicas, respeta los
términos de las plataformas involucradas y no intenta evadir CAPTCHAs ni
controles de acceso.
