/**
 * Historial de descargas: evita repetir vídeos ya bajados.
 *
 * Guarda el historial detrás de un *storage adapter* inyectable:
 *
 * - en el navegador con `localStorage` (donde no hay sistema de archivos),
 * - en tests con un doble en memoria.
 *
 * Se guarda **sólo** estado, nombre de archivo, bytes y título — **nunca URLs
 * ni tokens**, que caducan en ~1 hora.
 *
 * Nota: este módulo no importa `node:*` para que el bundler del navegador lo
 * pueda incluir sin arrastrar runtime de Node.
 */

export interface HistoryEntry {
  state: "ok" | "error";
  file?: string;
  bytes?: number;
  title?: string;
  error?: string;
  updated: number;
}

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const HISTORY_STORAGE_KEY = "redly-history-v1";
const HISTORY_VERSION = 1;

/** Almacén en memoria (tests y entornos sin storage real). */
export class MemoryHistoryStorage implements HistoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** `localStorage` del navegador, o `null` si no está disponible. */
export function browserStorage(): HistoryStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    // Modo privado o storage bloqueado: el historial queda deshabilitado.
    return null;
  }
}

/** Estado persistente de las descargas. Best-effort: nunca lanza al escribir. */
export class History {
  readonly key: string;
  private readonly storage: HistoryStorage | null;
  private items: Record<string, HistoryEntry> = {};

  constructor(storage: HistoryStorage | null, key: string = HISTORY_STORAGE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  load(): void {
    if (!this.storage) {
      this.items = {};
      return;
    }
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) {
        this.items = {};
        return;
      }
      const parsed = JSON.parse(raw) as { items?: Record<string, HistoryEntry> };
      this.items =
        parsed && typeof parsed.items === "object" && parsed.items ? parsed.items : {};
    } catch {
      // Archivo ilegible o JSON inválido: se empieza de cero.
      this.items = {};
    }
  }

  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        this.key,
        JSON.stringify({ version: HISTORY_VERSION, items: this.items }),
      );
    } catch {
      // Cuota llena o storage deshabilitado: el historial es best-effort.
    }
  }

  get(id: string): HistoryEntry | null {
    const entry = this.items[id];
    return entry && typeof entry === "object" ? entry : null;
  }

  /** ¿Se descargó bien alguna vez? */
  isDone(id: string): boolean {
    return this.get(id)?.state === "ok";
  }

  mark(
    id: string,
    state: "ok" | "error",
    fields: { file?: string; bytes?: number; title?: string; error?: string } = {},
  ): void {
    const entry: HistoryEntry = { state, updated: Math.floor(Date.now() / 1000) };
    if (fields.file) entry.file = fields.file;
    if (fields.bytes !== undefined) entry.bytes = fields.bytes;
    if (fields.title) entry.title = fields.title;
    if (fields.error) entry.error = fields.error;
    this.items[id] = entry;
    this.save();
  }

  clear(): void {
    this.items = {};
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Ignorado a propósito.
    }
  }

  /** Ids marcados como descargados correctamente. */
  doneIds(): string[] {
    return Object.keys(this.items).filter((id) => this.items[id]?.state === "ok");
  }

  get size(): number {
    return Object.keys(this.items).length;
  }

  get doneCount(): number {
    return this.doneIds().length;
  }
}

/**
 * Separa la cola en pendientes y ya descargados, conservando el orden.
 *
 * `skip` a `false` devuelve la cola entera, sin filtrar nada.
 */
export function partitionByHistory<T extends { id: string }>(
  items: T[],
  history: History,
  skip = true,
): { pending: T[]; done: T[] } {
  const pending: T[] = [];
  const done: T[] = [];
  for (const item of items) {
    if (skip && history.isDone(item.id)) done.push(item);
    else pending.push(item);
  }
  return { pending, done };
}
