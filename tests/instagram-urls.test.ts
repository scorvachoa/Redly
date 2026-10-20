import { describe, expect, it } from "vitest";

import {
  extractInstagramPostId,
  inputToInstagramUrl,
  isInstagramPostUrl,
  isInstagramProfileUrl,
  isInstagramUrl,
} from "@/lib/instagram-urls";

const REEL = "https://www.instagram.com/reel/DeMbuYlBfMk/";
const POST = "https://www.instagram.com/p/DeX9ayNujGE/";

describe("isInstagramUrl", () => {
  it("reconoce el host principal y subdominios", () => {
    expect(isInstagramUrl("https://www.instagram.com/nasa/")).toBe(true);
    expect(isInstagramUrl("https://instagram.com/reel/DeMbuYlBfMk")).toBe(true);
    expect(isInstagramUrl("https://m.instagram.com/p/DeX9ayNujGE/")).toBe(true);
    expect(isInstagramUrl("https://instagr.am/p/DeX9ayNujGE/")).toBe(true);
  });

  it("rechaza otros hosts, esquemas y basura", () => {
    expect(isInstagramUrl("https://nottinstagram.com/reel/x")).toBe(false);
    expect(isInstagramUrl("https://example.com/p/x")).toBe(false);
    expect(isInstagramUrl("ftp://instagram.com/p/x")).toBe(false);
    expect(isInstagramUrl("no es una url")).toBe(false);
    expect(isInstagramUrl("")).toBe(false);
    expect(isInstagramUrl(null)).toBe(false);
    expect(isInstagramUrl(undefined)).toBe(false);
  });
});

describe("extractInstagramPostId", () => {
  it("extrae el código en todas las formas verificadas", () => {
    expect(extractInstagramPostId(REEL)).toBe("DeMbuYlBfMk");
    expect(extractInstagramPostId("https://www.instagram.com/reels/DeMbuYlBfMk/")).toBe(
      "DeMbuYlBfMk",
    );
    expect(extractInstagramPostId(POST)).toBe("DeX9ayNujGE");
    expect(extractInstagramPostId("https://www.instagram.com/tv/DeMbuYlBfMk/")).toBe(
      "DeMbuYlBfMk",
    );
    expect(extractInstagramPostId("https://www.instagram.com/nasa/reel/DeIRiXbRVkh/")).toBe(
      "DeIRiXbRVkh",
    );
    expect(extractInstagramPostId(`${REEL}?igsh=ZWIxNWZjZWQwZA==`)).toBe("DeMbuYlBfMk");
    expect(extractInstagramPostId("https://www.instagram.com/reel/DeMbuYlBfMk")).toBe(
      "DeMbuYlBfMk",
    );
    // Enlace de comentario: `/p/<código>/c/<id>/`.
    expect(extractInstagramPostId("https://www.instagram.com/p/DeX9ayNujGE/c/17958174237/")).toBe(
      "DeX9ayNujGE",
    );
  });

  it("devuelve null donde no hay código de publicación", () => {
    expect(extractInstagramPostId("https://www.instagram.com/")).toBeNull();
    expect(extractInstagramPostId("https://www.instagram.com/nasa/")).toBeNull();
    expect(extractInstagramPostId("https://www.instagram.com/explore/tags/cats/")).toBeNull();
    expect(extractInstagramPostId("https://example.com/p/DeX9ayNujGE/")).toBeNull();
    expect(extractInstagramPostId("")).toBeNull();
    expect(extractInstagramPostId(null)).toBeNull();
  });
});

describe("isInstagramPostUrl", () => {
  it("marca como publicación los reels y los /p/", () => {
    expect(isInstagramPostUrl(REEL)).toBe(true);
    expect(isInstagramPostUrl(POST)).toBe(true);
    expect(isInstagramPostUrl("https://www.instagram.com/nasa/")).toBe(false);
  });
});

describe("isInstagramProfileUrl", () => {
  it("una ruta única no reservada es perfil", () => {
    expect(isInstagramProfileUrl("https://www.instagram.com/nasa/")).toBe(true);
    expect(isInstagramProfileUrl("https://www.instagram.com/nasa/?hl=en")).toBe(true);
  });

  it("las secciones reservadas no son perfil", () => {
    expect(isInstagramProfileUrl("https://www.instagram.com/explore/")).toBe(false);
    expect(isInstagramProfileUrl("https://www.instagram.com/reel/DeMbuYlBfMk/")).toBe(false);
    expect(isInstagramProfileUrl("https://www.instagram.com/nasa/reels/")).toBe(false);
    expect(isInstagramProfileUrl("https://www.instagram.com/")).toBe(false);
    expect(isInstagramProfileUrl("https://example.com/nasa")).toBe(false);
  });
});

describe("inputToInstagramUrl", () => {
  it("añade https:// a entradas pegadas sin esquema", () => {
    expect(inputToInstagramUrl("instagram.com/reel/DeMbuYlBfMk/")).toBe(
      "https://instagram.com/reel/DeMbuYlBfMk/",
    );
    expect(inputToInstagramUrl("www.instagram.com/p/DeX9ayNujGE/")).toBe(
      "https://www.instagram.com/p/DeX9ayNujGE/",
    );
  });

  it("conserva las entradas con esquema y las que no son de Instagram", () => {
    expect(inputToInstagramUrl(REEL)).toBe(REEL);
    expect(inputToInstagramUrl("https://example.com/p/x")).toBe("https://example.com/p/x");
    expect(inputToInstagramUrl("   ")).toBe("");
  });
});
