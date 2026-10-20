# Red.ly

Cliente TypeScript/Next.js del flujo HTTP de **TikVid** y **SavTikPro** para
URLs de TikTok, de **SnapYT** para URLs de YouTube, de **FSave** para URLs de
Facebook, de **IGExport** (con **LoveInsta** de respaldo) para URLs de
Instagram, de **iLoveX** para URLs de X (Twitter) y de **SaveThreads** para
URLs de Threads: analiza un vídeo y muestra las opciones de descarga, o lista
un **perfil completo** de TikTok y descarga en lote, reanudando con el
historial.

Es una aplicación web: interfaz en el navegador + API propia que hace de proxy.

**Web desplegada:** <https://red-ly.vercel.app/>

> **No es una API oficial de TikVid, SavTikPro, SnapYT, FSave, IGExport,
> LoveInsta, iLoveX ni SaveThreads.** Los
> endpoints y el HTML no están documentados y pueden cambiar en cualquier
> momento. El proyecto trabaja únicamente con URLs públicas y peticiones HTTP
> normales, sin autenticación, sin cookies personales y sin medidas de evasión:
> no se saltan CAPTCHAs ni controles de acceso.

---

## Requisitos

* Node.js 20+ (probado en Node 24.11.1 / npm 11.14.1)
* Conexión a Internet sólo para el uso real (los tests no la necesitan)

## Instalación

```bash
npm install
```

## Desarrollo

```bash
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

## Interfaz web

`npm run dev` y abrir `http://localhost:3000`.

### Rutas

| Ruta | Contenido |
| --- | --- |
| `/` | Portada: hero, plataformas, «Obtener programa» y pie |
| `/download/<plataforma>` | Descargador. Funcionan `tiktok`, `youtube`, `facebook`, `instagram`, `twitter` y `threads`; el resto muestra «Próximamente» |
| `/transcript/<plataforma>` | Transcripción. Todas las plataformas muestran «Próximamente» |
| `/privacidad` | Política de datos: qué se guarda, qué no, y con qué terceros |
| `/creditos` | Créditos: tecnologías, iconos y licencias, despliegue y origen del proyecto |
| `/manifest.webmanifest`, `/sw.js` | manifiesto PWA y service worker |

Plataformas: `tiktok`, `youtube`, `facebook`, `instagram`, `twitter`, `threads`
(el registro vive en `lib/platforms.ts`). Una ruta desconocida cae en el 404
propio, que lista las plataformas disponibles.

> **TikTok, YouTube, Facebook, Instagram, X (Twitter) y Threads están
> implementados.** Las demás existen en la estructura de navegación, pero no se
> les asigna ningún endpoint: no se inventan APIs, y no hay ninguna fuente
> comprobada para ellas. La página «Próximamente» lo explica en lugar de
> mostrar un botón que no podría funcionar. Con la transcripción pasa lo mismo
> en **todas** las plataformas.

### Estilo y PWA

Tailwind CSS v4 en `app/globals.css`: un `@import "tailwindcss"` más `@apply`
sobre clases semánticas (`.hero`, `.platform-card`…). El tema claro/oscuro
funciona con `data-theme` en `<html>` (lo escribe el script del `layout.tsx`
antes del primer pintado), no con la clase `.dark`. Los iconos de
`components/icons.tsx` son SVG incrustados (Font Awesome 6), no `react-icons`.

La web es instalable: manifiesto en `app/manifest.ts`, service worker mínimo
(`public/sw.js`, cachea **sólo** `/_next/static/`, que es inmutable; cachear
HTML o `/api/*` expondría contenido caducado o tokens vencidos) y botón de
instalación con instrucciones de iOS en `components/InstallApp.tsx`. El
favicon —una llama con el degradado de la marca— tiene su fuente de verdad en
`app/icon.svg`; los derivados (`favicon.ico`, `apple-icon.png`, iconos PWA)
se regeneran con `node scripts/make-favicon.cjs`.

### Descargador de TikTok

* Pega **`@usuario`** para un perfil, o la URL completa de un **vídeo** o de un
  **post de fotos**. Un perfil pagina el listado hasta reunir los vídeos
  **pendientes** y activa **Descargar N vídeos**.
* Cada descarga va por `/api/download` en streaming con barra de progreso;
  **reintenta hasta 3 veces** ante `429`/`5xx`; el **historial**
  (`localStorage`) marca los ya bajados con «Ya descargado» y los excluye del
  lote. El lote corre en el cliente, secuencial, con 700 ms de pausa.
* El descargador se reparte entre `Downloader.tsx` (orquestador con el estado
  del flujo), piezas presentacionales en `components/downloader/` y
  utilidades sin React en `lib/` (ver árbol de arquitectura).

### Descargador de YouTube

Mismo descargador (`/download/youtube`), con la fuente de YouTube resolviendo
el vídeo:

* Se aceptan **vídeos sueltos**: `watch?v=`, enlaces cortos `youtu.be`,
  `/shorts/`, `/embed/` y `/live/`. Y **listas de reproducción**
  (`/playlist?list=…`), listadas vía YTMP3.gg (API de metadatos
  `yt-meta.convert1s.com`); cada vídeo se resuelve después con SnapYT. Los
  **canales** se rechazan con un mensaje claro (el listado de canales aún no se
  ofrece).
* Las opciones llegan **ordenadas de mayor a menor** —vídeo por resolución y
  audio por bitrate— y, al ser una lista larga (~17 vídeos y ~7 audios), se
  parten en **pestañas Vídeo/Audio** (TikTok, con pocas opciones, sigue en una
  sola columna). La preselección es la **recomendada** (360p MP4 con audio).
  Cada opción de vídeo lleva su etiqueta de audio: «Con audio» (progresiva),
  «Se combina con audio» (las que pasan por `/api/merge`) o «Sin audio»
  (fallback).
* Las calidades altas se descargan **con audio**: si la opción apunta a
  `/api/merge`, la interfaz espera a que SnapYT una las pistas y después baja
  el MP4 por `/api/download` (ver «YouTube» → «Vídeo + audio»).
* Una única fuente (**SnapYT**), sin cadena de respaldo. El nombre de archivo
  usa el id de YouTube (`Redly_dQw4w9WgXcQ.mp4`).

### Descargador de Facebook

Mismo descargador (`/download/facebook`), con **FSave** como fuente única:

* Se aceptan **vídeos sueltos**: `watch?v=`, `/reel/<id>`, `/videos/<id>/`,
  `story.php?story_fbid=…`, enlaces cortos `fb.watch` y variantes `m.`/`fb.com`.
  Las **páginas** no tienen listado: se rechazan con un mensaje claro
  (`supportsProfiles: false`; `/api/profile` → `501`).
* Las opciones llegan **ordenadas de mayor a menor** —vídeo por resolución y
  audio por bitrate—, cada vídeo con su etiqueta de audio (los MP4 de FSave son
  progresivos, **con audio** de fábrica) y la pista de audio aparte (M4A 64 kbps).
* Las opciones apuntan a `/api/render?job=…`: la interfaz espera a que el
  servidor resuelva el trabajo de FSave («Preparando la descarga en el
  servidor…») y después baja el archivo por `/api/download` de siempre.
* El nombre de archivo usa el id del vídeo de Facebook
  (`Redly_10153231379946729.mp4`).

### Descargador de Instagram

Mismo descargador (`/download/instagram`), con **IGExport** como fuente
primaria y **LoveInsta** como respaldo (cadena `searchAny` al estilo de
SavTikPro → TikVid):

* Se aceptan **publicaciones sueltas**: `/reel/<código>`, `/reels/<código>`,
  `/p/<código>` (vídeo o fotos), variantes con prefijo de usuario
  (`/<usuario>/reel/<código>`), con `?igsh=` y `m.`. Los **perfiles** no tienen
  listado: se rechazan con un mensaje claro (`supportsProfiles: false`;
  `/api/profile` → `501`).
* Las opciones de IGExport apuntan **directamente** al CDN de Instagram
  (`scontent-*.cdninstagram.com`): no hay fase de render, la interfaz baja el
  MP4 por `/api/download` de siempre. El enlace va firmado y caduca en ~2 días,
  suficiente porque se consume al analizar.
* Si IGExport falla (contenido no disponible, 5xx agotados…), el respaldo
  **LoveInsta** resuelve la publicación con un único `POST /proxy.php`: los
  vídeos llevan el trabajo de render a `/api/render` (mismo patrón que FSave,
  resolución al pulsar) y las fotos, su URL directa en `dl.iamworker.com`.
* Una publicación de **fotos/carrusel** de IGExport cae en `/api/ig-photo/` y
  devuelve una opción por imagen, con miniatura propia y «Descargar todas»
  (mismo comportamiento que los carruseles de TikTok).
* El título viene del **oEmbed público** de Instagram (best-effort): si falla,
  manda el autor (`@usuario`) y, en último término, el código de la
  publicación. El nombre de archivo usa ese código
  (`Redly_DeMbuYlBfMk.mp4`).

### Descargador de X (Twitter)

Mismo descargador (`/download/twitter`), con **iLoveX** como única fuente
(`IlovexSource` en `lib/ilovex.ts`), sin listados de perfiles:

* Se aceptan **tweets sueltos** con cualquier variante de host (`x.com`,
  `twitter.com`, con `?s=`/`?t=`/`?ref_src=` y sin barra final). Los **perfiles**
  no tienen listado: se rechazan con un mensaje claro (`supportsProfiles:
  false`; `/api/profile` → `501`); `/search`, `/hashtag/…` y los enlaces
  acortados `t.co` no clasifican (`400`).
* El flujo —verificado empíricamente, sin WAF, sin Turnstile y sin claves— son
  dos pasos de `POST /proxy.php`:
  1. **Resolución**: `url=<tweet>` → `{ api: { service: "X", status: "ok",
     title, description, userInfo, mediaStats, mediaItems } }`. Un elemento por
     medio: los **vídeos** traen el trabajo de render del clúster
     `s<nn>.worker<nn>.com/v5/video/<id>/<mediaId>/<calidad>` y las **fotos**,
     su URL directa en `dl.iamworker.com` si superan la allowlist de hosts.
  2. **Render** (sólo vídeo): la opción es relativa (`/api/render?job=…` con
     `source=ilovex`), igual que FSave/LoveInsta: el servidor sondea el job
     hasta `"Completed"` y entrega el `fileUrl` en `dl.iamworker.com` con
     `Content-Disposition` y Range/206, **con audio** (pistas `soun` + `mp4a`
     verificadas).
* Cada vídeo se ofrece en **una sola calidad** (la que trae el job; el servicio
  no expone calidades múltiples) y el título se limpia del prefijo
  `«<autor> en X: …»`. El nombre de archivo usa el id del tweet
  (`Redly_2109957980011552839.mp4`).
* Errores del servicio: `TWEET_UNAVAILABLE`, `Media unavailable.` y
  `service !== "X"` → `UnavailableError` (mensaje claro); cuerpo no JSON o
  `429/5xx` → reintento con backoff.

### Descargador de Threads

Mismo descargador (`/download/threads`), con **SaveThreads** como única fuente
(`SavethreadsSource` en `lib/savethreads.ts`), sin listados de perfiles:

* Se aceptan **publicaciones sueltas** en ambos dominios (`threads.com` y
  `threads.net`, con o sin `www.`, con o sin slug de texto tras el código).
  Los **perfiles** no tienen listado: se rechazan con un mensaje claro
  (`supportsProfiles: false`; `/api/profile` → `501`); `/search`, `/tag/…` y
  las rutas raíz no clasifican (`400`).
* El flujo —verificado empíricamente, sin WAF, sin Turnstile y sin claves— son
  dos pasos de `POST /proxy.php`:
  1. **Resolución**: `url=<post>` → `{ api: { service: "Threads", status: "ok",
     description, userInfo, mediaItems } }`. Un elemento por medio del
     carrusel: los **vídeos** traen el trabajo de render del clúster
     `s<nn>.worker<nn>.com/v5/video/<id>/<mediaId>/<calidad>` y las **fotos**,
     su URL directa en `dl.iamworker.com` si superan la allowlist de hosts.
  2. **Render** (sólo vídeo): la opción es relativa (`/api/render?job=…` con
     `source=savethreads`), igual que FSave/LoveInsta/iLoveX: el servidor
     sondea el job hasta `"Completed"` y entrega el `fileUrl` en
     `dl.iamworker.com` con `Content-Disposition` y Range/206, **con audio**.
* Cada vídeo se ofrece en **una sola calidad** (la que trae el job; el servicio
  entrega la máxima que ofrece Threads, p. ej. 720p) y el título usa la
  descripción del post (o `@autor`). El nombre de archivo usa el código del
  post (`Redly_DWSFx_jErAQ.mp4`).
* Errores del servicio: `POST_UNAVAILABLE`, `service !== "Threads"` y
  maintenance → `UnavailableError` (mensaje claro); cuerpo no JSON o
  `429/5xx` → reintento con backoff. Los tokens de descarga caducan (~2 h según
  la FAQ del servicio): se resuelven al pulsar, sin cachear.

---

## API

Cinco rutas bajo `/api`, implementadas como Route Handlers de Next.js:

| Ruta | Método | Body / Query | Descripción |
| --- | --- | --- | --- |
| `/api/search` | `POST` | `{ url }` | Analiza **un vídeo**: título, ID, miniatura y opciones |
| `/api/profile` | `POST` | `{ url, max?, cursor?, page? }` | Devuelve **una página** de un perfil y el `next_cursor` |
| `/api/merge` | `GET` | `?yt=&v=&a=` | combina vídeo+audio de YouTube en SnapYT y devuelve la URL del MP4 ya unido |
| `/api/render` | `GET` | `?job=&source=` | resuelve un trabajo de render (FSave/Facebook, LoveInsta/Instagram, iLoveX/X o SaveThreads/Threads) y devuelve la URL temporal del archivo |
| `/api/download` | `GET` | `?url=&name=` | hace de proxy de streaming con `Content-Disposition: attachment` |

### Paginación de perfiles

`/api/profile` devuelve **una sola página** por invocación (no el perfil
entero) con `next_cursor` para continuar:

```json
{
  "ok": true,
  "count": 20,
  "max": 100,
  "page": 1,
  "items": [ ... ],
  "next_cursor": "1790035366175"
}
```

* `cursor` ausente o vacío → primera página (`"0"`); `next_cursor: null` → fin.
* `max` es el tope **por invocación** (`API_PROFILE_MAX`, por defecto 100).
* Al paginar fuera de la función, cada llamada se mantiene corta y no se choca
  con `maxDuration` de Vercel. En la web, el bucle se detiene cuando tiene los
  pendientes pedidos, se agota el cursor o llega al tope de páginas.

`/api/profile` acepta el perfil abreviado (`"@usuario"`); en YouTube sólo se
admite la URL completa. Ejemplos:

```bash
curl -X POST localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@usuario/video/123"}'

curl -X POST localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@usuario","max":10}'

curl -L -o video.mp4 "localhost:3000/api/download?url=<enlace>&name=v.mp4"
```

Validaciones (devuelven `400` con `{ ok:false, error }`): URL sin reglas
(`lib/urlrules.ts`), `/api/search` con URL de perfil o `/api/profile` con URL
de vídeo, contenido no resoluble (listas, portadas), `max` por encima del
tope, y `/api/download` con un host fuera de la lista blanca.

### Anti proxy abierto

`/api/download` sólo acepta hosts configurados en `ALLOWED_DOWNLOAD_HOSTS`
(`lib/config.ts`); si no, responde `400`: no puede usarse como proxy hacia
cualquier destino.

### Límite de tasa

Las cinco rutas comparten un único límite en memoria y por ventana deslizante
(`lib/ratelimit.ts`): por defecto **30 peticiones por 60 segundos** por
cliente (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS`), con `429` y
`Retry-After` al superarlo. La clave del cliente sale de `x-forwarded-for`
(sin fiarse de las direcciones posteriores, para no dejar culpar a terceros).

**Límite honesto**: en serverless esto es **por instancia**, no global. Sigue
frenando el abuso desde un mismo cliente, pero no es un techo absoluto.

### Caché de páginas de perfil

`/api/profile` cachea cada página **60 segundos** (`PROFILE_CACHE_TTL_MS`),
con techo de 200 entradas y LRU (`lib/cache.ts`). El TTL es corto a propósito:
cada tarjeta trae una URL de descarga con vida de ~1 hora, y más allá se
servirían enlaces muertos. Igual que el límite, la caché es de memoria de
proceso.

### Fuentes de contenido

Las rutas no instancian proveedores a pelo: la clasificación sale de
`lib/urlrules.ts` y la fuente se resuelve por slug a través de
`lib/sources.ts` (contrato `ContentSource` + registro):

| Fuente | `id` | Plataforma | Notas |
| --- | --- | --- | --- |
| `TikTokSource` | `tiktok` | TikTok | `searchVideo` con fallback SavTikPro → TikVid, perfiles en `SavetikSource` |
| `SnapYTSource` | `snapyt` | YouTube | única fuente (sin cadena de respaldo); vídeo suelto + listas (vía YTMP3.gg) |
| `FsaveSource` | `fsave` | Facebook | única fuente; vídeo suelto (mint → resolve → render diferido) |
| `InstagramSource` | `instagram` | Instagram | `searchVideo` con fallback IGExport → LoveInsta, publicación suelta (sin listados) |
| `IlovexSource` | `ilovex` | X (Twitter) | única fuente; tweet suelto (resolve → render diferido; sin listados) |
| `SavethreadsSource` | `savethreads` | Threads | única fuente; publicación suelta (resolve → render diferido; sin listados) |

```ts
interface ContentSource {
  readonly id: string;
  readonly platforms: readonly string[];
  readonly supportsProfiles?: boolean;   // true en YouTube (listas de reproducción)
  searchVideo(url: string): Promise<TikTokResult>;
  listProfilePage(url, cursor?, page?, limit?): Promise<ProfilePage>;
}
```

Añadir otra plataforma significa implementar el contrato y registrarla, sin
toccar las rutas: sin reglas → `400`; con reglas pero sin fuente → `501`.
SavTikPro, TikVid, SnapYT, FSave, IGExport, LoveInsta, iLoveX y SaveThreads son
terceros sin contrato estable; si hay que cambiar de proveedor, el cambio se
confina en un módulo.

### CORS y despliegue en Vercel

El navegador habla **sólo con la API de Red.ly**, que a su vez habla con los
servicios de terceros: no hay CORS hacia ellos. `vercel.json` fija
`maxDuration: 60` para `app/api/**`; `/api/merge` lo sube a `120` porque
espera la cola de combinación de SnapYT y `/api/render` reserva ese mismo
tope (60 s) para los sondeos de render de FSave, LoveInsta, iLoveX y
SaveThreads. El lote
**no** corre en el
servidor (sin FS persistente entre invocaciones): la cola vive en el
navegador.

---

## Destino de las descargas

Cada perfil se guarda en **su propia subcarpeta**, con el nombre del perfil
saneado (`@scout2015` → `scout2015/`):

```text
Carpeta elegida/            ← o «Descargas» del navegador
  scout2015/
    Redly_7694475743509646622.mp4
```

| Modo | Cómo se guarda | Navegadores |
| --- | --- | --- |
| **Elegir carpeta** (botón) | `showDirectoryPicker()` y escritura directa en streaming (`lib/fsaccess.ts`) | Chrome, Edge, Opera |
| **Descargas del navegador** (por defecto) | `a[download]` con nombre `perfil/archivo.mp4`; Firefox y Safari dejan el archivo plano | Todos |

La carpeta elegida vive sólo en memoria de la sesión (los
`FileSystemDirectoryHandle` no se serializan) y exige contexto seguro (HTTPS o
`localhost`).

---

## Historial de descargas

Evita repetir vídeos ya bajados. Guarda **sólo** estado, nombre de archivo,
bytes y título — **nunca URLs ni tokens**, que caducan pronto — en
`localStorage` (`redly-history-v1`), sólo en el navegador.

* El análisis de un perfil pagina hasta reunir los **pendientes**; los ya
  descargados aparecen con «Ya descargado», atenuados y desmarcados.
* El lote sólo baja las casillas marcadas y cada vídeo se marca al terminar:
  si el navegador se cierra a mitad, lo ya bajado no se repite.
* Botón **"Borrar historial"**; en modo privado la app funciona pero avisa de
  que cada análisis empezará de cero.

---

## Arquitectura

```text
Redly/
│
├── app/
│   ├── layout.tsx              # <html>, metadata, bootstrap del tema
│   ├── page.tsx                # Portada (servidor): tarjetas de plataforma
│   ├── not-found.tsx           # 404 con las plataformas disponibles
│   ├── privacidad/             # /privacidad: política de datos
│   ├── globals.css             # Tailwind v4 + temas claro/oscuro (CSS vars)
│   ├── icon.svg                # favicon (llama): fuente de verdad
│   ├── favicon.ico             # derivado: 16/32/48 vía scripts/make-favicon.cjs
│   ├── apple-icon.png          # derivado: 180x180 opaco para iOS
│   ├── manifest.ts             # manifiesto PWA (convención de ficheros de Next)
│   ├── download/[platform]/    # /download/{tiktok,youtube,facebook,instagram,twitter,threads} (UI) | resto: "Próximamente"
│   ├── transcript/[platform]/  # /transcript/* → todas "Próximamente"
│   └── api/
│       ├── _responses.ts       # errorResponse() compartido (archivo privado)
│       ├── search/route.ts     # POST: analiza un vídeo
│       ├── profile/route.ts    # POST: una página de perfil + next_cursor
│       ├── merge/route.ts      # GET: combina vídeo+audio (SnapYT vd_mux)
│       ├── render/route.ts     # GET: resuelve el render de FSave/LoveInsta/iLoveX/SaveThreads
│       └── download/route.ts   # GET: streaming + lista blanca de hosts
│
├── public/                     # estáticos servidos en la raíz del sitio
│   ├── sw.js                   # service worker: caché sólo de /_next/static/
│   └── icons/                  # icon-192 / icon-512 / maskable-512 (PWA)
│
├── components/                 # componentes React compartidos
│   ├── SiteHeader.tsx          # cabecera: marca + nav desplegable + tema
│   ├── SiteFooter.tsx          # pie compartido por todas las rutas
│   ├── ThemeToggle.tsx         # tema claro/oscuro (sólo lee al montar)
│   ├── ServiceWorker.tsx       # registra /sw.js, sólo en producción
│   ├── InstallApp.tsx          # botón de instalación + instrucciones iOS
│   ├── Downloader.tsx          # orquestador de la UI del descargador (estado del flujo)
│   ├── downloader/             # piezas del descargador, extraídas de Downloader
│   │   ├── DestinationRow.tsx  # fila de destino (carpeta elegida + estado)
│   │   ├── VideoPanel.tsx      # resultado de un vídeo suelto (presentacional)
│   │   ├── ProfilePanel.tsx    # resultado de un perfil (presentacional)
│   │   ├── ProgressBar.tsx     # barra de progreso, con variante indeterminada
│   │   ├── useDestination.ts   # selector de carpeta + fábrica de destinos
│   │   └── useDownloadHistory.ts # historial reactivo sobre lib/history
│   ├── ComingSoon.tsx          # estado "Próximamente" por plataforma
│   ├── PlatformIcon.tsx        # icono de marca por slug de plataforma
│   └── icons.tsx               # SVG incrustados (FA6), sin react-icons
│
├── lib/                        # núcleo portable, sin dependencias de Next
│   ├── config.ts               # endpoints, headers, timeouts, allowlist, .env
│   ├── exceptions.ts           # jerarquía TikVidError
│   ├── models.ts               # TikTokResult, ProfileVideo, optionLabel, bestQualityOption
│   ├── platforms.ts            # registro de plataformas (fuente única de rutas)
│   ├── sources.ts              # contrato ContentSource + registro (TikTok, SnapYT, FSave, Instagram, iLoveX, SaveThreads)
│   ├── urlrules.ts             # reglas de URL por plataforma (clasificación de la entrada)
│   ├── site.ts                 # constantes de UI (REPO_URL, enlace de la app)
│   ├── ratelimit.ts            # límite de tasa por cliente (ventana deslizante)
│   ├── cache.ts                # TtlCache con LRU + caché de páginas de perfil
│   ├── download-stream.ts      # descarga con progreso en el navegador (sin React)
│   ├── sanitize.ts             # nombres de archivo/carpeta (apt navegador)
│   ├── urls.ts                 # URLs de TikTok: validación, handle y carpeta
│   ├── youtube-urls.ts         # URLs de YouTube: vídeo, canal y lista (apt navegador)
│   ├── facebook-urls.ts        # URLs de Facebook: vídeo y página (apt navegador)
│   ├── instagram-urls.ts       # URLs de Instagram: publicación y perfil (apt navegador)
│   ├── threads-urls.ts         # URLs de Threads: publicación y perfil (apt navegador)
│   ├── twitter-urls.ts         # URLs de X (Twitter): tweet y perfil (apt navegador)
│   ├── http.ts                 # fetch con timeouts, reintentos y backoff
│   ├── parser.ts               # HTML -> TikTokResult (cheerio, selectores con fallback)
│   ├── client.ts               # TikVidClient: POST /api/ajaxSearch
│   ├── savetik.ts              # SavTikPro: página única, perfiles, 1 vídeo, searchAny
│   ├── snapyt.ts               # SnapYT: YouTube en 3 pasos vía admin-ajax (vídeo + listas)
│   ├── ytmp3.ts                # YTMP3.gg: listas vía API de metadatos yt-meta (+ og:title)
│   ├── fsave.ts                # FSave: mint HMAC → resolve → render (Facebook)
│   ├── igexport.ts             # IGExport: ig-reels → ig-photo + oEmbed (Instagram, con searchAny)
│   ├── loveinsta.ts            # LoveInsta: respaldo de Instagram (POST /proxy.php → jobs)
│   ├── ilovex.ts               # iLoveX: tweet de X (resolve → render, POST /proxy.php)
│   ├── savethreads.ts          # SaveThreads: publicación de Threads (resolve → render, POST /proxy.php)
│   ├── history.ts              # historial de descargas (storage inyectable)
│   ├── fsaccess.ts             # sinks de escritura + selector de carpeta (web)
│   └── downloader.ts           # resolveUrl (redirects), sanitizeFilename, streaming
│
├── scripts/api-smoke.ts        # handlers reales contra la red
├── scripts/extract-icons.cjs   # regenera components/icons.tsx
├── scripts/make-favicon.cjs    # regenera favicon.ico, apple-icon.png e iconos PWA (usa sharp)
├── postcss.config.mjs          # plugin @tailwindcss/postcss
├── tests/                      # vitest, sin red (+ fixtures: HTML y JSON)
├── vercel.json                 # framework nextjs, maxDuration 60
├── vitest.config.ts            # alias @/ + env en cero para reintentos/pausas
└── .env.example
```

Responsabilidades separadas: `lib/http.ts` no parsea HTML, `lib/parser.ts` no
hace peticiones, `lib/savetik.ts` sólo lista y resuelve, `lib/downloader.ts` no
conoce el flujo de búsqueda y `lib/history.ts` sólo guarda estado (sin tocar
red ni disco). Los Route Handlers son delgados: sólo orquestan `lib/`.

`lib/` no importa nada de `next/`, de modo que los tests lo usan tal cual.
Además, `lib/sanitize.ts`, `lib/urls.ts`, `lib/models.ts`, `lib/history.ts`
y `lib/fsaccess.ts` **tampoco importan `node:*`**, así que el navegador los
usa directamente (es lo que permite el destino de descargas y el historial web).

---

## Flujo HTTP (TikTok)

1. Clasificación de la URL por plataforma (`lib/urlrules.ts`) y validación de
   la forma (`lib/urls.ts`: debe ser `tiktok.com` o un subdominio).
2. `POST https://tikvid.io/api/ajaxSearch` con headers de navegador
   (`Content-Type: application/x-www-form-urlencoded`, `X-Requested-With:
   XMLHttpRequest`), payload `q=<URL_TIKTOK>&lang=en`. Sin esas cabeceras,
   Cloudflare responde `403`. La respuesta `{ "status": "ok", "data": "<HTML>" }`
   pasa a `parseSearchHtml()` (cheerio). No se copian cookies ni tokens.
3. **Perfil (SavTikPro)**: `POST https://savetikpro.com/api/ajaxSearch` con
   `q`, `cursor`, `page` y `lang`; `cursor=""` o una `q` con barra final dan
   `404`, así que se normaliza antes de enviar.

Reintentos y timeouts: `REQUEST_TIMEOUT = 30`, `DOWNLOAD_TIMEOUT = 120`,
`RETRY_ATTEMPTS = 3` con backoff breve, sólo ante transitorios (timeouts,
conexión y `429/5xx`).

---

## Parsing (TikTok)

No depende de una estructura exacta: para cada dato se prueba una lista de
selectores priorizados y, si ninguno funciona, se devuelve vacío sin romper la
ejecución (título, thumbnail, video ID, enlaces de descarga y, en el modo
fotos, los items del carrusel). Se excluyen enlaces de navegación y se
deduplican las URLs.

| Botón | `format` | `quality` | `kind` |
| --- | --- | --- | --- |
| `Download MP4` | `mp4` | `standard` | `video` |
| `Download MP4 HD` | `mp4` | `hd` | `video` |
| `Download Photo` | `jpeg` | — | `image` |
| `Download MP3` | `mp3` | `audio` | `audio` |

Las **publicaciones de fotos** traen un botón por imagen (no calidades), se
añaden por delante de las demás para que la selección automática tome la foto
si no hay MP4, y la extensión se lee del `filename` del JWT de
`pro.snapcdn.app` (con `jpeg` de reserva). En la web se presentan como
galería, con «Descargar todas» y numeración por foto. **Sólo por URL de
post**: el listado de perfil de SavTikPro no incluye publicaciones de fotos
(verificado empíricamente), así que nunca las traerá.

### URLs temporales y descarga

Las opciones apuntan a enlaces firmados de CDN (`pro.snapcdn.app` con JWT de
~1 hora, o dominios de TikTok). El proyecto no las guarda, no las registra en
logs ni las versiona: sólo las usa en la ejecución.
`resolveUrl()` (`lib/downloader.ts`) sigue las redirecciones manualmente, y
`/api/download` devuelve el cuerpo al navegador como stream, sin
materializarlo en el servidor. Los nombres se sanean localmente
(`Redly_<id>.<ext>`, sin `..`, `/`, `\` ni nombres reservados de Windows).

---

## YouTube

YouTube se resuelve con **una única fuente, SnapYT** (`SnapYTSource`, sin
cadena de respaldo) para vídeos sueltos, y **YTMP3.gg** para el listado de
listas de reproducción (ver más abajo). El flujo de SnapYT —verificado
empíricamente, sin WAF— usa el endpoint WordPress `admin-ajax.php` en tres
pasos:

1. **Nonce**: `POST action=vd_fresh_nonce` → `{ success, data: { nonce } }`.
2. **Resolución**: `POST action=process_video_url` con `video_url` y
   `security=<nonce>` → `{ success, data: { redirect: "…/video-preview/?…" } }`.
3. **Preview**: `GET` esa URL; el HTML trae un `<select id="fmt-select">` con
   todas las opciones en `<option data-kind data-size data-force>`.

El binario no se sirve de `googlevideo.com` directamente: pasa por el proxy de
SnapYT (`action=snapyt_force_download`), que responde `Content-Disposition:
attachment`. Por eso `snapyt.app` y `googlevideo.com` están en
`ALLOWED_DOWNLOAD_HOSTS`.

Reglas comprobadas (fixture compartido con los tests:
`tests/fixtures/snapyt_preview.html`):

* Sin `fmt-select`, o con opciones sin `data-force`, no hay nada que descargar.
* `data-kind` decide el tipo: `video+audio`/`video-only` → vídeo,
  `audio-only` → audio.
* Las opciones se reordenan de mayor a menor: vídeo por resolución y audio por
  bitrate, con el audio al final; la preselección de la UI es la recomendada
  (la progresiva «Recommended», que ya trae audio).
* La validación de forma va antes de cualquier petición: canales y listas no
  llegan ni a pedir el nonce (`supportsProfiles: false`; `/api/profile` → `501`).
* Las URLs de descarga traen parámetros temporales (`nonce`, `t`): se piden y
  se consumen al momento.

### Vídeo + audio (combinación)

Las calidades altas (`data-kind="video-only"`, de 144p a 2160p) **no llevan
audio**: está en pistas aparte. Sólo la progresiva recomendada (360p MP4) y el
audio se descargan directas. Para entregar alta calidad con sonido, SnapYT
ofrece **combinación server-side** en su web (`action=vd_mux_start` →
`vd_mux_status` → `vd_mux`, que sirve el MP4 ya unido).

Red.ly lo expone en tres piezas:

* **`lib/snapyt.ts`** — si el preview trae el formulario de combinación
  (`#merge-link`, selects `#mux-video`/`#mux-audio`, audio por defecto), las
  opciones `video-only` entregan una **URL relativa** `/api/merge?yt&v&a` en
  lugar de `data-force`. El servidor valida los índices contra el preview
  fresco, arranca la combinación (con un reintento por la ruta de reserva de
  SnapYT), espera el resultado con un tope de 90 s (cancelando el trabajo si
  se pasa) y valida el host del enlace final contra la lista blanca.
* **`app/api/merge/route.ts`** — `GET /api/merge?yt&v&a`: límite de tasa y
  validación de la URL de YouTube y de los índices; devuelve
  `{ ok: true, url }` (errores: `400`, `410` si el servicio no lo resuelve,
  `502`, `429`; `maxDuration = 120`).
* **`components/Downloader.tsx`** — si `option.url` empieza por `/`, primero
  espera la combinación («Combinando vídeo y audio en el servidor…») y
  después descarga el MP4 por `/api/download` de siempre.

**Fallback**: si SnapYT retira el formulario, las opciones conservan su
`data-force` y se descargan como antes —vídeo **sin audio**— sin romper nada.

### Listas de reproducción

Las listas (`/playlist?list=…`) se listan con **YTMP3.gg** (`lib/ytmp3.ts`),
cuya API de metadatos `yt-meta.convert1s.com` sirve el contenido de la lista
sin clave, WAF ni Turnstile (verificado empíricamente):

1. `GET https://yt-meta.convert1s.com/playlist?id=<PL…>` → `{ nextPageToken?,
   items: [{ id, title, channel, thumbnail }] }`, con hasta **100** vídeos por
   página. `pageToken` es un token opaco de continuación que se devuelve tal
   cual en la petición siguiente.
2. El servicio **no** expone el título de la lista ni su total: el título se
   recupera del `og:title` de la propia página pública de YouTube (mejor
   esfuerzo; si falla, la UI degrada a un texto genérico) y el canal se deduce
   del primer vídeo listado.

Cada vídeo se convierte en `ProfileVideo` con `url` y `postUrl` apuntando al
watch URL: la descarga por lotes resuelve la calidad de cada uno vía
`/api/search` (SnapYT) con `batchOption` (`lib/models.ts`), que la UI expone
como selector con tres modos:

* **Recomendada (con audio)** — la mejor opción directa, ya completa (p. ej.
  la progresiva de 720p). Es el comportamiento histórico y el más rápido.
* **Máxima calidad (con combinación)** — la de mayor resolución entre las
  útiles, incluida la que SnapYT sirve como `/api/merge?…` (1080p vídeo+audio
  unidos en su servidor). Cada vídeo suma una llamada extra y puede tardar
  ~90 s esperando la cola de SnapYT; las pistas mudas sin combinación se
  descartan para no bajar un vídeo sin sonido.
* **Solo audio** — sólo la pista de sonido de cada vídeo (MP3 convertido u
  opus/m4a original, la de mayor bitrate), descargada directamente sin
  combinación. Si un vídeo no ofrece pista de audio, se omite y se cuenta en
  el resumen del lote en lugar de bajar su vídeo en silencio.

Límites: hasta 100 vídeos por página (paginación por `pageToken`), **sólo
listas** —los canales se rechazan— y el servicio no aporta vistas ni el total
de la lista.

---

## Facebook (FSave)

Facebook se resuelve con **una única fuente, FSave** (`FsaveSource` en
`lib/fsave.ts`), sin listados de páginas. El flujo —verificado empíricamente,
sin navegador ni claves, todo server-side— son tres pasos de sesión y un
trabajo de render:

1. **Mint** (`POST https://fsave.net/mint.php`): `getch=1` devuelve un
   challenge `ch` de un solo uso; se responde con
   `answer = HMAC-SHA256(ch, K)` recortado a 32 hex. La clave `K` está en
   claro en el JS público del servicio (`/assets/js/sensor.js`): si girara, se
   relee de ahí y se reintenta una vez. La respuesta es `dt`, el token de
   sesión (caduca; se pide **en cada invocación**, sin cachear).
2. **Resolve** (`POST /proxy.php` con `url` + `dt`): devuelve el `api` del
   post (título, `id`, miniatura, `mediaItems[]`). Sin `dt` válido responde
   `403 STALE_PAGE` → se renueva el mint y se reintenta una vez.
3. **Render** (`POST /proxy.php` con el `mediaUrl` del trabajo): sondea el
   progreso hasta `"Completed"` y devuelve `fileUrl` (host `dl.iamworker.com`,
   con `Content-Disposition` y soporte de `Range`; el enlace vive ≥10 min).

Reglas comprobadas:

* `mediaItems[]` trae MP4 progresivos (`1080x1920`, `720x1280`…, **con audio**)
  y una pista M4A de 64 kbps. Las calidades se ordenan de mayor a menor (el
  `quality` es el lado corto de la resolución: `1080p`, `720p`).
* Los `mediaUrl` de vídeo no son descargables: sólo devuelven el estado del
  trabajo, así que las opciones entregan una **URL relativa**
  `/api/render?job=<mediaUrl>` y el render se resuelve en el servidor.
* `app/api/render/route.ts` valida el `job` contra el patrón del CDN de FSave
  (`isFsaveJobUrl`), pide un `dt` fresco, sondea con tope y valida el
  `fileUrl` final contra `ALLOWED_DOWNLOAD_HOSTS` (errores: `400`, `410` si el
  servicio no lo resuelve, `502`, `429`; `maxDuration = 60`).
* Errores del servicio: `INVALID_URL`/`WRONG_SERVICE` → `UnavailableError`
  (mensaje claro), `FETCH_ERROR` → reintento, `429/5xx` → backoff.
* Formas de enlace aceptadas (`lib/facebook-urls.ts`): `watch?v=`,
  `/reel/<id>`, `/videos/<id>/`, `story.php?story_fbid=`, `share/v/`,
  `fb.watch/<código>`; las páginas (`/usuario`, `profile.php?id=`) clasifican
  como perfil y la fuente las rechaza sin tocar la red.

---

## Instagram (IGExport + LoveInsta)

Instagram se resuelve con la fachada `InstagramSource` (`lib/sources.ts`), que
encadena **IGExport** (`IgexportSource` en `lib/igexport.ts`) con el respaldo
**LoveInsta** (`LoveInstaSource` en `lib/loveinsta.ts`), sin listados de
páginas en ninguno de los dos. El flujo primario —verificado empíricamente,
sin navegador ni claves, todo server-side— son dos endpoints JSON y un oEmbed:

1. **Vídeo** (`GET https://igexport.com/api/ig-reels/?url=<publicación>&videoOnly=1`):
   devuelve `{ ok, media: { videoUrl, thumbnailUrl, filename } }` con el MP4
   **directo** en el CDN de Instagram. Si la publicación no tiene vídeo, responde
   `404 not_found` y se pasa al paso 2.
2. **Fotos** (`GET /api/ig-photo/?url=<publicación>`): devuelve
   `{ ok, media: { shortcode, items: [...] } }` con los elementos de una
   publicación de fotos o carrusel (cada elemento con su `type`).
3. **Metadatos** (`GET https://www.instagram.com/api/v1/oembed/?url=…&format=json`):
   título (pie) y autor, en modo **best-effort**: un solo intento y, si falla,
   el título cae al autor o al código de la publicación.

Reglas comprobadas:

* El archivo vive en `scontent-<borde>-<n>.cdninstagram.com` (el borde varía por
  región, por eso la allowlist casa con el sufijo `cdninstagram.com`); admite
  `Range` con `206`, es `video/mp4` **con audio** (pistas `soun` + `mp4a`
  verificadas) y no trae `Content-Disposition`, que lo pone `/api/download`.
* La URL va firmada y caduca en ~2 días (`oe`): se consume al analizar; si se
  reintenta desde el historial pasado ese plazo, hay que volver a analizar.
* Errores del servicio: `invalid_url`/`not_found` → `UnavailableError` (mensaje
  claro), `429/5xx` y cuerpos no JSON (p. ej. el `502` HTML de `ig-posts`) →
  reintento con backoff.
* Formas de enlace aceptadas (`lib/instagram-urls.ts`): `/reel/<código>`,
  `/reels/<código>`, `/p/<código>`, `/tv/<código>`, con prefijo de usuario, con
  query (`?igsh=`) y sin barra final; las páginas (`/usuario`) clasifican como
  perfil y la fuente las rechaza sin tocar la red.

### Respaldo: LoveInsta

Cuando IGExport devuelve un error de la casa (`invalid_url`, `not_found`,
`5xx` agotados…), `searchAny` prueba con **LoveInsta** —espejo de la cadena
SavTikPro → TikVid— cuyo flujo, verificado empíricamente sin WAF y sin claves
(incluso con un `POST` sin headers de navegador), es un solo paso:

1. **Resolución** (`POST https://loveinsta.com/proxy.php` con `url=<publicación>`):
   devuelve `{ api: { service: "Instagram", status: "ok", title, mediaItems } }`
   con un elemento por medio de la publicación: los **vídeos** traen el trabajo
   de render del clúster `s<nn>.worker<nn>.com/v5/video/<id>/<hash>/<calidad>`
   y las **fotos**, la URL directa en `dl.iamworker.com`.
2. **Vídeos**: la opción es relativa (`/api/render?job=…`), igual que FSave: el
   servidor sondea el job con el mint de FSave (mismo clúster; resolución
   verificada de un job de LoveInsta con el flujo de `/api/render` existente) y
   entrega el `fileUrl` en `dl.iamworker.com` con `Content-Disposition` y
   Range/206, **con audio** (pistas `soun` + `mp4a` verificadas).
3. **Fotos**: URL directa validada contra la allowlist (`image/jpeg`,
   `attachment`); el token firma la URL y se comprobó **viva ≥10 min**, pero
   conviene consumirla al momento (igual que el resto de enlaces temporales).

Errores del servicio (todos JSON): `400 INVALID_URL`/`WRONG_SERVICE` y
`200 api.status:"error"` (`MEDIA_UNAVAILABLE`, `VIDEO_NOT_FOUND`) →
`UnavailableError`; cuerpo no JSON o `429/5xx` → reintento con backoff.

---

## Threads (SaveThreads)

Threads se resuelve con **una única fuente, SaveThreads** (`SavethreadsSource`
en `lib/savethreads.ts`), sin listados de páginas. El flujo —verificado
empíricamente, sin WAF, sin Turnstile y sin claves, todo server-side— es el
mismo patrón que iLoveX (mismo clúster de trabajos `worker*.com`):

1. **Resolución** (`POST https://savethreads.com/proxy.php` con
   `url=<publicación>`): devuelve
   `{ api: { service: "Threads", status: "ok", description, userInfo,
   mediaItems } }` con un elemento por medio del carrusel: los **vídeos** traen
   el trabajo de render del clúster
   `s<nn>.worker<nn>.com/v5/video/<id>/<mediaId>/<calidad>` y las **fotos**, la
   URL directa en `dl.iamworker.com`.
2. **Vídeos**: la opción es relativa (`/api/render?job=…&source=savethreads`),
   resolución perezosa al pulsar: el servidor sondea el job sin sesión hasta
   `"Completed"` y entrega el `fileUrl` en `dl.iamworker.com` con
   `Content-Disposition` y Range/206, **con audio**.
3. **Fotos**: URL directa validada contra la allowlist (`image/jpeg`,
   `attachment`, Range/206); el token firma la URL y la FAQ del servicio habla
   de ~2 horas de vida, así que conviene consumirla al momento.

Reglas comprobadas:

* Acepta ambos dominios (`threads.com` y `threads.net`); el código del post es
  alfanumérico con guiones bajos (`DWSFx_jErAQ`) y a veces va seguido de un
  slug legible.
* Cada vídeo se ofrece en **una sola calidad** (la máxima que entrega Threads,
  p. ej. `720p`); el carrusel se muestra elemento a elemento (vídeos y fotos
  por separado, en ese orden).
* Errores del servicio: `POST_UNAVAILABLE`/`service !== "Threads"` →
  `UnavailableError` (mensaje claro); cuerpo no JSON o `429/5xx` → reintento
  con backoff (el propio JS del servicio contempla 429 con backoff creciente).
* Formas de enlace aceptadas (`lib/threads-urls.ts`): `/@usuario/post/<código>`
  con o sin slug final, en `threads.com`/`threads.net`; los perfiles
  (`/@usuario`) clasifican como perfil y la fuente los rechaza sin tocar la
  red.

---

## Tests

```bash
npm test
```

381 tests en 25 ficheros, **sin Internet** (mock de `fetch` encolado y fixtures
HTML anonimizadas en `tests/fixtures/`, con pids/nonces sustituidos por
valores ficticios):

* `platforms` · `sources` · `urlrules` · `urls` · `youtube-urls` ·
  `facebook-urls` (11) · `instagram-urls` (9) · `threads-urls` (8) ·
  `twitter-urls` (8) — registro de
  plataformas/fuentes, contrato `ContentSource` y validación/clasificación de
  URLs.
* `fsave` (28) — mint HMAC (incluida la rotación de clave vía `sensor.js`),
  resolución de posts, sondeo de render, mapeo al modelo y errores del
  servicio (`STALE_PAGE`, `WRONG_SERVICE`, no JSON…), sin red.
* `igexport` (23) — resolución de reels con el MP4 directo, caída a fotos ante
  un `404`, carruseles, filtrado de hosts, mapeo de errores (`invalid_url`,
  `502` no JSON), reintentos de red, el título del oEmbed con sus fallbacks y
  la cadena `searchAny` (primario → respaldo, incluida la propagación de
  errores ajenos a la casa).
* `loveinsta` (19) — el respaldo de Instagram en un solo `POST`: jobs de render
  como opción perezosa con la calidad leída del job, fotos directas con
  miniatura, mezcla vídeo+foto con orden estable, mapeo de errores
  (`INVALID_URL`, `WRONG_SERVICE`, `MEDIA_UNAVAILABLE`, no JSON), reintentos
  ante `429`/red y validación de jobs y hosts.
* `ilovex` (23) — la fuente de X en dos `POST /proxy.php`: resolución de un
  tweet (vídeo con job de render perezoso + foto directa si supera la
  allowlist, mezcla con orden estable), sondeo de render (`Completed`,
  `fileUrl`, `percent`), errores del servicio (`TWEET_UNAVAILABLE`,
  `Media unavailable.`, `service` ajeno, no JSON), reintentos, limpieza del
  título y validación de jobs y hosts.
* `savethreads` (23) — la fuente de Threads en dos `POST /proxy.php`:
  resolución de una publicación (vídeo con job de render perezoso + foto
  directa si supera la allowlist, orden por altura), sondeo de render
  (`Completed`, `fileUrl`, `percent`), errores del servicio
  (`POST_UNAVAILABLE`, `service` ajeno, no JSON), reintentos, limpieza del
  título y validación de jobs y hosts.
* `snapyt` (22) — preview → modelo (orden, `data-kind`, merge), flujo de tres
  pasos, reintentos y errores.
* `ytmp3` (9) — listas de YouTube vía YTMP3.gg: mapeo a `ProfileVideo`, título
  (`og:title`) y canal en `meta`, paginación por token opaco, rechazo de
  canales, 500 del servicio y respuesta no JSON.
* `merge` — `prepareMergedDownload` end-to-end: happy path, validaciones de
  índices, reintento de reserva, puerta `retry_in`, estado `404` y lista
  blanca de hosts.
* `savetik` (25) y `parser` — TikVid/SavTikPro: perfiles paginados,
  selección con fallback de selectores, carrusel de fotos.
* `ratelimit` · `cache` · `history` · `download-stream` · `sanitize` —
  utilidades del núcleo.
* `models` — etiquetas y selección de calidad: `bestQualityOption` y
  `batchOption` (recomendada/máxima/solo audio del lote, descarte de pistas
  mudas, elección de la pista de audio de mayor bitrate).

Smoke de red (opcional, **sí** necesita Internet):

```bash
npm run smoke   # invoca los handlers de /api/* con Request reales
```

Cubre la paginación real de un perfil (sigue el `next_cursor` y comprueba que
la página 2 no se solapa), el flujo de combinación de YouTube completo:
opción máxima → `/api/merge` → URL temporal → bytes del MP4 con audio por
`/api/download`, el listado de una lista de reproducción real vía YTMP3.gg
(`postUrl` apunta al watch URL de cada vídeo), el flujo de Facebook completo:
búsqueda real en FSave → `/api/render` → bytes del MP4 por `/api/download`,
más el rechazo de páginas sin listado, el flujo de Instagram completo:
búsqueda real en IGExport → opciones directas en el CDN de Instagram → bytes
del MP4 por `/api/download`, más el rechazo de perfiles sin listado, el
flujo del respaldo de Instagram: búsqueda real en LoveInsta → `/api/render`
(job del clúster) → bytes del MP4 por `/api/download`, el flujo de X completo:
búsqueda real en iLoveX → `/api/render?source=ilovex` (job del clúster) →
bytes del MP4 por `/api/download`, más el rechazo de perfiles sin listado, el
flujo de Threads completo: búsqueda real en SaveThreads →
`/api/render?source=savethreads` (job del clúster) → bytes del MP4 por
`/api/download`, más el rechazo de perfiles sin listado.

---

## Configuración

Todo lo configurable vive en `lib/config.ts` (se lee de `.env`/variables de
entorno, sin sobreescribir valores ya definidos):

```text
SAVETIK_BASE_URL / SAVETIK_AJAX_SEARCH_URL / SAVETIK_HOME_PATH / SAVETIK_LANG
TIKVID_BASE_URL / TIKVID_AJAX_SEARCH_URL
SNAPYT_BASE_URL / SNAPYT_AJAX_URL   # fuente de YouTube (SnapYT)
YT_YTMP3_META_BASE_URL / YT_YTMP3_PLAYLIST_PATH / YT_YTMP3_MAX_PER_PAGE
                            # listas de YouTube (YTMP3.gg, API de metadatos)
FSAVE_BASE_URL / FSAVE_MINT_URL / FSAVE_PROXY_URL / FSAVE_SENSOR_URL
FSAVE_MINT_KEY / FSAVE_RENDER_ATTEMPTS   # fuente de Facebook (FSave)
IGEXPORT_BASE_URL / IGEXPORT_REELS_URL / IGEXPORT_PHOTO_URL
INSTAGRAM_OEMBED_URL              # fuente primaria de Instagram (IGExport) + oEmbed
LOVEINSTA_BASE_URL / LOVEINSTA_PROXY_URL   # respaldo de Instagram (LoveInsta)
ILOVEX_BASE_URL / ILOVEX_PROXY_URL / ILOVEX_RENDER_ATTEMPTS   # fuente de X (iLoveX)
SAVETHREADS_BASE_URL / SAVETHREADS_PROXY_URL / SAVETHREADS_RENDER_ATTEMPTS   # fuente de Threads (SaveThreads)
REQUEST_TIMEOUT / DOWNLOAD_TIMEOUT / MAX_REDIRECTS
RETRY_ATTEMPTS / RETRY_BACKOFF_SECONDS
API_PROFILE_MAX              # tope de vídeos POR INVOCACIÓN (no por perfil)
RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS   # límite de tasa de /api/*
PROFILE_CACHE_TTL_MS      # TTL de la caché de páginas de perfil
```

`RATE_LIMIT_*` y `PROFILE_CACHE_TTL_MS` se leen directamente en
`lib/ratelimit.ts` y `lib/cache.ts` (no pasan por `lib/config.ts`) para que
cada módulo sea autosuficiente; el efecto es el mismo.
`ALLOWED_DOWNLOAD_HOSTS` **no** es variable de entorno: es una constante con
la lista fija de CDNs, dentro de `lib/config.ts`. Copia `.env.example` a
`.env.local` para sobreescribir valores.

---

## Despliegue en Vercel

Proyecto desplegado y funcionando en **<https://red-ly.vercel.app/>**.

1. Importa el repositorio en Vercel (framework detectado: Next.js).
2. No se requieren secretos ni claves: el proyecto trabaja con URLs públicas.
3. `vercel.json` ya fija `maxDuration: 60` para `app/api/**`.

Notas:

* **No hay FS persistente entre invocaciones de función**: el historial vive en
  `localStorage` del navegador, nunca en el servidor.
* El lote de la web corre en el cliente y pagina el perfil invocación a
  invocación (`/api/profile` + `cursor`), por lo que cada llamada es corta.
* Si el origen bloquea el despliegue, revisa `ALLOWED_DOWNLOAD_HOSTS` y los
  endpoints en `lib/config.ts`.

---

## Limitaciones

* TikVid, SavTikPro, SnapYT, FSave, IGExport, LoveInsta, iLoveX y SaveThreads
  no ofrecen
  APIs públicas
  documentadas: los endpoints, el HTML, las claves embebidas en su JS, las
  clases CSS y los CDNs pueden cambiar sin aviso.
* El acceso puede estar protegido por Cloudflare; una respuesta HTML en lugar
  de JSON se reporta como error claro.
* Las URLs temporales expiran (`403/404/410`). Si el token caducó, hay que
  volver a analizar para recibir uno fresco.
* El listado de perfil depende de SavTikPro: si cambia el `next_cursor` o las
  clases de las tarjetas, habrá que ajustar `lib/savetik.ts`.
* Las **publicaciones de fotos** (carrusel) sólo se pueden descargar analizando
  su URL individual: el listado de perfil de SavTikPro **no las incluye** y cada
  tarjeta trae un único enlace directo (ver «Parsing»).
* El scraping directo de `tiktok.com/@usuario` **no está implementado** (WAF).
* En YouTube están el **vídeo suelto** y las **listas de reproducción** (vía
  YTMP3.gg, hasta 100 vídeos por página): los **canales** y las
  **transcripciones** no tienen soporte, y las URLs de descarga de SnapYT
  llevan parámetros temporales que conviene consumir al momento. El lote de una
  lista baja por defecto la mejor opción directa de cada vídeo y permite elegir
  **máxima calidad**, que usa la combinación de SnapYT una vez por vídeo (más
  lento y con llamada extra a `/api/merge`, compartiendo el límite de tasa de
  30 req/60 s por instancia).
* La API de metadatos de YTMP3 **no trae vistas ni el total de la lista** —ni
  de la lista ni de cada vídeo—, por lo que la tarjeta de resultado muestra el
  título (del `og:title` de YouTube), el canal (deducido del primer vídeo) y el
  recuento de los ya listados, pero no reproducciones ni el total real.
* Las calidades altas de YouTube se descargan **con audio** combinando las
  pistas en el servidor de SnapYT (ver «YouTube» → «Vídeo + audio»); la
  combinación depende de la cola de esa web (90 s de tope) y, si SnapYT
  retira el formulario, las opciones vuelven a bajar sin audio como antes.
* En Facebook están los **vídeos sueltos** (vía FSave: `watch`, `reel`,
  `videos`, `story.php`, `fb.watch`): las **páginas** no tienen listado
  (`/api/profile` → `501`), no hay transcripción, y el mint de FSave se pide en
  cada invocación con un cooldown del servicio (~10 s) si el payload se repite.
  El `fileUrl` final vive ≥10 min, pero se resuelve justo antes de descargar.
* En Instagram están las **publicaciones sueltas** (fuente primaria IGExport:
  `reel`, `reels`, `p`, con prefijo de usuario o query; si IGExport falla, el
  respaldo **LoveInsta** resuelve con un solo `POST /proxy.php`): los
  **perfiles** no tienen
  listado (`/api/profile` → `501`), no hay historias ni transcripción, y cada
  vídeo se ofrece en **una sola calidad** (el servicio no expone calidades
  múltiples; el respaldo sí etiqueta la resolución del job, `1080p`/`720p`).
  El MP4 del CDN va firmado y caduca en ~2 días, el título depende
  del oEmbed público de Instagram (best-effort con fallback al autor) y el
  servicio puede devolver `429/503` cuando Instagram limita su tasa
  (reintentable con backoff); LoveInsta entrega fotos con token firmado que
  conviene consumir al momento.
* En X (Twitter) están los **tweets sueltos** (vía iLoveX: `x.com` y
  `twitter.com`): los **perfiles** no tienen listado (`/api/profile` → `501`),
  los enlaces `t.co` no clasifican (`400`), no hay transcripción, y cada vídeo
  se ofrece en **una sola calidad** (el servicio no expone calidades múltiples;
  el trabajo de render se resuelve con `source=ilovex` en `/api/render`). Las
  fotos sólo se descargan si su host supera la allowlist, y los estados
  privados o eliminados devuelven un error claro (`UnavailableError`).
* En Threads están las **publicaciones sueltas** (vía SaveThreads: `threads.com`
  y `threads.net`): los **perfiles** no tienen listado (`/api/profile` →
  `501`), no hay transcripción, y cada vídeo se ofrece en **una sola calidad**
  (la máxima que entrega Threads, p. ej. 720p; el trabajo de render se resuelve
  con `source=savethreads` en `/api/render`). El carrusel se muestra elemento a
  elemento (vídeos y fotos); los tokens de las fotos y del `fileUrl` caducan
  (~2 h según la FAQ del servicio), así que se resuelven y consumen al momento.
* Se soportan **TikTok**, **YouTube**, **Facebook**, **Instagram**, **X
  (Twitter)** y **Threads**. La ruta `/transcript/*` existe en la
  navegación pero muestra «Próximamente»: no hay ninguna fuente comprobada
  de transcripciones y no se inventan endpoints.
* No hay base de datos, usuarios ni cuentas.
* No se puede comprobar que el archivo exista realmente: se confía en el
  historial, con el botón de borrarlo como escape.
* En la web, elegir la carpeta de destino sólo funciona en **Chromium**
  (Chrome/Edge/Opera). En Firefox y Safari los archivos van a Descargas, y la
  subcarpeta del perfil se crea sólo en Chrome/Edge.
* La carpeta elegida en la web **no se persiste** entre recargas de la página.
* Si un análisis de perfil es muy largo o dejas la pestaña abierta mucho rato,
  los enlaces temporales de `/api/profile` pueden caducar (~1 h) y las
  descargas fallarán: hay que volver a analizar.

---

## Roadmap

```text
1. HTTP + parser + descarga (núcleo lib/)   ✓
2. Interfaz web (Next.js + API)             ✓
3. Lote por perfil + reanudación            ✓
4. Paginación por cursor + historial        ✓
5. Destino por perfil + carpeta elegida     ✓
6. Portada + rutas /download/* y /transcript/*  ✓ (TikTok, YouTube, Facebook, Instagram, X y Threads activos)
7. Otras plataformas (FB ✓, IG ✓, X ✓, Threads ✓)             ·
   YouTube: vídeo suelto ✓ · calidades altas con audio ✓ · listas ✓
   Facebook: vídeo suelto ✓ (FSave) · faltan páginas y transcripción
    Instagram: publicación suelta ✓ (IGExport + respaldo LoveInsta) · faltan perfiles e historias
    X (Twitter): tweet suelto ✓ (iLoveX) · faltan perfiles y múltiples calidades
    Threads: publicación suelta ✓ (SaveThreads) · faltan perfiles y múltiples calidades
   faltan canales de YouTube y transcripción
8. Transcripción                            · (sin fuente comprobada)
9. Proveedor reutilizable en Laravel        ·
```

---

## Licencia / uso responsable

Proyecto de estudio técnico. Trabaja sólo con URLs públicas, respeta los
términos de las plataformas involucradas y no intenta evadir CAPTCHAs ni
controles de acceso.
