import { describe, expect, it } from "vitest";

import {
  inputToProfileUrl,
  isProfileUrl,
  isTikTokUrl,
  isVideoUrl,
  normalizeTikTokUrl,
  profileFolderName,
  profileHandle,
} from "@/lib/urls";

const PERFIL = "https://www.tiktok.com/@scout2015";
const VIDEO = "https://www.tiktok.com/@scout2015/video/6718335390845095173";

describe("isTikTokUrl", () => {
  it("acepta dominios y subdominios de TikTok", () => {
    expect(isTikTokUrl("https://www.tiktok.com/@user/video/1")).toBe(true);
    expect(isTikTokUrl("https://tiktok.com/@user/video/1")).toBe(true);
    expect(isTikTokUrl("https://m.tiktok.com/v/1.html")).toBe(true);
    expect(isTikTokUrl("https://vm.tiktok.com/ZMxxxxx/")).toBe(true);
  });

  it("rechaza dominios ajenos y valores vacíos", () => {
    expect(isTikTokUrl("https://example.com/video/1")).toBe(false);
    expect(isTikTokUrl("https://tiktok.com.evil.com/video/1")).toBe(false);
    expect(isTikTokUrl("ftp://tiktok.com/x")).toBe(false);
    expect(isTikTokUrl("")).toBe(false);
    expect(isTikTokUrl(null)).toBe(false);
    expect(isTikTokUrl(undefined)).toBe(false);
  });
});

describe("clasificación perfil vs vídeo", () => {
  it("detecta perfiles", () => {
    expect(isProfileUrl(PERFIL)).toBe(true);
    expect(isProfileUrl(`${PERFIL}/`)).toBe(true);
    expect(isProfileUrl("@scout2015")).toBe(false); // no es URL absoluta
  });

  it("detecta vídeos (y no los toma como perfil)", () => {
    expect(isVideoUrl(VIDEO)).toBe(true);
    expect(isVideoUrl("https://vm.tiktok.com/ZMxxxxx/")).toBe(true);
    expect(isProfileUrl(VIDEO)).toBe(false);
    expect(isVideoUrl(PERFIL)).toBe(false);
  });
});

describe("normalización", () => {
  it("quita la barra final de los perfiles (evita 404 en savetikpro)", () => {
    expect(normalizeTikTokUrl(`${PERFIL}/`)).toBe(PERFIL);
    expect(normalizeTikTokUrl(`${PERFIL}   `)).toBe(PERFIL);
  });

  it("convierte @usuario en URL de perfil", () => {
    expect(inputToProfileUrl("@scout2015")).toBe(PERFIL);
    expect(inputToProfileUrl(PERFIL)).toBe(PERFIL);
  });
});

describe("identificador de perfil", () => {
  it("extrae el handle de una URL de perfil", () => {
    expect(profileHandle(PERFIL)).toBe("scout2015");
    expect(profileHandle(`${PERFIL}/`)).toBe("scout2015");
    expect(profileHandle("@scout2015")).toBeNull(); // no es URL absoluta
  });

  it("devuelve null para vídeos y otras rutas", () => {
    expect(profileHandle(VIDEO)).toBeNull();
    expect(profileHandle("https://www.tiktok.com/@a/b")).toBeNull();
    expect(profileHandle("https://example.com/@scout2015")).toBeNull();
    expect(profileHandle(null)).toBeNull();
  });

  it("convierte el handle en un nombre de carpeta seguro", () => {
    expect(profileFolderName(PERFIL)).toBe("scout2015");
    expect(profileFolderName(`${PERFIL}/`)).toBe("scout2015");
    expect(profileFolderName(VIDEO)).toBeNull();
  });

  it("sanea handles con caracteres no válidos en el nombre de carpeta", () => {
    expect(profileFolderName("https://www.tiktok.com/@a:b")).toBe("a_b");
    // Un handle que no deja nada usable no inventa una carpeta.
    expect(profileFolderName("https://www.tiktok.com/@...")).toBeNull();
  });
});
