import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROFILE_PAGE_TTL_MS,
  TtlCache,
  profilePageCache,
  profilePageKey,
} from "@/lib/cache";

describe("TtlCache", () => {
  it("devuelve el valor guardado antes de caducar", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "v", 1000);

    expect(cache.get("k")).toBe("v");
    expect(cache.size).toBe(1);
  });

  it("devuelve undefined cuando la entrada caducó", () => {
    vi.useFakeTimers();
    try {
      const cache = new TtlCache<string>();
      cache.set("k", "v", 1000);

      vi.advanceTimersByTime(1001);
      expect(cache.get("k")).toBeUndefined();
      // La caducada se borra al acceder, no sigue ocupando sitio.
      expect(cache.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no cachea con TTL cero o negativo", () => {
    const cache = new TtlCache<string>();
    cache.set("a", "v", 0);
    cache.set("b", "v", -1);
    cache.set("c", "v", Number.NaN);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("respeta el techo de entradas descartando la menos usada", () => {
    const cache = new TtlCache<number>({ maxEntries: 2 });
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    // Al acceder a "a" se recoloca al final, así que "b" pasa a ser la más antigua.
    cache.get("a");
    cache.set("c", 3, 60_000);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("sobreescribe una clave existente sin duplicarla", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "uno", 60_000);
    cache.set("k", "dos", 60_000);

    expect(cache.size).toBe(1);
    expect(cache.get("k")).toBe("dos");
  });

  it("cuenta aciertos y fallos para la tasa", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "v", 60_000);

    cache.get("k"); // hit
    cache.get("no"); // miss

    expect(cache.hitCount).toBe(1);
    expect(cache.missCount).toBe(1);
    expect(cache.hitRate).toBeCloseTo(0.5);
  });

  it("hitRate es 0 sin accesos", () => {
    expect(new TtlCache<string>().hitRate).toBe(0);
  });

  it("clear vacía todo y reinicia contadores", () => {
    const cache = new TtlCache<string>();
    cache.set("k", "v", 60_000);
    cache.get("k");
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.hitCount).toBe(0);
    expect(cache.missCount).toBe(0);
    expect(cache.get("k")).toBeUndefined();
  });

  it("delete borra una entrada concreta", () => {
    const cache = new TtlCache<string>();
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.delete("a");

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
  });

  it("el techo por defecto es razonable si llega basura", () => {
    const cache = new TtlCache<string>({ maxEntries: 0 });
    // Se usa el valor por defecto en lugar de fallar.
    cache.set("k", "v", 60_000);
    expect(cache.get("k")).toBe("v");
  });
});

describe("profilePageCache", () => {
  beforeEach(() => profilePageCache.clear());
  afterEach(() => profilePageCache.clear());

  it("la clave distingue url, cursor y página", () => {
    const base = profilePageKey("https://x/@a", null, 1);

    expect(profilePageKey("https://x/@a", null, 1)).toBe(base);
    expect(profilePageKey("https://x/@a", "20", 1)).not.toBe(base);
    expect(profilePageKey("https://x/@a", null, 2)).not.toBe(base);
    expect(profilePageKey("https://x/@b", null, 1)).not.toBe(base);
  });

  it("el TTL por defecto es inferior a la vida del token (~1 h)", () => {
    // Si se cachea más tiempo que la vida del token, se servirían enlaces muertos.
    expect(PROFILE_PAGE_TTL_MS).toBeGreaterThan(0);
    expect(PROFILE_PAGE_TTL_MS).toBeLessThan(3_600_000);
  });

  it("sirve el mismo objeto en el segundo acceso", () => {
    const value = { items: [{ id: "1" }], nextCursor: null, page: 1 };
    profilePageCache.set("k", value, 60_000);

    expect(profilePageCache.get("k")).toBe(value);
  });
});
