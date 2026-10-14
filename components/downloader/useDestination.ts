"use client";

/**
 * Destino de las descargas en el navegador.
 *
 * Encapsula el selector de carpeta de Chromium y la fábrica de destinos, que
 * es el único punto del descargador que toca `FileSystemDirectoryHandle`. Al
 * vivir aparte, el resto de la UI no se entera de si el usuario eligió carpeta
 * o usa la descarga clásica del navegador.
 */

import { useCallback, useState } from "react";

import {
  anchorSink,
  directorySink,
  joinDestination,
  pickDirectory,
  supportsDirectoryPicker,
  type FileSink,
} from "@/lib/fsaccess";

export interface UseDestinationOptions {
  /** Subcarpeta dentro del destino (`null` = escribir en la raíz). */
  subdir: string | null;
  /** Callback para notificar fallos del selector de carpeta. */
  onError?: (message: string) => void;
}

export interface Destination {
  /** Carpeta elegida por el usuario, o `null` si usa Descargas. */
  dirHandle: FileSystemDirectoryHandle | null;
  /** Nombre visible de la carpeta elegida. */
  dirLabel: string | null;
  /** ¿Este navegador soporta `showDirectoryPicker`? */
  canPickDir: boolean;
  /** Ruta completa visible para el usuario (`Carpeta/subcarpeta`). */
  label: string;
  /** Abre el selector de carpeta del navegador. */
  chooseDirectory: () => Promise<void>;
  /** Vuelve a la descarga por defecto del navegador. */
  clearDirectory: () => void;
  /** Fábrica de destino para una descarga concreta. */
  makeSink: (filename: string, contentType: string) => FileSink | Promise<FileSink>;
}

/**
 * Estado y acciones del destino de descarga.
 *
 * Los `FileSystemDirectoryHandle` no se serializan, así que sólo viven en
 * memoria: al recargar hay que volver a elegir la carpeta. Es una limitación
 * del navegador, no del código.
 */
export function useDestination({ subdir, onError }: UseDestinationOptions): Destination {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const dirLabel = dirHandle?.name ?? null;
  const canPickDir = supportsDirectoryPicker();

  const chooseDirectory = useCallback(async () => {
    try {
      const picked = await pickDirectory();
      if (picked) setDirHandle(picked);
    } catch (error) {
      onError?.(`No se pudo abrir la carpeta: ${(error as Error).message}`);
    }
  }, [onError]);

  const clearDirectory = useCallback(() => setDirHandle(null), []);

  const makeSink = useCallback(
    (filename: string, contentType: string): FileSink | Promise<FileSink> =>
      dirHandle
        ? directorySink(dirHandle, subdir, filename)
        : anchorSink(subdir ? joinDestination(subdir, filename) : filename, contentType),
    [dirHandle, subdir],
  );

  const label = dirHandle
    ? joinDestination(dirLabel ?? "", subdir)
    : subdir
      ? `Descargas/${subdir}`
      : "Descargas del navegador";

  return {
    dirHandle,
    dirLabel,
    canPickDir,
    label,
    chooseDirectory,
    clearDirectory,
    makeSink,
  };
}
