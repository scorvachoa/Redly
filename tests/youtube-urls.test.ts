import { describe, expect, it } from "vitest";

import {
  extractYouTubeVideoId,
  inputToYouTubeUrl,
  isYouTubePlaylistUrl,
  isYouTubeProfileUrl,
  isYouTubeUrl,
  isYouTubeVideoUrl,
  normalizeYouTubeUrl,
} from "@/lib/youtube-urls";

const ID = "dQw4w9WgXcQ";

describe("isYouTubeUrl", () => {
  it("acepta todos los dominios habituales", () => {
    expect(isYouTubeUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(true);
    expect(isYouTubeUrl("https://youtube.com/")).toBe(true);
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=x")).toBe(true);
    expect(isYouTubeUrl("https://music.youtube.com/watch?v=x")).toBe(true);
    expect(isYouTubeUrl(`https://youtu.be/${ID}`)).toBe(true);
    expect(isYouTubeUrl("https://www.youtu.be/x")).toBe(true);
  });

  it("rechaza otras URLs", () => {
    expect(isYouTubeUrl("https://example.com/watch?v=x")).toBe(false);
    expect(isYouTubeUrl("https://youtube.com.evil.example/x")).toBe(false);
    expect(isYouTubeUrl("https://notyoutube.com/x")).toBe(false);
    expect(isYouTubeUrl("ftp://youtube.com/x")).toBe(false);
    expect(isYouTubeUrl("no es una url")).toBe(false);
    expect(isYouTubeUrl("")).toBe(false);
    expect(isYouTubeUrl(null)).toBe(false);
    expect(isYouTubeUrl(undefined)).toBe(false);
  });
});

describe("extractYouTubeVideoId", () => {
  it("lee el id de todas las formas de enlace", () => {
    expect(extractYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractYouTubeVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(extractYouTubeVideoId(`https://youtu.be/${ID}?t=42`)).toBe(ID);
    expect(extractYouTubeVideoId(`https://m.youtube.com/watch?v=${ID}&list=PL1`)).toBe(ID);
    expect(extractYouTubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(extractYouTubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(extractYouTubeVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(extractYouTubeVideoId(`https://www.youtube.com/v/${ID}`)).toBe(ID);
  });

  it("devuelve null cuando no apunta a un vídeo", () => {
    expect(extractYouTubeVideoId("https://www.youtube.com/")).toBeNull();
    expect(extractYouTubeVideoId("https://www.youtube.com/@google")).toBeNull();
    expect(extractYouTubeVideoId("https://www.youtube.com/playlist?list=PL1")).toBeNull();
    expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=corto")).toBeNull();
    expect(extractYouTubeVideoId("https://youtu.be/tampoco")).toBeNull();
    expect(extractYouTubeVideoId(`https://tiktok.com/@u/video/${"1".repeat(11)}`)).toBeNull();
  });
});

describe("isYouTubeVideoUrl / isYouTubeProfileUrl / isYouTubePlaylistUrl", () => {
  it("vídeo: watch, enlace corto y shorts", () => {
    expect(isYouTubeVideoUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(true);
    expect(isYouTubeVideoUrl(`https://youtu.be/${ID}`)).toBe(true);
    expect(isYouTubeVideoUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(true);
    expect(isYouTubeVideoUrl("https://www.youtube.com/@google")).toBe(false);
  });

  it("perfil: @handle, /channel/, /c/ y /user/, con subrutas", () => {
    expect(isYouTubeProfileUrl("https://www.youtube.com/@GoogleDevelopers")).toBe(true);
    expect(isYouTubeProfileUrl("https://www.youtube.com/@GoogleDevelopers/videos")).toBe(true);
    expect(isYouTubeProfileUrl("https://www.youtube.com/channel/UCabcdef123456")).toBe(true);
    expect(isYouTubeProfileUrl("https://www.youtube.com/c/Nombre")).toBe(true);
    expect(isYouTubeProfileUrl("https://www.youtube.com/user/otro")).toBe(true);
    expect(isYouTubeProfileUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(false);
    expect(isYouTubeProfileUrl("https://www.tiktok.com/@usuario")).toBe(false);
  });

  it("lista: /playlist o parámetro list sin vídeo concreto", () => {
    expect(isYouTubePlaylistUrl("https://www.youtube.com/playlist?list=PL123")).toBe(true);
    expect(isYouTubePlaylistUrl("https://www.youtube.com/watch?list=PL123")).toBe(true);
    // Con un id de vídeo mandan el vídeo, no la lista.
    expect(isYouTubePlaylistUrl(`https://www.youtube.com/watch?v=${ID}&list=PL123`)).toBe(false);
    expect(isYouTubePlaylistUrl(`https://youtu.be/${ID}`)).toBe(false);
    expect(isYouTubePlaylistUrl("https://www.youtube.com/@google")).toBe(false);
  });
});

describe("normalizeYouTubeUrl / inputToYouTubeUrl", () => {
  it("quita los espacios exteriores sin tocar nada más", () => {
    expect(normalizeYouTubeUrl(`  https://youtu.be/${ID}  `)).toBe(`https://youtu.be/${ID}`);
    expect(normalizeYouTubeUrl(`https://www.youtube.com/watch?v=${ID}/`)).toBe(
      `https://www.youtube.com/watch?v=${ID}/`,
    );
    expect(inputToYouTubeUrl(`  https://youtu.be/${ID}\n`)).toBe(`https://youtu.be/${ID}`);
  });
});
