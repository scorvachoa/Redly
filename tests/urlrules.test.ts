import { describe, expect, it } from "vitest";

import { classifyInput, URL_RULES } from "@/lib/urlrules";

const ID = "dQw4w9WgXcQ";

describe("registro de reglas", () => {
  it("cubre las plataformas que tienen fuente", () => {
    expect(URL_RULES.map((rules) => rules.slug)).toEqual([
      "tiktok",
      "youtube",
      "facebook",
      "instagram",
      "twitter",
      "threads",
    ]);
  });
});

describe("classifyInput", () => {
  it("clasifica un vídeo de TikTok", () => {
    const classified = classifyInput("https://www.tiktok.com/@scout2015/video/6718335390845095173");

    expect(classified).not.toBeNull();
    expect(classified!.slug).toBe("tiktok");
    expect(classified!.kind).toBe("video");
  });

  it("normaliza el @usuario de TikTok antes de clasificar", () => {
    const classified = classifyInput("@scout2015");

    expect(classified?.slug).toBe("tiktok");
    expect(classified?.kind).toBe("profile");
    expect(classified?.url).toBe("https://www.tiktok.com/@scout2015");
  });

  it("reconoce los enlaces cortos de TikTok como vídeo", () => {
    const classified = classifyInput("https://vm.tiktok.com/ZMabcdef/");

    expect(classified?.kind).toBe("video");
  });

  it("clasifica vídeos de YouTube en todas sus formas", () => {
    const urls = [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
    ];
    for (const url of urls) {
      const classified = classifyInput(url);
      expect(classified?.slug).toBe("youtube");
      expect(classified?.kind).toBe("video");
    }
  });

  it("clasifica un canal de YouTube como perfil", () => {
    const classified = classifyInput("https://www.youtube.com/@rickastley");

    expect(classified?.slug).toBe("youtube");
    expect(classified?.kind).toBe("profile");
  });

  it("clasifica una lista de reproducción de YouTube como perfil", () => {
    const classified = classifyInput("https://www.youtube.com/playlist?list=PL1");

    expect(classified?.slug).toBe("youtube");
    expect(classified?.kind).toBe("profile");
  });

  it("un watch con list= sigue siendo vídeo (manda el id)", () => {
    const classified = classifyInput(`https://www.youtube.com/watch?v=${ID}&list=PL1`);

    expect(classified?.kind).toBe("video");
  });

  it("marca como unsupported lo que no es vídeo ni perfil", () => {
    expect(classifyInput("https://www.youtube.com/")?.kind).toBe("unsupported");
    expect(classifyInput("https://www.youtube.com/results?search_query=x")?.kind).toBe(
      "unsupported",
    );
  });

  it("recorta los espacios exteriores de la entrada", () => {
    const classified = classifyInput(`  https://youtu.be/${ID}  `);

    expect(classified?.url).toBe(`https://youtu.be/${ID}`);
  });

  it("clasifica enlaces de Facebook en todas sus formas", () => {
    const urls = [
      "https://www.facebook.com/watch/?v=10153231379946729",
      "https://www.facebook.com/reel/10153231379946729",
      "https://www.facebook.com/videos/10153231379946729/",
      "https://fb.watch/abc123XYZ/",
    ];
    for (const url of urls) {
      const classified = classifyInput(url);
      expect(classified?.slug).toBe("facebook");
      expect(classified?.kind).toBe("video");
    }
  });

  it("clasifica una página de Facebook como perfil", () => {
    const classified = classifyInput("https://www.facebook.com/NASA");

    expect(classified?.slug).toBe("facebook");
    expect(classified?.kind).toBe("profile");
    expect(classified?.url).toBe("https://www.facebook.com/NASA");
  });

  it("normaliza entradas de Facebook pegadas sin esquema", () => {
    const classified = classifyInput("facebook.com/watch/?v=10153231379946729");

    expect(classified?.slug).toBe("facebook");
    expect(classified?.kind).toBe("video");
    expect(classified?.url).toBe("https://facebook.com/watch/?v=10153231379946729");
  });

  it("marca como unsupported las secciones de Facebook sin vídeo", () => {
    expect(classifyInput("https://www.facebook.com/")?.kind).toBe("unsupported");
    expect(classifyInput("https://www.facebook.com/watch/")?.kind).toBe("unsupported");
    expect(classifyInput("https://www.facebook.com/groups/123456/")?.kind).toBe("unsupported");
  });

  it("clasifica reels y publicaciones de Instagram en todas sus formas", () => {
    const urls = [
      "https://www.instagram.com/reel/DeMbuYlBfMk/",
      "https://www.instagram.com/reels/DeMbuYlBfMk/",
      "https://www.instagram.com/p/DeX9ayNujGE/",
      "https://www.instagram.com/nasa/reel/DeIRiXbRVkh/",
      "https://www.instagram.com/reel/DeMbuYlBfMk/?igsh=ZWIxNWZjZWQwZA==",
      "https://m.instagram.com/reel/DeMbuYlBfMk",
    ];
    for (const url of urls) {
      const classified = classifyInput(url);
      expect(classified?.slug).toBe("instagram");
      expect(classified?.kind).toBe("video");
    }
  });

  it("clasifica un perfil de Instagram como perfil (sin listado aún)", () => {
    const classified = classifyInput("https://www.instagram.com/nasa/?hl=en");

    expect(classified?.slug).toBe("instagram");
    expect(classified?.kind).toBe("profile");
    expect(classified?.url).toBe("https://www.instagram.com/nasa/?hl=en");
  });

  it("normaliza entradas de Instagram pegadas sin esquema", () => {
    const classified = classifyInput("instagram.com/reel/DeMbuYlBfMk/");

    expect(classified?.slug).toBe("instagram");
    expect(classified?.kind).toBe("video");
    expect(classified?.url).toBe("https://instagram.com/reel/DeMbuYlBfMk/");
  });

  it("marca como unsupported las secciones de Instagram sin publicación", () => {
    expect(classifyInput("https://www.instagram.com/")?.kind).toBe("unsupported");
    expect(classifyInput("https://www.instagram.com/explore/tags/cats/")?.kind).toBe("unsupported");
    expect(classifyInput("https://www.instagram.com/nasa/reels/")?.kind).toBe("unsupported");
  });

  it("clasifica tweets de X en todas sus formas", () => {
    const urls = [
      "https://x.com/SpaceX/status/2109957980011552839",
      "https://twitter.com/SpaceX/status/2109957980011552839",
      "https://www.x.com/SpaceX/status/2109957980011552839?s=20",
      "https://mobile.twitter.com/SpaceX/status/2109957980011552839",
      "https://x.com/i/status/2109957980011552839",
    ];
    for (const url of urls) {
      const classified = classifyInput(url);
      expect(classified?.slug).toBe("twitter");
      expect(classified?.kind).toBe("video");
    }
  });

  it("clasifica un perfil de X como perfil (sin listado aún)", () => {
    const classified = classifyInput("https://x.com/SpaceX");

    expect(classified?.slug).toBe("twitter");
    expect(classified?.kind).toBe("profile");
    expect(classified?.url).toBe("https://x.com/SpaceX");
  });

  it("normaliza entradas de X pegadas sin esquema", () => {
    const classified = classifyInput("x.com/SpaceX/status/2109957980011552839");

    expect(classified?.slug).toBe("twitter");
    expect(classified?.kind).toBe("video");
    expect(classified?.url).toBe("https://x.com/SpaceX/status/2109957980011552839");
  });

  it("marca como unsupported las secciones de X sin tweet", () => {
    expect(classifyInput("https://x.com/")?.kind).toBe("unsupported");
    expect(classifyInput("https://x.com/search?q=cats")?.kind).toBe("unsupported");
    expect(classifyInput("https://x.com/hashtag/cats")?.kind).toBe("unsupported");
  });

  it("los enlaces cortos t.co no se clasifican (pueden apuntar a cualquier cosa)", () => {
    expect(classifyInput("https://t.co/cEtfLbVcP3")).toBeNull();
  });

  it("clasifica publicaciones de Threads en ambos dominios", () => {
    const urls = [
      "https://www.threads.com/@mileycyrus/post/DWSFx_jErAQ",
      "https://threads.net/@mileycyrus/post/DWSFx_jErAQ",
      "https://www.threads.com/@user/post/CODE_123/slug-legible",
      "https://m.threads.net/@user/post/DbXn8g1mA0T",
    ];
    for (const url of urls) {
      const classified = classifyInput(url);
      expect(classified?.slug).toBe("threads");
      expect(classified?.kind).toBe("video");
    }
  });

  it("clasifica un perfil de Threads como perfil (sin listado)", () => {
    const classified = classifyInput("https://www.threads.com/@mileycyrus?hl=en");

    expect(classified?.slug).toBe("threads");
    expect(classified?.kind).toBe("profile");
    expect(classified?.url).toBe("https://www.threads.com/@mileycyrus?hl=en");
  });

  it("normaliza entradas de Threads pegadas sin esquema", () => {
    const classified = classifyInput("threads.com/@user/post/AbC123_xYz");

    expect(classified?.slug).toBe("threads");
    expect(classified?.kind).toBe("video");
    expect(classified?.url).toBe("https://threads.com/@user/post/AbC123_xYz");
  });

  it("marca como unsupported las secciones de Threads sin publicación", () => {
    expect(classifyInput("https://www.threads.com/")?.kind).toBe("unsupported");
    expect(classifyInput("https://www.threads.com/search?q=cats")?.kind).toBe("unsupported");
    expect(classifyInput("https://www.threads.com/tag/cats")?.kind).toBe("unsupported");
  });

  it("devuelve null para entradas sin reglas conocidas", () => {
    expect(classifyInput("https://example.com/video/1")).toBeNull();
    expect(classifyInput("esto no es una URL")).toBeNull();
    expect(classifyInput("")).toBeNull();
    expect(classifyInput("   ")).toBeNull();
    expect(classifyInput(null)).toBeNull();
    expect(classifyInput(undefined)).toBeNull();
  });
});
