# Red.ly

Cliente TypeScript/Next.js del flujo HTTP de **TikVid** y **SavTikPro** para
URLs de TikTok: analiza un vídeo y muestra las opciones de descarga, o lista un
**perfil completo** y lo descarga en lote con manifiesto de reanudación.

Se sirve como aplicación web (interfaz en el navegador + API propia que hace de
proxy) y también como **CLI** con los mismos comandos que el PoC Python.

**Web desplegada:** <https://red-ly.vercel.app/>

> **No es una API oficial de TikVid ni de SavTikPro.** Los endpoints y el HTML
> no están documentados y pueden cambiar en cualquier momento. El proyecto
> trabaja únicamente con URLs públicas y peticiones HTTP normales, sin
> autenticación, sin cookies personales y sin medidas de evasión (ver
> `base.md` §25: no se saltan CAPTCHAs ni controles de acceso).

---

## Requisitos

* Node.js 18+ (probado en Node 24.11.1 / npm 11.14.1)
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
npm run cli -- --help
```

---

## Interfaz web

`npm run dev` y abrir `http://localhost:3000`.

### Rutas

| Ruta | Contenido |
| --- | --- |
| `/` | Portada: hero, plataformas, «Obtener programa» y pie |
| `/download/<plataforma>` | Descargador. Sólo `tiktok` funciona; el resto muestra «Próximamente» |
| `/transcript/<plataforma>` | Transcripción. Todas las plataformas muestran «Próximamente» |
| `/privacidad` | Política de datos: qué se guarda, qué no, y con qué terceros |
| `/creditos` | Créditos: tecnologías, iconos y licencias, despliegue y origen del proyecto |
| `/manifest.webmanifest` | manifiesto de la PWA (desde `app/manifest.ts`) |
| `/sw.js` | service worker (desde `public/sw.js`) |
| `/icon.svg`, `/favicon.ico`, `/apple-icon.png`, `/icons/*` | favicon e iconos de instalación |

Plataformas: `tiktok`, `youtube`, `facebook`, `instagram`, `twitter`, `threads`
(el registro vive en `lib/platforms.ts`). Una ruta desconocida cae en el 404
propio, que lista las plataformas disponibles.

> **Sólo TikTok está implementado.** Las demás existen en la estructura de
> navegación, pero no se les asigna ningún endpoint: `base.md` §2 prohíbe
> inventar APIs, y no hay ninguna fuente comprobada para ellas. La página
> «Próximamente» lo explica en lugar de mostrar un botón que no podría
> funcionar. Con la transcripción pasa lo mismo en **todas** las plataformas.

### Estilo

El CSS está en `app/globals.css` con **Tailwind CSS v4**: un `@import "tailwindcss"`
más `@apply` sobre las clases semánticas existentes (`.hero`, `.platform-card`…),
de modo que el JSX mantiene nombres legibles y no una pila de utilidades.
`postcss.config.mjs` carga el plugin `@tailwindcss/postcss`; no hay `tailwind.config.js`.

El tema claro/oscuro sigue funcionando con `data-theme` en `<html>` (lo escribe el
script del `layout.tsx` antes del primer pintado) y **no** con la clase `.dark`. Los
tokens de color se declaran en `:root` / `[data-theme="dark"]` y `@theme inline` los
expone a Tailwind resolviendo en runtime, así que `bg-surface`, `text-ink` o
`border-line` cambian al alternar el tema sin duplicar clases.

Los iconos de `components/icons.tsx` son **SVG incrustados** (paths de Font Awesome 6,
licencia CC BY 4.0) en lugar de `react-icons`: su barril de exports activa el
`optimizePackageImports` de Next, que a veces referencia un chunk de proveedor
(`vendor-chunks/react-icons`) que no llega a emitirse y la página caía con
`Cannot find module`. Para regenerarlos: `node scripts/extract-icons.cjs`.

### Iconos (favicon)

El favicon es una **llama** con el degradado de la marca. La fuente de verdad es
`app/icon.svg` (viewBox `0 0 64 64`, dos `<path>` de relleno: llama exterior y
llama interior). Next.js la emite sola como `<link rel="icon" type="image/svg+xml">`.

Los ficheros derivados viven junto a ella y los genera el mismo script:

| Fichero | Uso | Cómo se obtiene |
| --- | --- | --- |
| `app/icon.svg` | pestañas que entienden SVG | escrito a mano |
| `app/favicon.ico` | pestañas antiguas (contenedor con PNGs de 16/32/48) | `make-favicon.cjs` |
| `app/apple-icon.png` | iOS, 180×180 **opaco** (iOS ignora el alfa) | `make-favicon.cjs` |

Para regenerar los derivados tras tocar el SVG:

```sh
node scripts/make-favicon.cjs
```

El script usa `sharp`, que Next.js ya trae como dependencia transitiva (**no**
está declarado en `package.json` y no hace falta añadirlo). No hay que
declarar `metadata.icons` en `layout.tsx`: la convención de ficheros de Next
los descubre y añade los `<link>` con un hash de caché en el `href`.

Al editar la forma, dos errores fáciles: una punta suave se lee como gota de
agua, no como fuego, y un control que se cruza sobre el vértice deja un
triángulo hueco encima de la punta. La punta debe ser un corte limpio: el
primer control del primer segmento baja hacia la izquierda y el último del
último baja hacia la derecha, sin llegar a cruzarse.

### PWA (instalación)

La web es instalable. En Android y en Chromium de escritorio muestra el botón
**Instalar aplicación**; en iOS no existe ese botón y se añade desde el menú
**Compartir → Añadir a pantalla de inicio**. Abierta así, ocupa su propia
ventana (`display: standalone`) sin barra de navegador.

| Pieza | Rol |
| --- | --- |
| `app/manifest.ts` | manifiesto → `/manifest.webmanifest`: nombre, `start_url`, `display`, iconos |
| `public/sw.js` | service worker mínimo: cachea sólo `/_next/static/` |
| `components/ServiceWorker.tsx` | lo registra en el cliente, y sólo en producción |
| `components/InstallApp.tsx` | botón de instalación e instrucciones de iOS |

`InstallApp` resuelve tres casos distintos: `beforeinstallprompt` (Chromium),
instrucciones para iOS (que no implementa ese evento) y detección de «ya
instalada» mediante `display-mode: standalone` y `navigator.standalone`. La
tarjeta vive en la sección **Obtener programa** de la portada.

Los iconos de instalación —`public/icons/icon-192.png`, `icon-512.png` y
`maskable-512.png`— también los genera `scripts/make-favicon.cjs`. El
`maskable` escala la llama al 66 % del lienzo: Android recorta el icono en un
círculo del 80 % y dentro de esa zona segura no debe haber nada cortado.

Dos decisiones que conviene no cambiar sin motivo:

* **El service worker no cachea HTML ni `/api/*`.** Sólo los assets con hash
  de `/_next/static/`, que son inmutables. Cachear una página o una respuesta
  de API expone al usuario a contenido caducado —o peor, a un token de
  descarga vencido— en un archivo de sesión que nadie vigila.
* **`theme_color` está declarado dos veces**: en `app/manifest.ts` y en el
  `viewport` de `app/layout.tsx`. Si cambia uno, debe cambiar el otro.

En desarrollo el worker no se registra (`NODE_ENV !== "production"`): los
rebuilds en caliente de `next dev` dejan el bundle que cachearía obsoleto y
habría que recargar con las dev tools abiertas para ver los cambios.

### Navegación y pie

La cabecera (`components/SiteHeader.tsx`) lleva tres entradas: **Descargar** y
**Transcribir**, cada una con un desplegable «Redes sociales», y **Obtener
programa**, que salta a la sección homónima de la portada.

Cada elemento del desplegable lleva el icono de la plataforma sobre su color de
marca, el nombre, y el estado: píldora «Disponible» en la única fuente
comprobada (TikTok) y «Próximamente» en atenuado para el resto. Transcribir
usa `transcriptReady`, que hoy es `false` en todas. Los desplegables se abren
con `:hover` y `:focus-within`, sin JavaScript ni client components; en móvil la
navegación pasa a una segunda fila. El nombre de la marca no lleva etiqueta
lateral.

Hay dos detalles fáciles de romper. El menú lleva un puente invisible
(`.nav__menu::before`, 12px hacia arriba) que cubre su `mt-2`: sin él, al bajar
el ratón desde el disparador se cruza un hueco sin nada debajo, `:hover` se
pierde un instante y el menú se cierra antes de llegar a los enlaces. Y el menú
**no** anima `translateY`, sólo la opacidad: un desplazamiento movería también
el puente y dejaría 4px sin cubrir durante la animación.

La marca y el botón de tema no van pegados al borde de la ventana: el contenido
de la cabecera vive en `.header__inner`, que replica el ancho y el padding de
`.main`, de modo que la marca cae siempre sobre el mismo eje vertical que el
texto. El pie (`components/SiteFooter.tsx`) sigue la misma regla, y es común a
la portada, el descargador, «Próximamente», el 404 y `/privacidad`.

### Ancho

Todas las páginas comparten **1080px** de ancho: `.main`, `.header__inner`,
`.site-footer__inner` y `.site-footer__legal` usan el mismo `max-width` y el
mismo `padding-inline`, así que la portada, el descargador, «Próximamente», el
404 y `/privacidad` se alinean sin excepción.

Al ensanchar, el texto corrido se estiraría hasta ~1030px, así que los
párrafos y las listas de `/privacidad` (`.doc p`, `.doc li`, `.doc__lead`) se
limitan a `72ch`. Las tarjetas y los formularios sí ocupan el ancho completo.
Los títulos no se limitan.

El botón de GitHub apunta a `REPO_URL` (`lib/site.ts`). Está **vacío a
propósito**: el proyecto todavía no es un repositorio publicado y no se
inventan URLs. Cuando exista, basta con rellenarlo y el enlace aparece solo en
la portada y en el pie.

### Descargador de TikTok

* Pega una URL de TikTok. Si es de **vídeo**, se analiza sola y muestra título,
  miniatura e opciones; si es de **perfil** (`@usuario` o `/@usuario`), pagina
  el listado hasta reunir los vídeos **pendientes** y activa el botón
  **Descargar N vídeos**.
* Cada descarga usa `/api/download` en streaming con barra de progreso; el
  archivo se guarda en el navegador con nombre saneado, en la carpeta que
  elijas (Chromium) o en Descargas.
* El lote se ejecuta **secuencialmente** en el cliente (una petición a la vez,
  pausa de 700 ms entre vídeos) para no saturar el origen.
* El **historial** (`localStorage`) marca los ya bajados con el badge
  «Ya descargado» y los excluye del lote; hay botón para borrarlo.
* Tema claro/oscuro (botón con icono SVG), compartido entre todas las rutas.
  Acento de marca `#fe2c55`.

#### Estructura del descargador

`Downloader.tsx` es el **orquestador**: mantiene el estado del flujo
(URL → análisis → resultado) y coordina piezas extraídas a medida que creció
(pasó de un único componente de 850 líneas a varias unidades):

| Pieza | Responsabilidad |
| --- | --- |
| `downloader/useDestination.ts` | selector de carpeta de Chromium y fábrica de destinos |
| `downloader/useDownloadHistory.ts` | historial reactivo sobre `lib/history.ts` |
| `downloader/VideoPanel.tsx` | resultado de un vídeo suelto (sin estado propio) |
| `downloader/ProfilePanel.tsx` | resultado de un perfil (sin estado propio) |
| `downloader/ProgressBar.tsx` | barra de progreso, con variante indeterminada |
| `lib/download-stream.ts` | `downloadWithProgress`, `formatBytes`, `isProfileLike` (sin React) |

La regla que sostiene el reparto: los paneles son **presentacionales** (reciben
props y devuelven JSX) y las utilidades viven en `lib/` sin importar React, de
modo que se testean sin montar un componente y se reutilizan si aparece una
segunda UI.

---

## API

Tres rutas bajo `/api`, implementadas como Route Handlers de Next.js:

| Ruta | Método | Body / Query | Descripción |
| --- | --- | --- | --- |
| `/api/search` | `POST` | `{ url }` | Analiza **un vídeo**: título, ID, miniatura y opciones |
| `/api/profile` | `POST` | `{ url, max?, cursor?, page? }` | Devuelve **una página** de un perfil y el `next_cursor` |
| `/api/download` | `GET` | `?url=&name=` | hace de proxy de streaming con `Content-Disposition: attachment` |

### Paginación de perfiles

`/api/profile` devuelve **una sola página** por invocación, no el perfil entero:

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

El cliente pagina invocación a invocación reenviando `cursor` y `page`:

* `cursor` ausente o vacío → primera página (`"0"`).
* `next_cursor: null` → no hay más páginas.
* `max` es el tope **por invocación** (recortado a `API_PROFILE_MAX`); una
  página rara vez lo alcanza, así que sirve de red de seguridad.

Al paginar fuera de la función, cada llamada se mantiene corta y no se choca
con `maxDuration: 60` de Vercel. En la web, el bucle de paginación se detiene
cuando tiene los pendientes pedidos, se agota el cursor o llega al tope de
páginas del análisis.

Ejemplos:

```bash
curl -X POST localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@usuario/video/123"}'

curl -X POST localhost:3000/api/profile \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@usuario","max":10}'

curl -L -o video.mp4 "localhost:3000/api/download?url=<enlace>&name=v.mp4"
```

Validaciones (devuelven `400` con `{ ok:false, error }`):

* URL que no es de TikTok.
* `/api/search` recibe una URL de perfil, o `/api/profile` recibe una de vídeo.
* `max` por encima de `API_PROFILE_MAX` (límite del servidor, por defecto 100).
* `/api/download` con un host distinto de la lista blanca.

### Anti proxy abierto

`/api/download` sólo acepta hosts configurados en `ALLOWED_DOWNLOAD_HOSTS`
(`lib/config.ts`). Si no, responde `400`: el endpoint no puede usarse como
proxy hacia cualquier destino.

### Límite de tasa

Las tres rutas comparten un único límite (`lib/ratelimit.ts`), en memoria y por
ventana deslizante. Por defecto **30 peticiones por 60 segundos** por cliente,
configurable con `RATE_LIMIT_MAX` y `RATE_LIMIT_WINDOW_SECONDS`.

La clave del cliente sale de `x-forwarded-for` (la primera IP), o de
`x-real-ip`, o `unknown` en local. Si la primera IP de la lista está vacía se
trata como `unknown` en lugar de fiarse de las siguientes: si no, quien controla
la cabecera podría culpar con `X-Forwarded-For: , <ip-de-otro>` y agotarle la
cuota a un tercero.

Al superarlo la respuesta es `429` con cabecera `Retry-After` y cuerpo
`{ ok:false, error, retry_after }`.

**Límite honesto**: en serverless esto es **por instancia de la función**, no
global. Con N instancias frías el tope real puede ser N veces mayor. Sigue
siendo útil —frena el abuso desde un mismo cliente— pero no es un techo
absoluto. Si llega el momento de necesitar uno, sólo hay que sustituir la clase
`RateLimiter` por otra implementación de la misma interfaz: las rutas no se
enteran.

### Caché de páginas de perfil

`/api/profile` cachea en memoria el resultado de cada página durante
**60 segundos** (`PROFILE_CACHE_TTL_MS`), con techo de 200 entradas y LRU
(`lib/cache.ts`). La clave es `url|cursor|page`, así que dos personas abriendo
el mismo perfil sólo generan una petición al origen.

El TTL es deliberadamente corto: cada tarjeta trae la URL de descarga, que es
un token JWT de SnapCDN con vida de ~1 hora. Cachear más tiempo que eso
significaría servir enlaces muertos; con 60 s se aprovecha el repetido sin
arriesgar nada. La respuesta incluye `"cached": true` cuando sale de la caché.

Igual que el límite, la caché es **de memoria de proceso**: cada instancia de la
función tiene la suya. No pretende ser una caché compartida, sólo evitar
repeticiones inmediatas.

### Fuentes de contenido

Las rutas no instancian `SavetikSource` a pelo: resuelven la fuente por el host
de la URL a través de `lib/sources.ts`, que expone un contrato (`ContentSource`)
y un registro.

```ts
interface ContentSource {
  readonly id: string;
  readonly platforms: readonly string[];
  searchVideo(url: string): Promise<TikTokResult>;
  listProfilePage(url, cursor?, page?, limit?): Promise<ProfilePage>;
}
```

Hoy sólo está registrada la fuente verificada de TikTok. Añadir otra plataforma
significa implementar el contrato y añadirla al registro, sin tocar las rutas ni
el CLI. Las plataformas sin fuente reciben `501`, no un intento de adivinar.

El motivo es que `savetikpro.com` es un tercero sin API documentada
(`base.md` §2/§36): si un día deja de funcionar o hay que cambiar de proveedor,
el cambio se confina en un módulo.

### CORS y despliegue en Vercel

El navegador habla **sólo con la API de Red.ly**, que a su vez habla con
TikVid/SavTikPro. Así no hay CORS contra terceros y el flujo de cabeceras de
navegador queda centralizado en `lib/config.ts`.

`vercel.json` fija `maxDuration: 60` para `app/api/**`. El lote **no** corre en
el servidor (sin FS persistente entre invocaciones): la cola vive en el
navegador.

---

## CLI

Mismos comandos que el PoC Python:

```bash
npm run cli -- --url "https://www.tiktok.com/@usuario/video/123" --option 2
npm run cli -- --profile "@usuario" --max 10
npm run cli -- --profile "@usuario" --list-only
npm run cli -- --batch lista.txt --delay 2 --yes
npm run cli -- --no-download --debug
```

| Opción | Descripción |
| --- | --- |
| `--url` | URL de TikTok: vídeo (interactivo) o perfil (lote). Si no se indica, se pide por teclado |
| `--profile` | URL de perfil o `@usuario`: lista y descarga en lote |
| `--batch` | Fichero con una URL de TikTok (vídeo o perfil) por línea (`#` comentarios) |
| `--max` | Máximo de vídeos del lote (0 = sin límite) |
| `--delay` | Pausa en segundos entre vídeos (por defecto `1.0`) |
| `--list-only` | Sólo lista los vídeos, no descarga nada |
| `-y` / `--yes` | No pide confirmación antes del lote |
| `--no-resume` | Vuelve a descargar lo ya marcado como completado |
| `--option` | Índice de la opción de descarga (1-based), en modo vídeo |
| `--output-dir` | Carpeta **raíz** de destino (por defecto `downloads/`); cada perfil crea su subcarpeta |
| `--no-download` | Resuelve la URL temporal pero no descarga, en modo vídeo |
| `--debug` | Muestra endpoint, statuses, nº de opciones y dominio final |

En `--debug` **nunca** se muestran tokens, cookies ni URLs firmadas completas:
los parámetros sensibles se enmascaran.

### Descarga en masa (perfil)

```bash
npm run cli -- --profile "@usuario" --max 20 --yes
```

```text
Listando perfil... https://www.tiktok.com/@usuario
  · destino: downloads/usuario
  · página 1: 11 vídeos

Vídeos del perfil (11)
  1  7694475743509646622  Why did Stella...  2K  usuario/
...

1/11 Why did Stella do THAT? #pool #fail
      ✓ Redly_7694475743509646622.mp4 (9,858,537 bytes)

✓ Lote terminado · 11 descargado(s) · 0 omitido(s) · 0 fallo(s)
Manifiesto: downloads/manifest.json
```

Cómo funciona:

* **Fuente del listado**: `POST https://savetikpro.com/api/ajaxSearch` con la
  URL del perfil, `cursor` y `page`. Devuelve HTML con tarjetas (título, canal,
  vistas, miniatura y un enlace de descarga directo) y un `next_cursor` para la
  página siguiente. Misma familia de producto que TikVid. Sin API documentada.
* **Orden estrictamente secuencial**: un vídeo a la vez, con pausa
  (`--delay`) entre peticiones. Nunca descarga en paralelo.
* **Reanudación**: `downloads/manifest.json` guarda, por ID de vídeo, estado
  (`ok`/`error`), nombre de archivo y bytes — **nunca URLs ni tokens**, que
  caducan en ~1 hora. Se consulta **antes de listar**, así que los completados
  ni siquiera entran en la cola y los fallidos se reintentan con tokens frescos.
  Escritura atómica (`.tmp` + rename). El manifiesto vive en la **raíz** y es
  **compartido entre perfiles** (los IDs de vídeo son únicos globalmente). Ver
  «Historial de descargas».
* **Ficheros de lote**: cada línea puede ser un perfil (se expande) o un vídeo
  suelto (se analiza y se elige el mejor MP4). Los vídeos sueltos van a la raíz,
  porque la URL de un vídeo no lleva el autor.
* En modo vídeo suelto, la búsqueda intenta primero SavTikPro y cae a TikVid
  automáticamente (`searchAny`).

---

## Destino de las descargas

Cada perfil se guarda en **su propia subcarpeta**, con el nombre del perfil
saneado (`@scout2015` → `scout2015/`). `--output-dir` sigue siendo la raíz:

```text
downloads/
  manifest.json          ← compartido entre perfiles
  scout2015/
    Redly_7694475743509646622.mp4
  otroperfil/
    Redly_9999000000000000001.mp4
```

### En la web

El navegador no permite elegir destino salvo con la **File System Access API**,
así que hay dos caminos:

| Modo | Cómo se guarda | Navegadores |
| --- | --- | --- |
| **Elegir carpeta** (botón) | `showDirectoryPicker()` y escritura directa con `createWritable()`, **en streaming** (sin buffer en RAM). Crea la subcarpeta del perfil dentro de la elegida | Chrome, Edge, Opera |
| **Descargas del navegador** (por defecto) | `a[download]` con nombre `perfil/archivo.mp4`: Chrome y Edge crean la subcarpeta; Firefox y Safari la ignoran y dejan el archivo plano | Todos |

* `showDirectoryPicker` exige **contexto seguro** (HTTPS o `localhost`).
* La carpeta elegida vive **sólo en memoria de la sesión**: al recargar hay que
  volver a elegirla (los `FileSystemDirectoryHandle` no se serializan).
* Al escribir con el picker **no aparece el diálogo «Guardar como»**, por eso la
  fila de destino se muestra siempre en la interfaz.
* Si el permiso se revoca (`NotAllowedError`) se limpia la selección y se pide
  elegir la carpeta de nuevo.

La lógica vive en `lib/fsaccess.ts` (apt navegador, sin imports de `node:*`).

---

## Historial de descargas

Evita repetir vídeos ya bajados. Guarda **sólo** estado, nombre de archivo,
bytes y título — **nunca URLs ni tokens**, que caducan en ~1 hora.

| Superficie | Dónde se guarda | Clave |
| --- | --- | --- |
| **Web** | `localStorage` del navegador | `redly-history-v1` |
| **CLI** | `<output-dir>/manifest.json` | id del vídeo |

Los dos historiales son **independientes**: Vercel no tiene sistema de archivos
persistente entre invocaciones, así que no se pueden sincronizar sin base de
datos.

### En la web

* El análisis de un perfil pagina hasta reunir los **pendientes** que pidas
  (por defecto 100); los ya descargados aparecen con el badge **"Ya descargado"**,
  atenuados y con la casilla desmarcada.
* Contador `Pendientes · Ya descargados · Páginas`.
* El lote sólo baja las casillas marcadas, y cada vídeo se marca al terminar:
  si el navegador se cierra a mitad, lo ya bajado no se repite.
* Botón **"Borrar historial"** con el total de vídeos registrados.
* En modo privado (sin `localStorage`) la app sigue funcionando pero avisa de
  que cada análisis empezará de cero.

### En la CLI

* `collectTargets` consulta el manifiesto **antes** de listar: la tabla, la
  confirmación `¿Continuar? [s/N]` y `--max` cuentan sólo pendientes.
* `--max 20` significa 20 **nuevos**; si ya tenías 5, se omiten y se buscan 15
  más paginando con `listProfilePending`.
* `--no-resume` ignora el historial y vuelve a bajarlo todo.
* Si todo estaba descargado, el comando lo dice y termina con código 0.

`Manifest.isDone()` comprueba además que el archivo exista y no esté vacío; en
la web no hay forma de verificarlo, así que se confía en el historial.

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
│   ├── download/[platform]/    # /download/tiktok (UI completa) | resto: "Próximamente"
│   ├── transcript/[platform]/  # /transcript/* → todas "Próximamente"
│   └── api/
│       ├── _responses.ts       # errorResponse() compartido (archivo privado)
│       ├── search/route.ts     # POST: analiza un vídeo
│       ├── profile/route.ts    # POST: una página de perfil + next_cursor
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
│   ├── Downloader.tsx          # orquestador de la UI de TikTok (estado del flujo)
│   ├── downloader/             # piezas del descargador, extraídas de Downloader
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
│   ├── models.ts               # TikTokResult, ProfileVideo, optionLabel, summarize
│   ├── platforms.ts            # registro de plataformas (fuente única de rutas)
│   ├── sources.ts              # contrato ContentSource + registro de fuentes
│   ├── site.ts                 # constantes de UI (REPO_URL, anclas de sección)
│   ├── ratelimit.ts            # límite de tasa por cliente (ventana deslizante)
│   ├── cache.ts                # TtlCache con LRU + caché de páginas de perfil
│   ├── download-stream.ts      # descarga con progreso en el navegador (sin React)
│   ├── sanitize.ts             # nombres de archivo/carpeta (apt navegador)
│   ├── urls.ts                 # validación, normalización y handle de perfil
│   ├── http.ts                 # fetch con timeouts, reintentos y backoff
│   ├── parser.ts               # HTML -> TikTokResult (cheerio, selectores con fallback)
│   ├── client.ts               # TikVidClient: POST /api/ajaxSearch
│   ├── savetik.ts              # SavTikPro: página única, perfiles, 1 vídeo, searchAny
│   ├── history.ts              # historial de descargas (storage inyectable)
│   ├── fsaccess.ts             # sinks de escritura + selector de carpeta (web)
│   ├── downloader.ts           # resolveUrl (redirects), sanitizeFilename, streaming
│   └── batch.ts                # runBatch secuencial + subdirFor + Manifest atómico
│
├── src/cli.ts                  # CLI (commander + picocolors)
├── scripts/api-smoke.ts        # handlers reales contra la red
├── scripts/extract-icons.cjs   # regenera components/icons.tsx
├── scripts/make-favicon.cjs    # regenera favicon.ico, apple-icon.png e iconos PWA (usa sharp)
├── postcss.config.mjs          # plugin @tailwindcss/postcss
├── tests/                      # vitest, sin red (+ fixtures/*.html)
├── vercel.json                 # framework nextjs, maxDuration 60
├── vitest.config.ts            # alias @/ + env en cero para reintentos/pausas
└── .env.example
```

Responsabilidades separadas: `lib/http.ts` no parsea HTML, `lib/parser.ts` no
hace peticiones, `lib/savetik.ts` sólo lista y resuelve, `lib/batch.ts` sólo
orquesta el orden, las subcarpetas y el manifiesto, `lib/downloader.ts` no
conoce el flujo de búsqueda y `lib/history.ts` sólo guarda estado (sin tocar
red ni disco). Los Route Handlers y el CLI son delgados: sólo orquestan `lib/`.

`lib/` no importa nada de `next/`, de modo que la CLI y los tests lo usan tal
cual. Además, `lib/sanitize.ts`, `lib/urls.ts`, `lib/models.ts`, `lib/history.ts`
y `lib/fsaccess.ts` **tampoco importan `node:*`**, así que el navegador los
usa directamente (es lo que permite el destino de descargas y el historial web).

---

## Flujo HTTP

1. Validación de la URL (debe ser `tiktok.com` o un subdominio) — `lib/urls.ts`.
2. Petición (headers centralizados en `lib/config.ts`):

```http
POST https://tikvid.io/api/ajaxSearch
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
Accept: application/json, text/javascript, */*; q=0.01
```

3. Payload: `q=<URL_TIKTOK>&lang=en`
4. Respuesta: `{ "status": "ok", "data": "<HTML>" }`
5. `data` pasa a `parseSearchHtml()` (cheerio).

Sin las cabeceras de navegador, Cloudflare responde `403` con "Just a moment...".
No se copian cookies ni tokens del navegador.

**Perfil (SavTikPro)**: `POST https://savetikpro.com/api/ajaxSearch` con
`q`, `cursor`, `page` y `lang`. `cursor=""` devuelve `404`, y una `q` con
barra final también: se normaliza antes de enviar.

### Reintentos y timeouts

* `REQUEST_TIMEOUT = 30`, `DOWNLOAD_TIMEOUT = 120` (configurables por `.env`).
* `RETRY_ATTEMPTS = 3` con backoff exponencial breve, sólo ante errores
  transitorios: timeouts, fallos de conexión y `429/500/502/503/504`.

---

## Parsing

No depende de una estructura exacta: para cada dato se prueba una lista de
selectores priorizados y, si ninguno funciona, se devuelve `None` sin romper la
ejecución:

* **Título**: `div.thumbnail h3` → `div.content h3` → `h3` → `h1` → `[class*=title]`
* **Thumbnail**: `div.thumbnail img` → `div.image-tik img` → `video[poster]` → primer `img`
* **Video ID**: `input#TikTokId` → enlaces `tiktok.com/@user/video/<id>` → atributos `data-*`
* **Opciones**: `a.tik-button-dl` → `.dl-action a[href]` → enlaces con hosts de CDN

Se excluyen enlaces de navegación y se deduplican las URLs repetidas.

| Botón | `format` | `quality` |
| --- | --- | --- |
| `Download MP4` | `mp4` | `standard` |
| `Download MP4 HD` | `mp4` | `hd` |
| `Download MP3` | `mp3` | `audio` |

---

## SnapCDN y URLs temporales

Algunas opciones apuntan a `https://pro.snapcdn.app/dl?token=...` (JWT, caduca
en ~1 hora) y otras son URLs directas del CDN (`v16m.tiktokcdn-us.com`, ...).
`resolveUrl()` sigue las redirecciones manualmente (hasta `MAX_REDIRECTS`).

Estas URLs están **firmadas y son temporales**. El proyecto:

* no las guarda en base de datos,
* no las escribe en archivos permanentes,
* no las registra completas en logs (se enmascaran),
* no las versiona en Git,
* sólo las usa durante la ejecución.

El manifiesto del lote guarda únicamente `state`, `updated`, `file`, `bytes` y
`title`.

---

## Descarga

`downloadToFile()` escribe por chunks en streaming; si la respuesta falla o
queda un archivo parcial, éste se elimina. En la web, `/api/download` hace lo
mismo pero devuelve el stream al navegador.

Los nombres se sanean localmente (`Redly_<id>.<ext>`): se eliminan caracteres
inválidos, `..`, `/`, `\` y se respetan los nombres reservados de Windows.

---

## Tests

```bash
npm test
```

145 tests, **sin Internet**:

* `tests/platforms.test.ts`: registro de plataformas (sólo TikTok disponible, ninguna con transcripción, slugs únicos), `getPlatform` e `isReady`.
* `tests/sources.test.ts`: contrato `ContentSource`, detección de plataforma por host (subdominios, host que sólo termina igual) y que las plataformas sin fuente devuelven `null`.
* `tests/urls.test.ts`: validación y normalización de URLs (vídeo, perfil, subdominios, `@usuario`, barra final) y `profileHandle`/`profileFolderName` (destino por perfil).
* `tests/sanitize.test.ts`: `sanitizeFilename` (traversal, reservados de Windows, truncado con extensión) y `sanitizeFolderName` (carpetas).
* `tests/parser.test.ts`: título, thumbnail, video ID, MP4/HD/MP3, elementos ausentes, HTML incompleto, deduplicación.
* `tests/savetik.test.ts`: clasificación de URLs, tarjetas de perfil, página única (`listProfilePage`), paginación (`cursor`/`page`), `listProfilePending` (salta los ya descargados), deduplicación, `404` con `cursor=""`, detalle de vídeo, `searchAny` (mock de `fetch` global) y **selectores con fallback** (clases internas renombradas, enlace sin `.pro-dl-link`, tarjeta sin enlace).
* `tests/ratelimit.test.ts`: ventana deslizante, aislamiento por clave, liberación al avanzar el tiempo, purga de claves muertas y extracción de IP del cliente.
* `tests/cache.test.ts`: TTL, techo LRU, contadores de aciertos y la clave de caché de páginas de perfil.
* `tests/download-stream.test.ts`: `formatBytes`, `isProfileLike` y `progressLabel`.
* `tests/history.test.ts`: `mark`/`isDone`/`clear`, persistencia entre instancias, que **no** guarda URLs ni tokens, storage nulo y storage que lanza al escribir.
* `tests/batch.test.ts`: descarga secuencial, manifiesto sin URLs/tokens, escritura atómica, reanudación, reintentos de fallos, orden, callbacks, `itemOutputPath`, `joinOutputDir` y `subdirFor` (manifiesto compartido en la raíz) (mock de `lib/downloader`).

Los fixtures `tests/fixtures/*.html` son copias anonimizadas del HTML real
(tokens sustituidos por valores ficticios), compartidos con el PoC Python.

Smoke de red (opcional, **sí** necesita Internet):

```bash
npm run smoke   # invoca los handlers de /api/* con Request reales
```

Cubre además la paginación real: pide la página 1 de un perfil, sigue el
`next_cursor` y comprueba que la página 2 no se solapa con la primera.

---

## Configuración

Todo lo configurable vive en `lib/config.ts` (se lee de `.env`/variables de
entorno, sin sobreescribir valores ya definidos):

```text
SAVETIK_BASE_URL / SAVETIK_AJAX_SEARCH_URL / SAVETIK_HOME_PATH / SAVETIK_LANG
TIKVID_BASE_URL / TIKVID_AJAX_SEARCH_URL
REQUEST_TIMEOUT / DOWNLOAD_TIMEOUT / MAX_REDIRECTS
RETRY_ATTEMPTS / RETRY_BACKOFF_SECONDS
BATCH_DELAY_SECONDS / BATCH_PAGE_DELAY_SECONDS / BATCH_MAX_PAGES
DOWNLOAD_DIRECTORY / MANIFEST_PATH
API_PROFILE_MAX              # tope de vídeos POR INVOCACIÓN (no por perfil)
ALLOWED_DOWNLOAD_HOSTS    # lista blanca del proxy /api/download
RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS   # límite de tasa de /api/*
PROFILE_CACHE_TTL_MS      # TTL de la caché de páginas de perfil
```

`RATE_LIMIT_*` y `PROFILE_CACHE_TTL_MS` se leen directamente en
`lib/ratelimit.ts` y `lib/cache.ts` (no pasan por `lib/config.ts`) para que
cada módulo sea autosuficiente; el efecto es el mismo.

Copia `.env.example` a `.env.local` para sobreescribir valores.

---

## Despliegue en Vercel

Proyecto desplegado y funcionando en **<https://red-ly.vercel.app/>**.

1. Importa el repositorio en Vercel (framework detectado: Next.js).
2. No se requieren secretos ni claves: el proyecto trabaja con URLs públicas.
3. `vercel.json` ya fija `maxDuration: 60` para `app/api/**`.

Notas:

* **No hay FS persistente entre invocaciones de función**: el manifiesto de la
  CLI vive en disco (`downloads/manifest.json`, sólo existe donde la ejecutas) y
  el de la web en `localStorage`. Son independientes entre sí.
* El lote de la web corre en el cliente y pagina el perfil invocación a
  invocación (`/api/profile` + `cursor`), por lo que cada llamada es corta.
* Si el origen bloquea el despliegue, revisa `ALLOWED_DOWNLOAD_HOSTS` y los
  endpoints en `lib/config.ts`.

---

## Descubrimientos documentados (no implementados)

El HTML de TikVid contiene un bloque JavaScript con estas variables:

```javascript
k_exp = "...";
k_token = "...";
k_url_convert = "https://s1.tik-cdn.com/api/json/convert";
```

**No se usa ese endpoint.** Antes de convertirlo en un módulo hay que verificar
en DevTools si realmente se llama, con qué método, payload y respuesta
(`base.md` §36).

---

## Limitaciones

* TikVid y SavTikPro no ofrecen APIs públicas documentadas: los endpoints, el
  HTML, las clases CSS y SnapCDN pueden cambiar sin aviso.
* El acceso puede estar protegido por Cloudflare; una respuesta HTML en lugar
  de JSON se reporta como error claro.
* Las URLs temporales expiran (`403/404/410`). En el lote, un token caducado
  marca el vídeo como fallo y la siguiente ejecución lo reintenta con uno fresco.
* El listado de perfil depende de SavTikPro: si cambia el `next_cursor` o las
  clases de las tarjetas, habrá que ajustar `lib/savetik.ts`.
* El scraping directo de `tiktok.com/@usuario` **no está implementado** (WAF).
* Sólo se soporta **TikTok**. Las rutas `/download/{youtube,facebook,…}` y
  `/transcript/*` existen en la navegación pero muestran «Próximamente»: no hay
  ninguna fuente comprobada para ellas y no se inventan endpoints (`base.md` §2).
* No hay base de datos, usuarios ni cuentas.
* Los historiales de la **web** (`localStorage`) y de la **CLI** (disco) son
  independientes: no se sincronizan entre sí.
* En la web no se puede comprobar que el archivo exista realmente (la CLI hace
  `stat`); se confía en el historial, con el botón de borrarlo como escape.
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
3. CLI con paridad con la Python             ✓
4. Lote por perfil + reanudación            ✓ (CLI)
5. Paginación por cursor + historial web    ✓
6. Destino por perfil + carpeta elegida     ✓ (CLI + web)
7. Portada + rutas /download/* y /transcript/*  ✓ (estructura; sólo TikTok activo)
8. Otras plataformas (YouTube, FB, IG…)     ·
9. Transcripción                            · (sin fuente comprobada)
10. Proveedor reutilizable en Laravel       ·
```

---

## Licencia / uso responsable

Proyecto de estudio técnico. Trabaja sólo con URLs públicas, respeta los
términos de las plataformas involucradas y no intenta evadir CAPTCHAs ni
controles de acceso.
