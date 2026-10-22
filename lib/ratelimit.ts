/**
 * Límite de peticiones por cliente, en memoria.
 *
 * **Por qué en memoria y no en Redis**: hoy no hay base de datos ni cola, y
 * añadir un almacén externo para esto sería desproporcionado. La consecuencia
 * honesta es que en serverless el límite es **por instancia de la función**:
 * con N instancias frías el tope real puede ser N veces mayor. Sigue siendo
 * útil —frena el abuso desde un mismo cliente y la rotación de una IP— pero
 * **no** es un límite global. Si llega el momento de necesitarlo, sólo hay que
 * sustituir la clase `RateLimiter` por otra implementación de la misma
 * interfaz: las rutas no se enteran.
 *
 * Algoritmo: ventana deslizante con marcas de tiempo. Ocupa un número acotado
 * de entradas por clave (una por evento dentro de la ventana), de modo que un
 * cliente muy activo no crece sin control.
 */

export interface RateLimitOptions {
  /** Longitud de la ventana, en segundos. */
  windowSeconds: number;
  /** Peticiones admitidas dentro de la ventana. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Cuántas quedan disponibles tras esta comprobación. */
  remaining: number;
  /** Segundos hasta poder volver a intentarlo (0 si está permitido). */
  retryAfterSeconds: number;
}

/**
 * Límite de tasa en memoria, por clave.
 *
 * La ventana se mantiene como un array de marcas de tiempo por clave, recortado
 * en cada acceso. Un `Map` con borrado diferido evita que las claves muertas
 * se acumulen.
 */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(options: RateLimitOptions) {
    if (!Number.isFinite(options.windowSeconds) || options.windowSeconds <= 0) {
      throw new RangeError("windowSeconds debe ser > 0");
    }
    if (!Number.isFinite(options.max) || options.max <= 0) {
      throw new RangeError("max debe ser > 0");
    }
    this.windowMs = options.windowSeconds * 1000;
    this.max = Math.floor(options.max);
  }

  /**
   * Registra un intento y decide si se admite.
   *
   * Llamar **una sola vez** por petición: la propia comprobación consume
   * cuota, así que reintentar dentro del handler contaría dos veces.
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    this.sweep(now);

    const stamp = this.hits.get(key) ?? [];
    const cutoff = now - this.windowMs;
    // Se descartan las marcas que ya salieron de la ventana.
    let first = 0;
    while (first < stamp.length && stamp[first] <= cutoff) first += 1;
    const recent = first > 0 ? stamp.slice(first) : stamp;

    if (recent.length >= this.max) {
      const oldest = recent[0];
      const retryAfterMs = oldest + this.windowMs - now;
      this.hits.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      remaining: this.max - recent.length,
      retryAfterSeconds: 0,
    };
  }

  /** Cuántas peticiones se admiten todavía para esa clave en esta ventana. */
  peek(key: string): number {
    const now = Date.now();
    const stamp = this.hits.get(key);
    if (!stamp) return this.max;
    const cutoff = now - this.windowMs;
    const recent = stamp.filter((value) => value > cutoff);
    return Math.max(0, this.max - recent.length);
  }

  /** Vacía todas las claves (sólo para tests). */
  reset(): void {
    this.hits.clear();
    this.lastSweep = 0;
  }

  /** Número de claves con actividad reciente (sólo para tests/telemetría). */
  get size(): number {
    return this.hits.size;
  }

  /**
   * Borra las claves cuya ventana ya caducó por completo.
   *
   * Se ejecuta como mucho una vez por ventana para no recorrer el mapa en
   * cada petición.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    const cutoff = now - this.windowMs;
    for (const [key, stamp] of this.hits) {
      if (stamp.length === 0 || stamp[stamp.length - 1] <= cutoff) {
        this.hits.delete(key);
      }
    }
  }
}

/**
 * Clave de cliente a partir de una petición.
 *
 * Usa `x-forwarded-for` (que es lo que Vercel y la mayoría de proxies ponen),
 * tomando la primera IP. En local, sin proxy, cae a `unknown`: todas las
 * peticiones comparten cuota, que es el comportamiento esperado en dev.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Limitador compartido por las rutas de la API.
 *
 * Una sola instancia por módulo para que todas las rutas compartan la misma
 * ventana por cliente: un atacante que reparta peticiones entre `/api/search`
 * y `/api/profile` no elude el límite.
 */
export const apiLimiter = new RateLimiter({
  windowSeconds: Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
  max: Number(process.env.RATE_LIMIT_MAX ?? 30),
});

/**
 * Limitador del bot de Telegram, por `chat.id`.
 *
 * Clave separada de `apiLimiter`: el webhook llega de los servidores de
 * Telegram (la IP no distingue entre usuarios), así que la cuota se acota por
 * chat, que es el sujeto real del abuso.
 */
export const telegramLimiter = new RateLimiter({
  windowSeconds: Number(process.env.TELEGRAM_RATE_LIMIT_WINDOW_SECONDS ?? 60),
  max: Number(process.env.TELEGRAM_RATE_LIMIT_MAX ?? 20),
});
