import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimiter, apiLimiter, clientKey } from "@/lib/ratelimit";

describe("RateLimiter", () => {
  it("admite hasta el máximo dentro de la ventana", () => {
    const limiter = new RateLimiter({ windowSeconds: 60, max: 3 });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);

    const denied = limiter.check("a");
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("las claves no se contaminan entre sí", () => {
    const limiter = new RateLimiter({ windowSeconds: 60, max: 1 });

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    // Otra clave sigue con su cuota entera.
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("el contador de restantes baja con cada uso", () => {
    const limiter = new RateLimiter({ windowSeconds: 60, max: 3 });

    expect(limiter.check("a").remaining).toBe(2);
    expect(limiter.check("a").remaining).toBe(1);
    expect(limiter.check("a").remaining).toBe(0);
  });

  it("libera cuota cuando la ventana avanza", () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter({ windowSeconds: 1, max: 1 });

      expect(limiter.check("a").allowed).toBe(true);
      expect(limiter.check("a").allowed).toBe(false);

      // Un segundo después, la marca antigua ya salió de la ventana.
      vi.advanceTimersByTime(1100);
      expect(limiter.check("a").allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechaza opciones inválidas al construir", () => {
    expect(() => new RateLimiter({ windowSeconds: 0, max: 1 })).toThrow(RangeError);
    expect(() => new RateLimiter({ windowSeconds: 1, max: 0 })).toThrow(RangeError);
    expect(() => new RateLimiter({ windowSeconds: Number.NaN, max: 1 })).toThrow(RangeError);
  });

  it("purga las claves cuya ventana caducó por completo", () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter({ windowSeconds: 1, max: 5 });
      limiter.check("a");
      expect(limiter.size).toBe(1);

      // Pasan dos ventanas: al siguiente acceso la clave muerta se borra.
      vi.advanceTimersByTime(2500);
      limiter.check("b");
      expect(limiter.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("peek no consume cuota", () => {
    const limiter = new RateLimiter({ windowSeconds: 60, max: 2 });

    expect(limiter.peek("a")).toBe(2);
    expect(limiter.peek("a")).toBe(2);
    limiter.check("a");
    expect(limiter.peek("a")).toBe(1);
  });
});

describe("clientKey", () => {
  function requestWith(headers: Record<string, string>): Request {
    return new Request("http://localhost/api", { headers });
  }

  it("usa la primera IP de x-forwarded-for", () => {
    const request = requestWith({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(clientKey(request)).toBe("203.0.113.9");
  });

  it("cae a x-real-ip si no hay forwarded", () => {
    const request = requestWith({ "x-real-ip": "198.51.100.7" });
    expect(clientKey(request)).toBe("198.51.100.7");
  });

  it("usa 'unknown' sin cabeceras de proxy", () => {
    expect(clientKey(requestWith({}))).toBe("unknown");
  });

  it("una primera IP vacía se trata como desconocida, sin fiarse del resto", () => {
    // Si se colapsara a la siguiente entrada, un atacante podría culpar con
    // `X-Forwarded-For: , <ip-de-otro>` y agotarle la cuota a un tercero.
    const request = requestWith({ "x-forwarded-for": "  , 10.0.0.1" });
    expect(clientKey(request)).toBe("unknown");
  });
});

describe("apiLimiter", () => {
  beforeEach(() => apiLimiter.reset());
  afterEach(() => apiLimiter.reset());

  it("es una sola instancia compartida entre rutas", () => {
    expect(apiLimiter.check("test-shared").allowed).toBe(true);
    // Una segunda "ruta" ve la misma ventana: el límite no se elude repartiendo.
    expect(apiLimiter.check("test-shared").allowed).toBe(true);
    expect(apiLimiter.check("test-shared").allowed).toBe(true);
  });
});
