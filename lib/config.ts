/**
 * Configuración central de Red.ly.
 *
 * Port de `app/config.py`. Todos los valores son sobreescribibles por variables
 * de entorno (`.env` en local, panel de Vercel en producción). No se guardan
 * secretos: el proyecto trabaja sólo con URLs públicas.
 */

const env = process.env;

function envStr(key: string, fallback: string): string {
  const value = env[key];
  return value === undefined || value === "" ? fallback : value;
}

function envNum(key: string, fallback: number): number {
  const value = env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Endpoints (los dos orígenes que se han verificado empíricamente)
// ---------------------------------------------------------------------------
export const TIKVID_BASE_URL = stripSlash(envStr("TIKVID_BASE_URL", "https://tikvid.io"));
export const TIKVID_AJAX_SEARCH_URL = envStr(
  "TIKVID_AJAX_SEARCH_URL",
  `${TIKVID_BASE_URL}/api/ajaxSearch`,
);

export const SAVETIK_BASE_URL = stripSlash(
  envStr("SAVETIK_BASE_URL", "https://savetikpro.com"),
);
export const SAVETIK_AJAX_SEARCH_URL = envStr(
  "SAVETIK_AJAX_SEARCH_URL",
  `${SAVETIK_BASE_URL}/api/ajaxSearch`,
);
export const SAVETIK_HOME_PATH = envStr("SAVETIK_HOME_PATH", "/en");
export const SAVETIK_LANG = envStr("SAVETIK_LANG", "en");

/**
 * Fuente de YouTube (SnapYT). Flujo de tres pasos vía `admin-ajax.php`
 * (nonce → `process_video_url` → preview HTML), verificado sin WAF.
 */
export const SNAPYT_BASE_URL = stripSlash(
  envStr("SNAPYT_BASE_URL", "https://www.snapyt.app"),
);
export const SNAPYT_AJAX_URL = envStr(
  "SNAPYT_AJAX_URL",
  `${SNAPYT_BASE_URL}/wp-admin/admin-ajax.php`,
);

/**
 * Fuente de Facebook (FSave). Flujo de tres pasos vía JSON, sin WAF ni
 * Turnstile: `POST /mint.php` (`getch=1` → challenge; `ch`+`answer` → `dt`)
 * y `POST /proxy.php` con `{ url, dt }` (resolución del post y sondeo de cada
 * trabajo de render). Verificado empíricamente.
 */
export const FSAVE_BASE_URL = stripSlash(envStr("FSAVE_BASE_URL", "https://fsave.net"));
export const FSAVE_MINT_URL = envStr("FSAVE_MINT_URL", `${FSAVE_BASE_URL}/mint.php`);
export const FSAVE_PROXY_URL = envStr("FSAVE_PROXY_URL", `${FSAVE_BASE_URL}/proxy.php`);
/** JS público que trae la clave del `mint` (se relee si la fuente la detecta girada). */
export const FSAVE_SENSOR_URL = envStr(
  "FSAVE_SENSOR_URL",
  `${FSAVE_BASE_URL}/assets/js/sensor.js`,
);
/**
 * Clave HMAC del `mint` de FSave.
 *
 * No es un secreto de usuario: está en claro en `sensor.js`, que el servicio
 * sirve a todo el mundo. Si el servicio la rotara, `lib/fsave.ts` la vuelve a
 * leer de ese fichero en el siguiente intento.
 */
export const FSAVE_MINT_KEY = envStr("FSAVE_MINT_KEY", "d0776d5ce84657543697c00bab933acb");

/**
 * Fuente de Instagram (IGExport). API JSON en el mismo origen, sin claves y
 * sin WAF: `GET /api/ig-reels/?url=<post>&videoOnly=1` resuelve el MP4 de
 * cualquier publicación con vídeo (reel o `/p/`) y `GET /api/ig-photo/?url=`
 * devuelve los elementos de una publicación de fotos. Verificado empíricamente.
 */
export const IGEXPORT_BASE_URL = stripSlash(
  envStr("IGEXPORT_BASE_URL", "https://igexport.com"),
);
export const IGEXPORT_REELS_URL = envStr(
  "IGEXPORT_REELS_URL",
  `${IGEXPORT_BASE_URL}/api/ig-reels/`,
);
export const IGEXPORT_PHOTO_URL = envStr(
  "IGEXPORT_PHOTO_URL",
  `${IGEXPORT_BASE_URL}/api/ig-photo/`,
);

/**
 * oEmbed público de Instagram (título/autor de la publicación).
 *
 * Metadato **best-effort**: si Instagram lo rechaza, la fuente se conforma con
 * el autor o el código de la publicación. Verificado empíricamente (200 sin
 * cookies ni clave).
 */
export const INSTAGRAM_OEMBED_URL = envStr(
  "INSTAGRAM_OEMBED_URL",
  "https://www.instagram.com/api/v1/oembed/",
);

/**
 * Fuente de Instagram de respaldo (LoveInsta). `POST /proxy.php` con sólo
 * `url=` (sin claves, sin mint, sin Turnstile y sin desafío de WAF; verificado
 * incluso sin headers de navegador): el primer POST entrega los `mediaItems`
 * con el job de render de cada vídeo y, para fotos, la URL directa en
 * `dl.iamworker.com`. Los jobs de render se resuelven con el `/api/render`
 * existente (mismo clúster de trabajos que FSave).
 */
export const LOVEINSTA_BASE_URL = stripSlash(
  envStr("LOVEINSTA_BASE_URL", "https://loveinsta.com"),
);
export const LOVEINSTA_PROXY_URL = envStr(
  "LOVEINSTA_PROXY_URL",
  `${LOVEINSTA_BASE_URL}/proxy.php`,
);

/**
 * Fuente de X (Twitter) vía iLoveX (`ilovex.com`). Un solo paso JSON en el
 * propio origen, sin mint, sin Turnstile y sin claves: `POST /proxy.php` con
 * `url=<tweet>` devuelve los `mediaItems` (verificado empíricamente). Cada
 * vídeo es un trabajo de render en `s<nn>.worker<nn>.com` (misma familia de
 * CDN que FSave/LoveInsta); el sondeo del job es el mismo `POST /proxy.php`
 * sin sesión, y el `fileUrl` final vive en `dl.iamworker.com` (host ya
 * permitido; no hace falta ampliar la allowlist).
 */
export const ILOVEX_BASE_URL = stripSlash(envStr("ILOVEX_BASE_URL", "https://ilovex.com"));
export const ILOVEX_PROXY_URL = envStr("ILOVEX_PROXY_URL", `${ILOVEX_BASE_URL}/proxy.php`);
/**
 * Sondeos máximos de un trabajo de render de iLoveX antes de rendirse.
 * En los flujos verificados el job suele estar `Completed` al primer sondeo.
 */
export const ILOVEX_RENDER_ATTEMPTS = envNum("ILOVEX_RENDER_ATTEMPTS", 20);

/**
 * Fuente de Threads vía SaveThreads (`savethreads.com`). Un solo paso JSON en
 * el propio origen, sin mint, sin Turnstile y sin claves: `POST /proxy.php`
 * con `url=<post>` devuelve los `mediaItems` (verificado empíricamente). Cada
 * vídeo es un trabajo de render en `s<nn>.worker<nn>.com` (misma familia de
 * CDN que FSave/LoveInsta/iLoveX); el sondeo del job es el mismo
 * `POST /proxy.php` sin sesión, y el `fileUrl` final vive en
 * `dl.iamworker.com` (host ya en la allowlist; no hace falta ampliarla).
 */
export const SAVETHREADS_BASE_URL = stripSlash(
  envStr("SAVETHREADS_BASE_URL", "https://savethreads.com"),
);
export const SAVETHREADS_PROXY_URL = envStr(
  "SAVETHREADS_PROXY_URL",
  `${SAVETHREADS_BASE_URL}/proxy.php`,
);
/**
 * Sondeos máximos de un trabajo de render de SaveThreads antes de rendirse.
 * En los flujos verificados el job suele estar `Completed` al primer sondeo.
 */
export const SAVETHREADS_RENDER_ATTEMPTS = envNum("SAVETHREADS_RENDER_ATTEMPTS", 20);

/**
 * Listados de YouTube (YTMP3.gg). La API de metadatos `yt-meta.convert1s.com`
 * sirve el contenido de una lista de reproducción (hasta 100 vídeos por página,
 * con token opaco de continuación), sin clave, WAF ni Turnstile. Verificado
 * empíricamente. Sólo listado: la descarga de cada vídeo va por SnapYT.
 */
export const YT_YTMP3_META_BASE_URL = stripSlash(
  envStr("YT_YTMP3_META_BASE_URL", "https://yt-meta.convert1s.com"),
);
export const YT_YTMP3_PLAYLIST_PATH = envStr("YT_YTMP3_PLAYLIST_PATH", "/playlist");
/** Vídeos por página que el servicio devuelve de un tirón (máximo observable). */
export const YT_YTMP3_MAX_PER_PAGE = envNum("YT_YTMP3_MAX_PER_PAGE", 100);

// ---------------------------------------------------------------------------
// Timeouts y reintentos
// ---------------------------------------------------------------------------
export const REQUEST_TIMEOUT = envNum("REQUEST_TIMEOUT", 30);
export const DOWNLOAD_TIMEOUT = envNum("DOWNLOAD_TIMEOUT", 120);
export const MAX_REDIRECTS = envNum("MAX_REDIRECTS", 5);
export const RETRY_ATTEMPTS = envNum("RETRY_ATTEMPTS", 3);
export const RETRY_BACKOFF_SECONDS = envNum("RETRY_BACKOFF_SECONDS", 0.8);
export const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Descargas
// ---------------------------------------------------------------------------
/** Tope de vídeos que la API web devolverá por perfil (protege la función). */
export const API_PROFILE_MAX = envNum("API_PROFILE_MAX", 100);

/**
 * Sondeos máximos esperando a que FSave termine de preparar un archivo
 * (render). En la práctica tarda 1–2 sondeos; el tope protege la función.
 */
export const FSAVE_RENDER_ATTEMPTS = envNum("FSAVE_RENDER_ATTEMPTS", 20);

// ---------------------------------------------------------------------------
// Headers de navegador (sin cookies ni tokens personales)
// ---------------------------------------------------------------------------
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: TIKVID_BASE_URL,
  Referer: `${TIKVID_BASE_URL}/`,
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "cors",
  "sec-fetch-dest": "empty",
};

export const SAVETIK_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: SAVETIK_BASE_URL,
  Referer: `${SAVETIK_BASE_URL}${SAVETIK_HOME_PATH}`,
};

export const SNAPYT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "*/*",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: SNAPYT_BASE_URL,
  Referer: `${SNAPYT_BASE_URL}/`,
};

/** Cabeceras para la API JSON de FSave (`mint.php` y `proxy.php`). */
export const FSAVE_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: FSAVE_BASE_URL,
  Referer: `${FSAVE_BASE_URL}/es`,
};

/** Cabeceras para la API JSON de IGExport (`/api/ig-reels/`, `/api/ig-photo/`). */
export const IGEXPORT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Referer: `${IGEXPORT_BASE_URL}/`,
};

/** Cabeceras para `POST /proxy.php` de LoveInsta (las mismas del navegador). */
export const LOVEINSTA_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: LOVEINSTA_BASE_URL,
  Referer: `${LOVEINSTA_BASE_URL}/es`,
};

/** Cabeceras para `POST /proxy.php` de iLoveX (las mismas del navegador). */
export const ILOVEX_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: ILOVEX_BASE_URL,
  Referer: `${ILOVEX_BASE_URL}/es`,
};

/** Cabeceras para `POST /proxy.php` de SaveThreads (las mismas del navegador). */
export const SAVETHREADS_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: SAVETHREADS_BASE_URL,
  Referer: `${SAVETHREADS_BASE_URL}/es`,
};

/** Cabeceras para el oEmbed público de Instagram (metadatos best-effort). */
export const INSTAGRAM_OEMBED_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
};

/** Cabeceras para la API de metadatos de YTMP3 (`yt-meta.convert1s.com`). */
export const YT_YTMP3_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
  Referer: "https://media.ytmp3.gg/",
};

export const DOWNLOAD_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------------------------------------------------------------------------
// Selectores HTML (con fallbacks; TikVid/SavTikPro pueden cambiar su plantilla)
// ---------------------------------------------------------------------------
export const SELECTORS = {
  thumbnail: [
    "div.thumbnail img",
    "div.image-tik img",
    ".tik-left img",
    "video[poster]",
    "img.thumbnail",
    "img",
  ],
  title: [
    "div.thumbnail h3",
    "div.content h3",
    ".tik-video h3",
    ".video-data h3",
    "h3",
    "h1",
    "[class*='title']",
  ],
  videoIdInput: [
    "#TikTokId",
    "input[name='TikTokId']",
    "input[name='video_id']",
    "input[id*='tiktok' i]",
    "input[id*='video' i]",
  ],
  downloadPrimary: ["a.tik-button-dl", ".dl-action a[href]", ".download a[href]", "a[download]"],
  downloadHrefHosts: ["dl.snapcdn.app", "snapcdn.app", "tiktokcdn", "tokcdn", "tik-cdn"],
} as const;

export const DOWNLOAD_TEXT_PATTERN =
  /\bdownload\b.*\b(mp4|mp3|m4a|aac|wav|webm|video|audio)\b/i;
/** Formatos de archivo reconocidos: vídeo, audio **e imagen** (carruseles). */
export const FORMAT_PATTERN = /\b(mp4|mp3|m4a|aac|wav|webm|jpg|jpeg|png|webp)\b/i;
export const TIKTOK_VIDEO_ID_PATTERN = /tiktok\.com\/@[^/\s]+\/video\/(\d{6,25})/i;

/**
 * Botones de una publicación de fotos.
 *
 * No son `tik-button-dl`, así que el selector principal (que se detiene en el
 * primer grupo no vacío) nunca los alcanza: se recolectan aparte y se concatenan.
 */
export const PHOTO_DOWNLOAD_SELECTOR = ".photo-list .download-items__btn a[href]";
/** Miniatura de cada foto, hermana del botón dentro del mismo `<li>`. */
export const PHOTO_THUMB_SELECTOR = ".download-items__thumb img";

/** Enlaces de navegación (no de archivo) que hay que excluir del parser. */
export const EXCLUDED_DOWNLOAD_CLASSES = ["more-video", "close", "popup"];

// ---------------------------------------------------------------------------
// Selectores de tarjetas de perfil (con fallbacks, igual que los de vídeo)
// ---------------------------------------------------------------------------
/**
 * El parser de vídeo ya usaba cadenas de selectores de respaldo porque
 * TikVid/SavTikPro cambian de plantilla sin avisar. Los de perfil estaban
 * hardcodeados a uno solo: el cambio más probable rompía el listado entero
 * sin que ningún test lo detectara (los fixtures son estáticos).
 *
 * Orden: del más específico al más genérico. El último de cada lista es
 * deliberadamente laxo para seguir extrayendo algo aunque cambien las clases.
 */
export const PROFILE_SELECTORS = {
  card: ["div.video-item", ".video-item", "[class*='video-item']", "li[class*='video']"],
  link: ["a.pro-dl-link", ".pro-dl-link", "a[href*='snapcdn']", "a[href]"],
  thumb: [".pro-thumbnail img", ".video-item img", "[class*='thumb'] img", "img"],
  title: ["p.text-title", ".text-title", "[class*='title']", "h3", "h4"],
  channel: ["p.text-channel", ".text-channel", "[class*='channel']", "[class*='author']"],
  views: [
    ".count-view .view-text span",
    ".count-view span",
    "[class*='view'] span",
    "[class*='count']",
  ],
} as const;

/** Extensiones de archivo reconocidas en el nombre del enlace de descarga. */
export const PROFILE_FORMAT_PATTERN = /\.(mp4|mp3|m4a|webm|jpe?g|png|webp)\b/i;
/** Un id de vídeo de TikTok embebido en el nombre o en la URL. */
export const PROFILE_VIDEO_ID_PATTERN = /(\d{10,25})/;

// ---------------------------------------------------------------------------
// Hosts de CDN permitidos para el proxy de descarga (evita abrirlo como proxy)
// ---------------------------------------------------------------------------
export const ALLOWED_DOWNLOAD_HOSTS = [
  "snapcdn.app",
  "pro.snapcdn.app",
  "dl.snapcdn.app",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "tokcdn.com",
  "tik-cdn.com",
  "s1.tik-cdn.com",
  "s2.tik-cdn.com",
  // YouTube: los enlaces de descarga de SnapYT pasan por su proxy propio
  // (`admin-ajax.php?action=snapyt_force_download`), resuelto en `snapyt.app`.
  "snapyt.app",
  // Por si alguna opción apunta al CDN de vídeo directo de googlevideo.com.
  "googlevideo.com",
  // Facebook e Instagram (fallback de LoveInsta): el archivo final se sirve
  // desde `dl.iamworker.com` (host observado en todos los flujos verificados,
  // incluidos los jobs de render de LoveInsta; el patrón `*.iamworker.com`
  // cubre las variantes del mismo operador).
  "iamworker.com",
  // Instagram: el MP4 de igexport.com vive en el CDN propio de Instagram
  // (`scontent-<borde>-<n>.cdninstagram.com`), cuyo borde varía por región;
  // el patrón `*.cdninstagram.com` cubre todas las variantes.
  "cdninstagram.com",
];

// ---------------------------------------------------------------------------
// Bot de Telegram (webhook en Vercel)
// ---------------------------------------------------------------------------
/**
 * Token del bot de Telegram (lo da @BotFather). Vacío = bot desactivado: la
 * ruta del webhook responde 200 sin hacer nada.
 */
export const TELEGRAM_BOT_TOKEN = envStr("TELEGRAM_BOT_TOKEN", "");
/**
 * Secreto del webhook: se envía en la cabecera
 * `X-Telegram-Bot-Api-Secret-Token` al registrar el webhook con
 * `secret_token` y la ruta lo valida antes de procesar nada.
 */
export const TELEGRAM_WEBHOOK_SECRET = envStr("TELEGRAM_WEBHOOK_SECRET", "");
/** Username visible del bot (sin @); si está vacío, la web no enlaza al bot. */
export const TELEGRAM_BOT_USERNAME = envStr("TELEGRAM_BOT_USERNAME", "");
/**
 * Lista blanca de chats autorizados (ids numéricos, separados por comas).
 * Vacía = nadie permitido (el webhook responde 200 sin contestar).
 */
export const TELEGRAM_ALLOWED_CHAT_IDS = parseChatIds(
  envStr("TELEGRAM_ALLOWED_CHAT_IDS", ""),
);
/** Tope de bytes que se envían a Telegram por archivo (Bot API: 50 MB). */
export const TELEGRAM_MAX_FILE_BYTES = envNum("TELEGRAM_MAX_FILE_BYTES", 50 * 1024 * 1024);
/** Peticiones admitidas por chat dentro de la ventana del bot. */
export const TELEGRAM_RATE_LIMIT_MAX = envNum("TELEGRAM_RATE_LIMIT_MAX", 20);
export const TELEGRAM_RATE_LIMIT_WINDOW_SECONDS = envNum(
  "TELEGRAM_RATE_LIMIT_WINDOW_SECONDS",
  60,
);

/** `TELEGRAM_ALLOWED_CHAT_IDS="1,-100"` → `{"1","-100"}` (los ids de grupo son negativos). */
function parseChatIds(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  );
}

// ---------------------------------------------------------------------------
// Utilidades para logs
// ---------------------------------------------------------------------------
/** Devuelve sólo el host de una URL (seguro para logs). */
export function urlHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** ¿El host está en la lista blanca de CDNs? (para el proxy de descarga) */
export function isAllowedDownloadHost(host: string | null): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  return ALLOWED_DOWNLOAD_HOSTS.some(
    (allowed) => lower === allowed || lower.endsWith(`.${allowed}`),
  );
}
