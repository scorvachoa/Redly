"use client";

/**
 * Historial de descargas del navegador, con su estado reactivo.
 *
 * `lib/history.ts` es una clase imperativa con storage inyectable; aquí se le
 * pone una capa reactiva para que la UI se entere de los cambios sin tener que
 * recordar a quién avisar. Al vivir en su propio hook, el resto del
 * descargador no maneja `localStorage` ni la instancia directamente.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { History, browserStorage, type HistoryStorage } from "@/lib/history";

export interface DownloadHistory {
  /** Vídeos marcados como descargados correctamente. */
  readonly count: number;
  /** ¿El navegador dejó usar `localStorage`? */
  readonly available: boolean;
  /** ¿Ese vídeo se descargó bien alguna vez? */
  isDone: (id: string) => boolean;
  /** Registra el resultado de una descarga y refresca el contador. */
  mark: (
    id: string,
    state: "ok" | "error",
    fields?: { file?: string; bytes?: number; title?: string; error?: string },
  ) => void;
  /** Borra todo el historial. */
  clear: () => void;
}

/**
 * Inicializa el historial al montar.
 *
 * `browserStorage()` devuelve `null` en modo privado o con storage bloqueado:
 * en ese caso `available` pasa a `false` y la UI avisa de que cada análisis
 * empezará de cero.
 */
export function useDownloadHistory(): DownloadHistory {
  const ref = useRef<History | null>(null);
  const [count, setCount] = useState(0);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const storage: HistoryStorage | null = browserStorage();
    const history = new History(storage);
    history.load();
    ref.current = history;
    setAvailable(storage !== null);
    setCount(history.doneCount);
  }, []);

  const isDone = useCallback((id: string) => ref.current?.isDone(id) ?? false, []);

  const mark = useCallback<DownloadHistory["mark"]>((id, state, fields) => {
    ref.current?.mark(id, state, fields);
    setCount(ref.current?.doneCount ?? 0);
  }, []);

  const clear = useCallback(() => {
    ref.current?.clear();
    setCount(0);
  }, []);

  return { count, available, isDone, mark, clear };
}
