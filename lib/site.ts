/**
 * Constantes de la interfaz (navegación, pie, enlaces externos).
 *
 * `REPO_URL` apunta al repositorio público del proyecto. Con valor aparece el
 * botón de GitHub solo en la portada y en el pie; vacía, no se muestra ningún
 * enlace externo.
 */
export const REPO_URL = "https://github.com/scorvachoa/Redly";

/**
 * Descarga del programa de escritorio: asset del último release del repositorio
 * compañero. La parte `latest` la resuelve GitHub sola, así que al publicar una
 * versión nueva el enlace deja de apuntar a la anterior sin tocar este archivo.
 */
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/scorvachoa/Redly-Desktop/releases/latest/download/Redly.exe";
