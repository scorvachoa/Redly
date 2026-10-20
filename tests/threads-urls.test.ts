import { describe, expect, it } from "vitest";

import {
  extractThreadsPostId,
  inputToThreadsUrl,
  isThreadsPostUrl,
  isThreadsProfileUrl,
  isThreadsUrl,
} from "@/lib/threads-urls";

describe("isThreadsUrl", () => {
  it("acepta los dos dominios oficiales y sus subdominios", () => {
    expect(isThreadsUrl("https://www.threads.com/@user/post/AbC123_xYz")).toBe(true);
    expect(isThreadsUrl("https://threads.net/@user/post/AbC123_xYz")).toBe(true);
    expect(isThreadsUrl("https://www.threads.net/@user/post/AbC123_xYz")).toBe(true);
    expect(isThreadsUrl("https://mobile.threads.com/@user/post/AbC123_xYz")).toBe(true);
  });

  it("rechaza otras webs y esquemas", () => {
    expect(isThreadsUrl("https://example.com/@user/post/AbC123")).toBe(false);
    expect(isThreadsUrl("https://notthreads.com/@user/post/AbC123")).toBe(false);
    expect(isThreadsUrl("http://threads.com/@user/post/AbC123")).toBe(true);
    expect(isThreadsUrl("ftp://threads.com/@user/post/AbC123")).toBe(false);
    expect(isThreadsUrl("")).toBe(false);
    expect(isThreadsUrl(null)).toBe(false);
    expect(isThreadsUrl("esto no es una URL")).toBe(false);
  });
});

describe("extractThreadsPostId / isThreadsPostUrl", () => {
  it("extrae el código del post en todas sus formas", () => {
    const urls = [
      "https://www.threads.com/@mileycyrus/post/DWSFx_jErAQ",
      "https://threads.net/@mileycyrus/post/DWSFx_jErAQ",
      "https://www.threads.com/@mileycyrus/post/DWSFx_jErAQ/last-night-at-the-premiere",
      "https://www.threads.com/@user/post/CODE_123-abc",
      "https://m.threads.net/@user/post/DbXn8g1mA0T/slug-legible",
    ];
    for (const url of urls) {
      expect(isThreadsPostUrl(url)).toBe(true);
    }
    expect(extractThreadsPostId("https://www.threads.com/@user/post/AbC123_xYz")).toBe(
      "AbC123_xYz",
    );
    expect(
      extractThreadsPostId(
        "https://www.threads.com/@user/post/DWSFx_jErAQ/last-night-at-the-premiere",
      ),
    ).toBe("DWSFx_jErAQ");
  });

  it("devuelve null en perfiles, rutas cortas y códigos inválidos", () => {
    expect(isThreadsPostUrl("https://www.threads.com/@mileycyrus")).toBe(false);
    expect(isThreadsPostUrl("https://www.threads.com/")).toBe(false);
    expect(isThreadsPostUrl("https://www.threads.com/@user/post/")).toBe(false);
    expect(isThreadsPostUrl("https://www.threads.com/@user/post/ab")).toBe(false);
    expect(isThreadsPostUrl("https://www.threads.com/@user/comment/AbC123")).toBe(false);
    expect(extractThreadsPostId("https://www.threads.com/@user")).toBeNull();
  });
});

describe("isThreadsProfileUrl", () => {
  it("reconoce la ruta única @usuario", () => {
    expect(isThreadsProfileUrl("https://www.threads.com/@mileycyrus")).toBe(true);
    expect(isThreadsProfileUrl("https://threads.net/@user?hl=en")).toBe(true);
  });

  it("rechaza posts, secciones reservadas y rutas sin @", () => {
    expect(isThreadsProfileUrl("https://www.threads.com/@user/post/AbC123")).toBe(false);
    expect(isThreadsProfileUrl("https://www.threads.com/search?q=cats")).toBe(false);
    expect(isThreadsProfileUrl("https://www.threads.com/tag/cats")).toBe(false);
    expect(isThreadsProfileUrl("https://www.threads.com/user")).toBe(false);
    expect(isThreadsProfileUrl("https://www.threads.com/")).toBe(false);
  });
});

describe("inputToThreadsUrl", () => {
  it("completa el esquema en entradas pegadas sin https", () => {
    expect(inputToThreadsUrl("threads.com/@user/post/AbC123_xYz")).toBe(
      "https://threads.com/@user/post/AbC123_xYz",
    );
    expect(inputToThreadsUrl("www.threads.net/@user/post/AbC123_xYz")).toBe(
      "https://www.threads.net/@user/post/AbC123_xYz",
    );
  });

  it("respeta las URLs ya normalizadas y deja otras entradas", () => {
    expect(inputToThreadsUrl("https://threads.com/@user/post/AbC123")).toBe(
      "https://threads.com/@user/post/AbC123",
    );
    expect(inputToThreadsUrl("https://example.com")).toBe("https://example.com");
    expect(inputToThreadsUrl("  ")).toBe("");
  });
});
