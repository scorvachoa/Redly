# Red.ly

Cliente TypeScript/Next.js de los servicios **TikVid/SavTikPro** (TikTok),
**SnapYT/YTMP3** (YouTube), **FSave** (Facebook), **IGExport/LoveInsta**
(Instagram), **iLoveX** (X) y **SaveThreads** (Threads): analiza una URL,
muestra las opciones de descarga, o lista un **perfil completo** de TikTok y
descarga en lote con historial y reanudación.

Aplicación web: interfaz en el navegador + API propia que hace de proxy.
**Bot de Telegram**: pega la misma URL en el chat y el bot devuelve el vídeo
en la mejor calidad (o las fotos) directamente.

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
| `/` | Portada: buscador general con resultados en la misma página, iconos de las redes soportadas |
| `/download/<plataforma>` | Descargador por plataforma (`tiktok`, `youtube`, `facebook`, `instagram`, `twitter`, `threads`; el resto, «Próximamente»). Acepta `?url=<enlace>`: rellena el campo y analiza solo |
| `/transcript/<plataforma>` | Transcripción (todas «Próximamente») |
| `/privacidad` · `/creditos` | Política de datos · créditos y licencias |

El registro de plataformas vive en `lib/platforms.ts`; una ruta desconocida
cae en el 404 propio. Sólo se implementan las plataformas con fuente
comprobada: no se inventan APIs.

Las rutas `/download/*` y `/transcript/*` siguen disponibles escribiendo la
URL a mano, pero ya **no se enlazan** desde la portada: todo empieza en el
buscador general.

**Buscador general** (`components/HomeDownloader.tsx`): un único campo para
todas las redes; mientras se escribe, `lib/urlrules.ts` clasifica la entrada y
se resalta el icono de la red detectada entre las que hay debajo. Al enviar,
el análisis ocurre **en la misma página** —compartiendo el motor
`useDownloaderEngine` con las páginas `/download/*`— y el resultado se pinta
debajo del buscador. Si la entrada no sirve, el motivo se cuenta ahí mismo en
la línea de estado.

**Estilo y PWA:** Tailwind CSS v4 (`@apply` sobre clases semánticas en
`app/globals.css`); tema claro/oscuro con `data-theme` en `<html>`. Web
instalable: manifiesto + service worker que cachea **sólo** `/_next/static/`
(el diálogo de instalación lo ofrece el propio navegador). El logotipo —llama
con flecha de descarga, de Icon-Icons.com— está en `app/icon.svg`; los
derivados se regeneran con `node scripts/make-favicon.cjs`.

**Descargas e historial:** cada perfil se guarda en su subcarpeta
(`@scout2015` → `scout2015/`). Con «Elegir carpeta» (`showDirectoryPicker`,
Chromium) se escribe en streaming; el resto va a Descargas del navegador. El
historial (`localStorage`, sólo estado y nombres — nunca URLs ni tokens —)
marca lo ya descargado, lo excluye del lote y permite reanudar.

---

## API

Seis rutas bajo `/api`, implementadas como Route Handlers de Next.js:

| Ruta | Método | Descripción |
| --- | --- | --- |
| `/api/search` | `POST { url }` | analiza **un vídeo**: título, ID, miniatura y opciones |
| `/api/profile` | `POST { url, max?, cursor?, page? }` | **una página** de perfil + `next_cursor` |
| `/api/merge` | `GET ?yt=&v=&a=` | combina vídeo+audio de YouTube en SnapYT |
| `/api/render` | `GET ?job=&source=` | resuelve un trabajo de render (FSave/LoveInsta/iLoveX/SaveThreads) |
| `/api/download` | `GET ?url=&name=` | proxy de streaming con `Content-Disposition: attachment` |
| `/api/telegram/webhook` | `POST` (update) | updates del bot de Telegram (secreto obligatorio) |

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

## Bot de Telegram

Un bot conectado por **webhook** repite el flujo de la web dentro de Telegram:
el usuario pega la URL de un vídeo suelto (o publicación con fotos) de
**cualquiera de las 6 redes** y el bot responde directamente con el archivo en
**mejor calidad posible**, sin preguntar por la calidad. Usa el mismo motor
(`classifyInput` → fuente → `batchOption(result, "max")`) y las mismas
funciones para resolver `/api/merge` y `/api/render`.

| Mensaje | Respuesta |
| --- | --- |
| `/start` · `/help` | Ayuda y límites |
| URL de vídeo | `sendVideo` con la mejor opción (en YouTube resuelve la combinación; si Telegram no baja la URL, se sube el archivo como respaldo) |
| URL con fotos | Álbum con todas las fotos (una sola → `sendPhoto`) |
| URL de perfil/lista | Aviso de que aún no está disponible en el bot (la web sí) |
| Cualquier otra cosa | Mensaje con las redes soportadas |

**Configuración** (`.env` / panel de Vercel; ver `.env.example`):

```text
TELEGRAM_BOT_TOKEN        # token de @BotFather; vacío = bot desactivado
TELEGRAM_WEBHOOK_SECRET   # secreto validado en la cabecera del webhook
TELEGRAM_ALLOWED_CHAT_IDS # ids numéricos con comas; vacío = nadie
TELEGRAM_BOT_PUBLIC       # true = abierto a cualquier chat (ignora la allowlist)
TELEGRAM_BOT_USERNAME     # username visible; si está, el pie enlaza al bot
```

**Registro del webhook** (una vez, tras desplegar):

```bash
npm run telegram:webhook -- https://red-ly.vercel.app   # getMe + setWebhook
npm run telegram:webhook -- https://red-ly.vercel.app --delete
```

Si falta el secreto, el script genera uno e imprime el valor para copiarlo a
Vercel. La ruta `/api/telegram/webhook` valida la cabecera
`X-Telegram-Bot-Api-Secret-Token` con comparación en tiempo constante y
siempre responde 200 cuando el secreto es correcto (Telegram reintenta si no;
el dedupe por `update_id` evita dobles envíos). El acceso es **privado por
allowlist**: los chats no autorizados no reciben respuesta; con
`TELEGRAM_BOT_PUBLIC=true` el bot se abre a cualquier chat (la allowlist se
ignora). Límite de tasa por chat (20/min por defecto) y tope de 50 MB por
archivo (Bot API).

---

## Arquitectura

```text
Redly/
├── app/
│   ├── page.tsx                # portada (servidor)
│   ├── download/[platform]/    # UI del descargador; resto: "Próximamente"
│   ├── transcript/[platform]/  # todas "Próximamente"
│   └── api/                    # search, profile, merge, render, download, telegram/webhook
├── public/                     # sw.js + iconos PWA
├── components/
│   ├── SiteHeader.tsx · SiteFooter.tsx · ThemeToggle.tsx
│   ├── HomeDownloader.tsx      # buscador general de la portada (analiza en línea)
│   ├── Downloader.tsx          # página /download/<plataforma>
│   ├── downloader/             # piezas presentacionales + useDownloaderEngine
│   └── icons.tsx               # SVG incrustados (FA6), sin react-icons
├── lib/                        # núcleo portable (sin next/*, apt navegador)
│   ├── platforms.ts · sources.ts · urlrules.ts · config.ts · models.ts
│   ├── http.ts · parser.ts · client.ts · savetik.ts · snapyt.ts · ytmp3.ts
│   ├── fsave.ts · igexport.ts · loveinsta.ts · ilovex.ts · savethreads.ts
│   ├── *-urls.ts · ratelimit.ts · cache.ts · history.ts · sanitize.ts
│   ├── download-stream.ts · fsaccess.ts · downloader.ts · site.ts
│   ├── telegram.ts · telegram-bot.ts   # cliente Bot API + lógica del bot
├── scripts/                    # api-smoke, extract-icons, make-favicon, telegram-set-webhook
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

`npm test`: **421 tests en 27 ficheros, sin Internet** (fetch mockeado y
fixtures HTML anonimizadas en `tests/fixtures/`): clasificación de URLs por
plataforma, contrato `ContentSource`, cada fuente (mint HMAC, render, errores
del servicio, reintentos), merge de YouTube, paginación de perfiles, límite de
tasa, caché, historial, cliente y lógica del bot de Telegram, y utilidades.

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
TELEGRAM_* (bot: token, secreto, allowlist, límites)
```

`ALLOWED_DOWNLOAD_HOSTS` **no** es variable de entorno: es la lista fija de
CDNs, dentro de `lib/config.ts`.

---

## Despliegue en Vercel

1. Importa el repositorio (framework detectado: Next.js).
2. Sin secretos ni claves: el proyecto trabaja con URLs públicas.
3. No hay FS persistente entre invocaciones: el historial vive en el
   navegador y el lote pagina `/api/profile` invocación a invocación.
4. **Bot de Telegram** (opcional): crea el bot con @BotFather, define
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` y
   `TELEGRAM_ALLOWED_CHAT_IDS` en el panel de Vercel y registra el webhook
   con `npm run telegram:webhook -- https://tu-app.vercel.app` (sección
   «Bot de Telegram»).

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
* **Bot de Telegram**: sólo vídeos y fotos sueltos (sin perfiles ni lotes);
  archivos hasta 50 MB (límite de la Bot API). El dedupe del webhook, el
  límite por chat y la allowlist viven en memoria **por instancia** de la
  función serverless, igual que el resto de estado del proyecto.

---

## Licencia / uso responsable

Proyecto de estudio técnico. Trabaja sólo con URLs públicas, respeta los
términos de las plataformas involucradas y no intenta evadir CAPTCHAs ni
controles de acceso.
