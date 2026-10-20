import { describe, expect, it } from "vitest";

import {
  extractFacebookVideoId,
  inputToFacebookUrl,
  isFacebookProfileUrl,
  isFacebookUrl,
  isFacebookVideoUrl,
} from "@/lib/facebook-urls";

const WATCH = "https://www.facebook.com/watch/?v=10153231379946729";
const SHORT = "https://fb.watch/abc123XYZ/";

describe("isFacebookUrl", () => {
  it("acepta los host oficiales de Facebook", () => {
    expect(isFacebookUrl(WATCH)).toBe(true);
    expect(isFacebookUrl("https://m.facebook.com/story.php?story_fbid=1&id=2")).toBe(true);
    expect(isFacebookUrl("https://fb.com/watch/?v=1")).toBe(true);
    expect(isFacebookUrl("https://fb.watch/abc123/")).toBe(true);
  });

  it("rechaza otras webs", () => {
    expect(isFacebookUrl("https://example.com/watch/?v=1")).toBe(false);
    expect(isFacebookUrl("https://facebook.example.com/x")).toBe(false);
    expect(isFacebookUrl("facebook")).toBe(false);
  });
});

describe("extractFacebookVideoId", () => {
  it("extrae el id de cada forma de enlace de vídeo", () => {
    expect(extractFacebookVideoId(WATCH)).toBe("10153231379946729");
    expect(extractFacebookVideoId("https://www.facebook.com/reel/1234567890123456")).toBe(
      "1234567890123456",
    );
    expect(extractFacebookVideoId("https://www.facebook.com/videos/9876543210/")).toBe(
      "9876543210",
    );
    expect(
      extractFacebookVideoId(
        "https://www.facebook.com/story.php?story_fbid=111222333&id=444555666",
      ),
    ).toBe("111222333");
    expect(extractFacebookVideoId("https://www.facebook.com/share/v/AbC123def/")).toBe("AbC123def");
    expect(extractFacebookVideoId("https://fb.watch/xyZ987/")).toBe("xyZ987");
  });

  it("devuelve null en páginas y enlaces rotos", () => {
    expect(extractFacebookVideoId("https://www.facebook.com/somepage")).toBeNull();
    expect(extractFacebookVideoId("https://www.facebook.com/profile.php?id=123")).toBeNull();
    expect(extractFacebookVideoId("https://www.facebook.com/videos/")).toBeNull();
    expect(extractFacebookVideoId("https://www.facebook.com/share/")).toBeNull();
    expect(extractFacebookVideoId("")).toBeNull();
  });
});

describe("isFacebookVideoUrl", () => {
  it("reconoce watch, reels, videos, story y fb.watch", () => {
    expect(isFacebookVideoUrl(WATCH)).toBe(true);
    expect(isFacebookVideoUrl("https://www.facebook.com/reel/1234567890")).toBe(true);
    expect(isFacebookVideoUrl("https://www.facebook.com/videos/123/")).toBe(true);
    expect(isFacebookVideoUrl("https://fb.watch/abc123/")).toBe(true);
  });

  it("rechaza páginas y perfiles", () => {
    expect(isFacebookVideoUrl("https://www.facebook.com/somepage")).toBe(false);
    expect(isFacebookVideoUrl("https://www.facebook.com/profile.php?id=1")).toBe(false);
    // `/watch` reservado sin `v=` no es vídeo.
    expect(isFacebookVideoUrl("https://www.facebook.com/watch/")).toBe(false);
  });
});

describe("isFacebookProfileUrl", () => {
  it("reconoce páginas y `profile.php`", () => {
    expect(isFacebookProfileUrl("https://www.facebook.com/Nasa")).toBe(true);
    expect(isFacebookProfileUrl("https://www.facebook.com/nasa/")).toBe(true);
    expect(isFacebookProfileUrl("https://www.facebook.com/profile.php?id=123")).toBe(true);
  });

  it("rechaza enlaces de vídeo y rutas reservadas", () => {
    expect(isFacebookProfileUrl(WATCH)).toBe(false);
    expect(isFacebookProfileUrl("https://www.facebook.com/watch/")).toBe(false);
    expect(isFacebookProfileUrl("https://www.facebook.com/reel/1234567890")).toBe(false);
    expect(isFacebookProfileUrl("")).toBe(false);
  });
});

describe("inputToFacebookUrl", () => {
  it("completa el esquema en entradas pegadas sin https", () => {
    expect(inputToFacebookUrl("facebook.com/watch/?v=1")).toBe(
      "https://facebook.com/watch/?v=1",
    );
    expect(inputToFacebookUrl("  fb.watch/abc123/  ")).toBe("https://fb.watch/abc123/");
  });

  it("respeta las URLs ya normalizadas", () => {
    expect(inputToFacebookUrl(WATCH)).toBe(WATCH);
    expect(inputToFacebookUrl("  " + WATCH + "  ")).toBe(WATCH);
  });

  it("devuelve otras entradas sin tocar", () => {
    expect(inputToFacebookUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(inputToFacebookUrl("hola")).toBe("hola");
  });
});
