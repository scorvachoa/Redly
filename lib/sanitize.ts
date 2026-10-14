/**
 * Saneado de nombres de archivo y carpetas.
 *
 * Extraído de `lib/downloader.ts` para que también pueda usarlo el navegador:
 * `downloader.ts` importa `node:fs` y `node:stream`, y este módulo no debe
 * arrastrar esas dependencias al bundle del cliente. Por eso aquí no hay
 * imports (ni siquiera de `./config`).
 *
 * Reglas: elimina path traversal (`..`), caracteres inválidos en Windows y
 * POSIX, colapsa separadores y respeta los nombres reservados de Windows.
 */

/** Longitud máxima de un nombre de archivo o carpeta. */
export const MAX_FILENAME_LENGTH = 120;

/** Longitud máxima de una carpeta (más corta: es más legible en un explorador). */
export const MAX_FOLDER_LENGTH = 64;

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

function baseClean(name: string): string {
  let cleaned = String(name ?? "").replace(INVALID_CHARS, "_");
  cleaned = cleaned.replace(/\.\./g, "_");
  cleaned = cleaned.replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  cleaned = cleaned.replace(/_+/g, "_");
  return cleaned;
}

/** Elimina path traversal y caracteres inválidos (Windows/POSIX). */
export function sanitizeFilename(name: string, maxLength = MAX_FILENAME_LENGTH): string {
  let cleaned = baseClean(name);

  if (!cleaned || [...cleaned].every((c) => c === "_" || c === ".")) return "archivo";

  // Sólo se trata el nombre reservado si el archivo tiene extensión (`CON.mp4`);
  // un `CON` sin punto se comporta igual que el original del puerto Python.
  const lastDot = cleaned.lastIndexOf(".");
  if (lastDot > 0 && WINDOWS_RESERVED.has(cleaned.slice(0, lastDot).toUpperCase())) {
    cleaned = `_${cleaned}`;
  }

  if (cleaned.length > maxLength) {
    const dot = cleaned.lastIndexOf(".");
    const ext = dot > 0 ? cleaned.slice(dot + 1) : "";
    if (ext && ext.length <= 10) {
      cleaned = `${cleaned.slice(0, maxLength - ext.length - 1)}.${ext}`;
    } else {
      cleaned = cleaned.slice(0, maxLength);
    }
  }
  return cleaned.trim().replace(/^\.+|\.+$/g, "") || "archivo";
}

/**
 * Igual que `sanitizeFilename` pero pensado para nombres de carpeta: no
 * conserva la extensión al truncar (una carpeta no la tiene) y usa un tope
 * más corto.
 */
export function sanitizeFolderName(name: string, maxLength = MAX_FOLDER_LENGTH): string {
  let cleaned = baseClean(name);

  // En carpetas los puntos finales y los guiones bajos sobrantes molestan, y
  // `.` / `..` son nombres especiales del sistema de ficheros.
  cleaned = cleaned.replace(/[._]+$/g, "");

  if (!cleaned || [...cleaned].every((c) => c === "_" || c === ".")) return "perfil";

  if (WINDOWS_RESERVED.has(cleaned.toUpperCase())) cleaned = `_${cleaned}`;

  if (cleaned.length > maxLength) cleaned = cleaned.slice(0, maxLength);

  return cleaned.trim().replace(/^\.+|\.+$/g, "") || "perfil";
}
