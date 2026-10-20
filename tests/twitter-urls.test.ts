import { describe, expect, it } from "vitest";

import {
  extractTweetId,
  inputToTwitterUrl,
  isTweetUrl,
  isTwitterProfileUrl,
  isTwitterUrl,
} from "@/lib/twitter-urls";

const TWEET = "https://x.com/SpaceX/status/2109957980011552839";

describe("isTwitterUrl", () => {
  it("reconoce x.com y twitter.com con cualquier subdominio", () => {
    expect(isTwitterUrl(TWEET)).toBe(true);
    expect(isTwitterUrl("https://twitter.com/SpaceX")).toBe(true);
    expect(isTwitterUrl("https://www.x.com/a/status/123456")).toBe(true);
    expect(isTwitterUrl("https://mobile.twitter.com/a/status/123456")).toBe(true);
  });

  it("rechaza otros hosts, esquemas y entradas vacías", () => {
    expect(isTwitterUrl("https://example.com/user/status/123456")).toBe(false);
    expect(isTwitterUrl("https://t.co/abc")).toBe(false);
    expect(isTwitterUrl("ftp://x.com/user/status/123456")).toBe(false);
    expect(isTwitterUrl("no es una url")).toBe(false);
    expect(isTwitterUrl("")).toBe(false);
    expect(isTwitterUrl(null)).toBe(false);
    expect(isTwitterUrl(undefined)).toBe(false);
  });
});

describe("extractTweetId / isTweetUrl", () => {
  it("extrae el id de un tweet en todas sus formas", () => {
    expect(extractTweetId(TWEET)).toBe("2109957980011552839");
    expect(extractTweetId("https://twitter.com/SpaceX/status/2109957980011552839")).toBe(
      "2109957980011552839",
    );
    expect(extractTweetId("https://x.com/i/status/2109957980011552839")).toBe(
      "2109957980011552839",
    );
    expect(extractTweetId("https://x.com/SpaceX/status/2109957980011552839/photo/1")).toBe(
      "2109957980011552839",
    );
    expect(extractTweetId("https://x.com/SpaceX/status/2109957980011552839?s=20")).toBe(
      "2109957980011552839",
    );
  });

  it("devuelve null cuando no hay status o el id no es numérico", () => {
    expect(extractTweetId("https://x.com/SpaceX")).toBeNull();
    expect(extractTweetId("https://x.com/SpaceX/status/abc")).toBeNull();
    expect(extractTweetId("https://x.com/search?q=x")).toBeNull();
    expect(extractTweetId("https://example.com/a/status/123456")).toBeNull();
    expect(isTweetUrl(TWEET)).toBe(true);
    expect(isTweetUrl("https://x.com/SpaceX")).toBe(false);
  });
});

describe("isTwitterProfileUrl", () => {
  it("una ruta única no reservada es perfil", () => {
    expect(isTwitterProfileUrl("https://x.com/SpaceX")).toBe(true);
    expect(isTwitterProfileUrl("https://twitter.com/nasa/")).toBe(true);
  });

  it("las secciones reservadas no son perfil", () => {
    expect(isTwitterProfileUrl("https://x.com/search?q=x")).toBe(false);
    expect(isTwitterProfileUrl("https://x.com/hashtag/cats")).toBe(false);
    expect(isTwitterProfileUrl("https://x.com/i/status/123456")).toBe(false);
    expect(isTwitterProfileUrl("https://x.com/SpaceX/status/123456")).toBe(false);
  });
});

describe("inputToTwitterUrl", () => {
  it("acepta la URL a secas y la completa con https", () => {
    expect(inputToTwitterUrl("x.com/SpaceX/status/2109957980011552839")).toBe(
      "https://x.com/SpaceX/status/2109957980011552839",
    );
    expect(inputToTwitterUrl("twitter.com/SpaceX")).toBe("https://twitter.com/SpaceX");
  });

  it("conserva las URLs con esquema y las entradas ajenas", () => {
    expect(inputToTwitterUrl(TWEET)).toBe(TWEET);
    expect(inputToTwitterUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(inputToTwitterUrl("   ")).toBe("");
  });
});
