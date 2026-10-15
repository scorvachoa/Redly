import { describe, expect, it } from "vitest";

import { bestQualityOption, type DownloadOption, type TikTokResult } from "@/lib/models";

const SD: DownloadOption = {
  name: "Download MP4 [1]",
  url: "https://cdn.example/sd.mp4",
  format: "mp4",
  quality: "standard",
};
const HD: DownloadOption = {
  name: "Download MP4 HD",
  url: "https://cdn.example/hd.mp4",
  format: "mp4",
  quality: "hd",
};
const MP3: DownloadOption = {
  name: "Download MP3",
  url: "https://cdn.example/audio.mp3",
  format: "mp3",
  quality: "audio",
};

function result(downloads: DownloadOption[]): TikTokResult {
  return { downloads };
}

describe("bestQualityOption", () => {
  it("elige la opción HD cuando existe", () => {
    expect(bestQualityOption(result([SD, HD, MP3]))).toBe(HD);
  });

  it("devuelve null si no hay HD: hay que conservar la del listado", () => {
    expect(bestQualityOption(result([SD, MP3]))).toBeNull();
  });

  it("no confunde el audio con la máxima calidad", () => {
    expect(bestQualityOption(result([MP3]))).toBeNull();
  });

  it("devuelve null sin opciones", () => {
    expect(bestQualityOption(result([]))).toBeNull();
  });

  it("compara la calidad sin importar mayúsculas", () => {
    const upper: DownloadOption = { ...HD, quality: "HD" };
    expect(bestQualityOption(result([upper]))).toBe(upper);
  });
});
