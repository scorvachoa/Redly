import { describe, expect, it } from "vitest";

import { classifyInput, URL_RULES } from "@/lib/urlrules";

const ID = "dQw4w9WgXcQ";

describe("registro de reglas", () => {
  it("cubre las plataformas que tienen fuente", () => {
    expect(URL_RULES.map((rules) => rules.slug)).toEqual(["tiktok", "youtube"]);
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

  it("devuelve null para entradas sin reglas conocidas", () => {
    expect(classifyInput("https://example.com/video/1")).toBeNull();
    expect(classifyInput("https://facebook.com/watch/?v=1")).toBeNull();
    expect(classifyInput("esto no es una URL")).toBeNull();
    expect(classifyInput("")).toBeNull();
    expect(classifyInput("   ")).toBeNull();
    expect(classifyInput(null)).toBeNull();
    expect(classifyInput(undefined)).toBeNull();
  });
});
