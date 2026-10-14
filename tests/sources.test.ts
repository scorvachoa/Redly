import { describe, expect, it } from "vitest";

import {
  allSources,
  detectPlatformSlug,
  platformForUrl,
  sourceForPlatform,
  sourceForUrl,
  sourceSupports,
} from "@/lib/sources";

describe("registro de fuentes", () => {
  it("sólo está registrada la fuente verificada", () => {
    // base.md §2: sólo se registra lo que se ha comprobado empíricamente.
    expect(allSources().map((source) => source.id)).toEqual(["savetikpro"]);
  });

  it("la fuente registrada declara la plataforma que sirve", () => {
    const source = sourceForPlatform("tiktok");
    expect(source).not.toBeNull();
    expect(sourceSupports(source!, "tiktok")).toBe(true);
    expect(sourceSupports(source!, "youtube")).toBe(false);
  });

  it("devuelve null para plataformas sin fuente verificada", () => {
    // Existen en la navegación con ready:false, pero no tienen fuente.
    expect(sourceForPlatform("youtube")).toBeNull();
    expect(sourceForPlatform("instagram")).toBeNull();
    expect(sourceForPlatform("")).toBeNull();
    expect(sourceForPlatform(null)).toBeNull();
    expect(sourceForPlatform(undefined)).toBeNull();
  });

  it("ignora mayúsculas y espacios en el slug", () => {
    expect(sourceForPlatform(" TikTok ")?.id).toBe("savetikpro");
    expect(sourceForPlatform("TIKTOK")?.id).toBe("savetikpro");
  });
});

describe("detectPlatformSlug", () => {
  it("reconoce el host principal de cada plataforma", () => {
    expect(detectPlatformSlug("https://www.tiktok.com/@user")).toBe("tiktok");
    expect(detectPlatformSlug("https://youtube.com/watch?v=x")).toBe("youtube");
    expect(detectPlatformSlug("https://instagram.com/p/x")).toBe("instagram");
    expect(detectPlatformSlug("https://x.com/user/status/1")).toBe("twitter");
  });

  it("reconoce subdominios (enlaces cortos)", () => {
    expect(detectPlatformSlug("https://vm.tiktok.com/abc/")).toBe("tiktok");
    expect(detectPlatformSlug("https://vt.tiktok.com/abc/")).toBe("tiktok");
    expect(detectPlatformSlug("https://m.youtube.com/watch?v=x")).toBe("youtube");
    expect(detectPlatformSlug("https://fb.watch/abc")).toBe("facebook");
  });

  it("devuelve null para URLs basura o desconocidas", () => {
    expect(detectPlatformSlug("no es una url")).toBeNull();
    expect(detectPlatformSlug("https://ejemplo.com/@user")).toBeNull();
    expect(detectPlatformSlug("")).toBeNull();
    expect(detectPlatformSlug(null)).toBeNull();
    expect(detectPlatformSlug(undefined)).toBeNull();
  });

  it("no confunde un host que termina igual pero no es subdominio", () => {
    // nottiktok.com no debe casar con tiktok.com.
    expect(detectPlatformSlug("https://nottiktok.com/@user")).toBeNull();
    expect(detectPlatformSlug("https://eviltiktok.com/@user")).toBeNull();
  });
});

describe("sourceForUrl / platformForUrl", () => {
  it("una URL de TikTok resuelve la fuente verificada", () => {
    expect(sourceForUrl("https://www.tiktok.com/@user/video/1")?.id).toBe("savetikpro");
    expect(platformForUrl("https://www.tiktok.com/@user")?.slug).toBe("tiktok");
  });

  it("una plataforma sin fuente devuelve null aunque exista en la navegación", () => {
    expect(sourceForUrl("https://youtube.com/watch?v=x")).toBeNull();
    // La plataforma sí está registrada (para la UI), pero no hay fuente.
    expect(platformForUrl("https://youtube.com/watch?v=x")?.slug).toBe("youtube");
  });

  it("una URL desconocida devuelve null en ambos", () => {
    expect(sourceForUrl("https://ejemplo.com")).toBeNull();
    expect(platformForUrl("https://ejemplo.com")).toBeNull();
  });
});
