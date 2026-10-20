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
  it("sólo están registradas las fuentes verificadas", () => {
    // Sólo se registra lo que se ha comprobado empíricamente.
    expect(allSources().map((source) => source.id)).toEqual([
      "tiktok",
      "snapyt",
      "fsave",
      "instagram",
      "ilovex",
      "savethreads",
    ]);
  });

  it("la fuente registrada declara la plataforma que sirve", () => {
    const source = sourceForPlatform("tiktok");
    expect(source).not.toBeNull();
    expect(sourceSupports(source!, "tiktok")).toBe(true);
    expect(sourceSupports(source!, "youtube")).toBe(false);
  });

  it("devuelve null para plataformas sin fuente verificada", () => {
    // Las plataformas sin fuente no entran en el registro.
    expect(sourceForPlatform("")).toBeNull();
    expect(sourceForPlatform(null)).toBeNull();
    expect(sourceForPlatform(undefined)).toBeNull();
  });

  it("Facebook se sirve con FSave, sólo vídeos", () => {
    const source = sourceForPlatform("facebook");
    expect(source).not.toBeNull();
    expect(source!.id).toBe("fsave");
    expect(sourceSupports(source!, "facebook")).toBe(true);
    expect(sourceSupports(source!, "tiktok")).toBe(false);
    // Sin listados de páginas de Facebook.
    expect(source!.supportsProfiles).toBe(false);
  });

  it("Instagram se sirve con IGExport (y respaldo de LoveInsta), sólo publicaciones", () => {
    const source = sourceForPlatform("instagram");
    expect(source).not.toBeNull();
    expect(source!.id).toBe("instagram");
    expect(sourceSupports(source!, "instagram")).toBe(true);
    expect(sourceSupports(source!, "facebook")).toBe(false);
    // Sin listados de páginas de Instagram.
    expect(source!.supportsProfiles).toBe(false);
  });

  it("X se sirve con iLoveX, sólo tweets", () => {
    const source = sourceForPlatform("twitter");
    expect(source).not.toBeNull();
    expect(source!.id).toBe("ilovex");
    expect(sourceSupports(source!, "twitter")).toBe(true);
    expect(sourceSupports(source!, "tiktok")).toBe(false);
    // Sin listados de perfiles de X.
    expect(source!.supportsProfiles).toBe(false);
  });

  it("Threads se sirve con SaveThreads, sólo publicaciones", () => {
    const source = sourceForPlatform("threads");
    expect(source).not.toBeNull();
    expect(source!.id).toBe("savethreads");
    expect(sourceSupports(source!, "threads")).toBe(true);
    expect(sourceSupports(source!, "tiktok")).toBe(false);
    // Sin listados de perfiles de Threads.
    expect(source!.supportsProfiles).toBe(false);
  });

  it("ignora mayúsculas y espacios en el slug", () => {
    expect(sourceForPlatform(" TikTok ")?.id).toBe("tiktok");
    expect(sourceForPlatform("TIKTOK")?.id).toBe("tiktok");
    expect(sourceForPlatform(" YouTube ")?.id).toBe("snapyt");
  });

  it("declara qué fuentes admiten listados de perfil", () => {
    // TikTok pagina perfiles; YouTube lista listas de reproducción (perfiles).
    expect(sourceForPlatform("tiktok")?.supportsProfiles).toBe(true);
    expect(sourceForPlatform("youtube")?.supportsProfiles).toBe(true);
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
    expect(sourceForUrl("https://www.tiktok.com/@user/video/1")?.id).toBe("tiktok");
    expect(platformForUrl("https://www.tiktok.com/@user")?.slug).toBe("tiktok");
  });

  it("una URL de YouTube resuelve la fuente verificada (SnapYT)", () => {
    expect(sourceForUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.id).toBe("snapyt");
    expect(platformForUrl("https://youtu.be/dQw4w9WgXcQ")?.slug).toBe("youtube");
  });

  it("una URL de Facebook resuelve la fuente verificada (FSave)", () => {
    expect(sourceForUrl("https://www.facebook.com/watch/?v=10153231379946729")?.id).toBe("fsave");
    expect(platformForUrl("https://fb.watch/abc123/")?.slug).toBe("facebook");
  });

  it("una URL de Instagram resuelve la fuente verificada (IGExport + respaldo)", () => {
    expect(sourceForUrl("https://www.instagram.com/reel/DeMbuYlBfMk/")?.id).toBe("instagram");
    expect(platformForUrl("https://instagram.com/p/DeX9ayNujGE/")?.slug).toBe("instagram");
  });

  it("una URL de X resuelve la fuente verificada (iLoveX)", () => {
    expect(sourceForUrl("https://x.com/SpaceX/status/2109957980011552839")?.id).toBe("ilovex");
    expect(platformForUrl("https://twitter.com/SpaceX")?.slug).toBe("twitter");
  });

  it("una URL de Threads resuelve la fuente verificada (SaveThreads)", () => {
    expect(sourceForUrl("https://www.threads.com/@user/post/AbC123_xYz")?.id).toBe("savethreads");
    expect(platformForUrl("https://www.threads.net/@user/post/AbC123_xYz")?.slug).toBe("threads");
  });

  it("una URL desconocida devuelve null en ambos", () => {
    expect(sourceForUrl("https://ejemplo.com")).toBeNull();
    expect(platformForUrl("https://ejemplo.com")).toBeNull();
  });
});
