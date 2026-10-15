/**
 * Escritura de descargas en el navegador.
 *
 * Dos estrategias, con la misma interfaz:
 *
 * - `directorySink` → File System Access API (Chromium): el usuario elige una
 *   carpeta con `showDirectoryPicker()` y el archivo se escribe directamente
 *   ahí, **en streaming** (sin buffer en memoria). Es la única forma real de
 *   controlar el destino en la web.
 * - `anchorSink` → el comportamiento clásico (todos los navegadores): se
 *   acumula el stream en un blob y se lanza un `a[download]`. Con un nombre
 *   que incluye subcarpeta (`scout2015/archivo.mp4`), Chrome y Edge crean la
 *   subcarpeta dentro de Descargas; Firefox y Safari la ignoran y dejan el
 *   archivo plano.
 *
 * Módulo apto para el navegador: no importa nada de `node:*` ni de
 * `./config` (que lee `process.env`).
 */

import { sanitizeFolderName } from "./sanitize";

/**
 * `showDirectoryPicker` no está incluido en `lib.dom.d.ts` de TypeScript, así
 * que se declara aquí. El resto de tipos (`FileSystemDirectoryHandle`,
 * `createWritable`, …) sí vienen de la librería DOM estándar.
 */
interface PickableWindow extends Window {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}

/** Destino de una descarga: se escribe por trozos y se cierra al terminar. */
export interface FileSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** ¿Soporta el navegador el selector de carpetas? (Chromium sí; Firefox/Safari no). */
export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as PickableWindow).showDirectoryPicker === "function"
  );
}

/**
 * Abre el selector nativo de carpetas. Devuelve `null` si el usuario cancela
 * el diálogo (`AbortError`); propaga cualquier otro error (p. ej. permiso
 * denegado o navegador no soportado).
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryPicker()) return null;
  try {
    return await (window as PickableWindow).showDirectoryPicker!({ mode: "readwrite" });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return null;
    throw error;
  }
}

/**
 * Escribe en una carpeta elegida por el usuario. Crea `subdir` dentro de ella
 * si se indica (así un perfil siempre queda en su propia subcarpeta).
 */
export async function directorySink(
  root: FileSystemDirectoryHandle,
  subdir: string | null,
  filename: string,
): Promise<FileSink> {
  const folder = subdir ? sanitizeFolderName(subdir) : null;
  const dir = folder ? await root.getDirectoryHandle(folder, { create: true }) : root;
  const file = await dir.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  return {
    write: async (chunk) => {
      // `reader.read()` entrega `Uint8Array<ArrayBufferLike>` y el escritor
      // pide `ArrayBufferView<ArrayBuffer>`; el dato real siempre es un
      // ArrayBuffer por debajo, así que el casteo es seguro.
      await writable.write(chunk as unknown as ArrayBufferView<ArrayBuffer>);
    },
    close: async () => {
      await writable.close();
    },
    abort: async () => {
      await writable.abort().catch(() => undefined);
    },
  };
}

/**
 * Descarga clásica al navegador. `suggestedName` puede llevar subcarpeta
 * (`scout2015/Redly_7694.mp4`): Chrome/Edge la crean, el resto la ignoran.
 */
export function anchorSink(suggestedName: string, contentType: string): FileSink {
  const chunks: Uint8Array[] = [];
  return {
    write: async (chunk) => {
      chunks.push(chunk);
    },
    close: async () => {
      const blob = new Blob(chunks as BlobPart[], { type: contentType });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = suggestedName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    },
    abort: async () => {
      chunks.length = 0;
    },
  };
}

/** Une el destino con una subcarpeta opcional. */
export function joinDestination(root: string, subdir: string | null): string {
  const base = (root || "").replace(/[\\/]+$/, "");
  const folder = (subdir || "").replace(/^[\\/]+|[\\/]+$/g, "");
  return folder ? `${base}/${folder}` : base;
}
