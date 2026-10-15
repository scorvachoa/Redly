import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSearchHtml } from "@/lib/parser";

const FIXTURE = fileURLToPath(new URL("./fixtures/ajax_search_response.html", import.meta.url));
const html = readFileSync(FIXTURE, "utf8");

describe("parseSearchHtml", () => {
  const result = parseSearchHtml(html);

  it("extrae el ID del vídeo", () => {
    expect(result.videoId).toBe("6718335390845095173");
  });

  it("extrae el título", () => {
    // El fixture trae `&amp; I` (con espacio), no `&amp;I`.
    expect(result.title).toBe("Scramble up ur name & I😍❤️ #foryoupage #aesthetic");
  });

  it("extrae el thumbnail", () => {
    expect(result.thumbnail).toMatch(/^https:\/\/p16-common-sign\.tiktokcdn-us\.com\//);
  });

  it("extrae las opciones de descarga", () => {
    expect(result.downloads).toHaveLength(4);
    const names = result.downloads.map((option) => option.name);
    expect(names[0]).toContain("Download MP4 [1]");
    expect(names[3]).toContain("Download MP3");
  });

  it("infirió formato y calidad", () => {
    const [first, second, hd, mp3] = result.downloads;
    expect(first.format).toBe("mp4");
    expect(first.quality).toBe("standard");
    expect(second.format).toBe("mp4");
    expect(hd.quality).toBe("hd");
    expect(mp3.format).toBe("mp3");
    expect(mp3.quality).toBe("audio");
  });

  it("deduplica URLs repetidas y excluye enlaces de navegación", () => {
    const urls = result.downloads.map((option) => option.url);
    expect(new Set(urls).size).toBe(urls.length);
    // El enlace "Download more videos" (clase more-video) no debe aparecer.
    expect(urls.some((url) => url.endsWith("/"))).toBe(false);
  });

  it("las URLs relativas se resuelven contra el dominio base", () => {
    expect(result.downloads.every((option) => /^https?:\/\//.test(option.url))).toBe(true);
  });
});

describe("parseSearchHtml con HTML vacío o roto", () => {
  it("devuelve un resultado vacío sin lanzar", () => {
    const empty = parseSearchHtml("");
    expect(empty.downloads).toHaveLength(0);
    expect(empty.videoId).toBeNull();
  });

  it("tolera HTML incompleto", () => {
    const broken = parseSearchHtml("<div class='thumbnail'><img src='x.jpg'>");
    expect(broken.thumbnail).toContain("x.jpg");
    expect(broken.downloads).toHaveLength(0);
  });

  it("no lanza ante HTML irreconocible", () => {
    expect(() => parseSearchHtml("<<<>>> &&&")).not.toThrow();
    expect(parseSearchHtml("<<<>>> &&&").downloads).toHaveLength(0);
  });
});

describe("parseSearchHtml con un carrusel de fotos (photomode)", () => {
  const PHOTO_FIXTURE = fileURLToPath(
    new URL("./fixtures/savetik_photo_post.html", import.meta.url),
  );
  const photoResult = parseSearchHtml(readFileSync(PHOTO_FIXTURE, "utf8"));
  const photos = photoResult.downloads.filter((option) => option.kind === "image");

  it("extrae ID y título del carrusel", () => {
    expect(photoResult.videoId).toBe("7591041242947947831");
    expect(photoResult.title).toBe("Carrusel de prueba");
  });

  it("cada foto es una opción propia, por delante del MP3", () => {
    expect(photos).toHaveLength(2);
    // Las fotos se añaden primero para que la selección automática prefiera la
    // imagen cuando el post no lleva ningún MP4.
    expect(photoResult.downloads[0].kind).toBe("image");
    expect(photoResult.downloads[1].kind).toBe("image");
    expect(photoResult.downloads[2].format).toBe("mp3");
    expect(photoResult.downloads[2].kind).toBe("audio");
  });

  it("marca cada foto como imagen y conserva su miniatura", () => {
    expect(photos).toHaveLength(2);
    for (const photo of photos) {
      expect(photo.kind).toBe("image");
      expect(photo.format).toBe("jpeg");
      expect(photo.thumbnail).toMatch(
        /^https:\/\/p16-common-sign\.tiktokcdn-us\.com\/photo-/,
      );
    }
  });

  it("lee la extensión del nombre del token, o la infiere del contexto", () => {
    // El primer token es un JWT válido con `filename: SaveTikPro.com_..._1.jpeg`.
    expect(photos[0].url).toContain("HDR.");
    expect(photos[0].format).toBe("jpeg");
    // El segundo es un token corrupto: sin payload decodificable se cae a la
    // extensión que toca por contexto.
    expect(photos[1].url).toContain("token=rototo");
    expect(photos[1].format).toBe("jpeg");
  });

  it("sólo admite enlaces de la allowlist del CDN de descarga", () => {
    expect(
      photoResult.downloads.every((option) =>
        option.url.startsWith("https://pro.snapcdn.app/"),
      ),
    ).toBe(true);
  });
});
