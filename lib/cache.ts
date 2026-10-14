/**
 * Caché en memoria con TTL y techo de entradas (LRU).
 *
 * **Qué se cachea y por qué es seguro**: sólo el resultado de *listar una
 * página de perfil*, que son metadatos (id, título, vistas, miniatura) más la
 * URL del enlace de descarga. Esa URL es un token JWT de SnapCDN con
 * caducidad de ~1 hora, así que el TTL por defecto es **bien inferior**: si se
 * sirve un token caducado, el usuario ve un error de descarga en lugar de un
 * resultado inventado, y el reintento lo pide fresco.
 *
 * **Qué no se cachea**: nunca un vídeo ya resuelto con sus opciones de
 * descarga completas, porque ahí el token es todavía más corto y un acierto
 * tardío se paga con un enlace muerto.
 *
 * Es memoria de proceso: en serverless cada instancia tiene la suya. Eso está
 * bien para este caso (evita repetir peticiones idénticas seguidas dentro de
 * una misma sesión de usuario) y no pretende ser una caché compartida. Si algún
 * día hace falta una global, sólo hay que sustituir esta clase por otra con la
 * misma interfaz.
 */

export interface TtlCacheOptions {
  /** Máximo de entradas vivas. Al superarlo se descarta la más antigua. */
  maxEntries?: number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 500;

/**
 * Mapa con expiración por entrada y recuento máximo.
 *
 * No hay limpieza en segundo plano: las entradas caducadas se ignoran al
 * leerlas y se purgan de forma perezosa, de modo que el coste de mantener la
 * caché se paga sólo cuando se usa.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();
  private readonly maxEntries: number;
  /** Contador de aciertos, para telemetría y tests. */
  private hits = 0;
  private misses = 0;

  constructor(options: TtlCacheOptions = {}) {
    const requested = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxEntries = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_MAX_ENTRIES;
  }

  /** Valor vivo para esa clave, o `undefined` si no está o caducó. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      // Caducada: se borra para no ocupar sitio.
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // Reciente: se reordena al final para que el LRU descarte la más antigua.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /** Guarda un valor. Un TTL de 0 o menos no cachea (se comporta como miss). */
  set(key: string, value: T, ttlMs: number): void {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.evict();
  }

  /** Borra una entrada concreta (por ejemplo tras un fallo). */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Vacía la caché por completo. */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Entradas vivas en este instante (las caducadas no cuentan). */
  get size(): number {
    const now = Date.now();
    let alive = 0;
    for (const entry of this.store.values()) {
      if (entry.expiresAt > now) alive += 1;
    }
    return alive;
  }

  /** Aciertos desde el último `clear()`. */
  get hitCount(): number {
    return this.hits;
  }

  /** Fallos desde el último `clear()`. */
  get missCount(): number {
    return this.misses;
  }

  /** Proporción de aciertos (0 si no hubo accesos todavía). */
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  /**
   * Descarta las entradas más antiguas mientras se supere el techo.
   * `Map` mantiene el orden de inserción, y `get` reordena, así que el
   * primero es siempre el menos recientemente usado.
   */
  private evict(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }
}

/** TTL por defecto de una página de perfil (ms). */
export const PROFILE_PAGE_TTL_MS = Number(process.env.PROFILE_CACHE_TTL_MS ?? 60_000);

/**
 * Caché de páginas de perfil compartida por las rutas.
 *
 * La clave incluye la URL, el cursor y la página: es el mismo trozo de
 * listado que se pediría otra vez si el usuario reanaliza o si dos personas
 * abren el mismo perfil a la vez.
 */
export const profilePageCache = new TtlCache<unknown>({ maxEntries: 200 });

/** Clave de caché de una página de perfil. */
export function profilePageKey(url: string, cursor: string | null, page: number): string {
  return `${url}|${cursor ?? ""}|${page}`;
}
