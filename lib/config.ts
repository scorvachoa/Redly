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
];

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
