import { describe, expect, it } from "vitest";

import { PLATFORMS, getPlatform, isReady } from "@/lib/platforms";

describe("registro de plataformas", () => {
  it("sólo TikTok está disponible para descarga", () => {
    const ready = PLATFORMS.filter((platform) => platform.ready);

    expect(ready).toHaveLength(1);
    expect(ready[0].slug).toBe("tiktok");
  });

  it("ninguna plataforma tiene transcripción implementada", () => {
    // No hay ninguna fuente comprobada de subtítulos: no se inventan endpoints.
    expect(PLATFORMS.filter((platform) => platform.transcriptReady)).toHaveLength(0);
  });

  it("los slugs son únicos y aptos para URL", () => {
    const slugs = PLATFORMS.map((platform) => platform.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe("getPlatform", () => {
  it("busca por slug, ignorando mayúsculas y espacios", () => {
    expect(getPlatform("tiktok")?.name).toBe("TikTok");
    expect(getPlatform(" TikTok ")?.slug).toBe("tiktok");
    expect(getPlatform("YOUTUBE")?.slug).toBe("youtube");
  });

  it("devuelve null para rutas desconocidas o vacías", () => {
    expect(getPlatform("noexiste")).toBeNull();
    expect(getPlatform("")).toBeNull();
    expect(getPlatform(null)).toBeNull();
    expect(getPlatform(undefined)).toBeNull();
  });
});

describe("isReady", () => {
  it("depende de la funcionalidad pedida", () => {
    const tiktok = getPlatform("tiktok")!;
    const youtube = getPlatform("youtube")!;

    expect(isReady(tiktok, "download")).toBe(true);
    expect(isReady(tiktok, "transcript")).toBe(false);
    expect(isReady(youtube, "download")).toBe(false);
    expect(isReady(youtube, "transcript")).toBe(false);
  });
});
