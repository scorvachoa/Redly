import { describe, expect, it } from "vitest";

import {
  batchOption,
  bestQualityOption,
  type DownloadOption,
  type TikTokResult,
} from "@/lib/models";

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
const P1080: DownloadOption = {
  name: "Vídeo 1080p",
  url: "https://cdn.example/1080.mp4",
  format: "mp4",
  quality: "1080p",
  kind: "video",
};
const P720: DownloadOption = {
  name: "Vídeo 720p",
  url: "https://cdn.example/720.mp4",
  format: "mp4",
  quality: "720p",
  kind: "video",
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

  it("sin etiqueta HD elige la mayor resolución (YouTube trae 1080p/720p)", () => {
    expect(bestQualityOption(result([P720, P1080, MP3]))).toBe(P1080);
    expect(bestQualityOption(result([P1080, P720, MP3]))).toBe(P1080);
  });

  it("si no hay HD ni resoluciones sigue devolviendo null", () => {
    expect(bestQualityOption(result([SD, MP3]))).toBeNull();
  });
});

// Opciones como las de SnapYT para un vídeo de YouTube: 1080p `video-only`
// servido como combinación, 720p/360p progresivas con audio y audio suelto.
const MERGE1080: DownloadOption = {
  name: "Vídeo 1080p",
  url: "/api/merge?yt=https://www.youtube.com/watch?v=abc&v=12&a=34",
  format: "mp4",
  quality: "1080p",
  kind: "video",
  hasAudio: false,
};
const DIRECT720: DownloadOption = {
  name: "Vídeo 720p",
  url: "https://cdn.example/720.mp4",
  format: "mp4",
  quality: "720p",
  kind: "video",
  hasAudio: true,
};
const DIRECT360: DownloadOption = {
  name: "Vídeo 360p",
  url: "https://cdn.example/360.mp4",
  format: "mp4",
  quality: "360p",
  kind: "video",
  hasAudio: true,
};
/** Pista `video-only` sin combinación disponible: llegaría muda. */
const MUTED: DownloadOption = {
  name: "Vídeo 1080p",
  url: "https://cdn.example/1080-mute.mp4",
  format: "mp4",
  quality: "1080p",
  kind: "video",
  hasAudio: false,
};
/** Pistas de audio como las de SnapYT: MP3 convertido y m4a original. */
const AUDIO320: DownloadOption = {
  name: "MP3 · 320 kbps",
  url: "https://cdn.example/320.mp3",
  format: "mp3",
  quality: "320 kbps",
  kind: "audio",
};
const AUDIO128: DownloadOption = {
  name: "MP3 · 128 kbps",
  url: "https://cdn.example/128.mp3",
  format: "mp3",
  quality: "128 kbps",
  kind: "audio",
};
const M4A128: DownloadOption = {
  name: "M4A · 128 kbps",
  url: "https://cdn.example/128.m4a",
  format: "m4a",
  quality: "128 kbps",
  kind: "audio",
};

describe("batchOption", () => {
  it("recommended se queda con la mejor directa e ignora la combinación", () => {
    expect(batchOption(result([MERGE1080, DIRECT720, DIRECT360]), "recommended")).toBe(DIRECT720);
  });

  it("max elige la combinación de mayor resolución", () => {
    expect(batchOption(result([MERGE1080, DIRECT720, DIRECT360]), "max")).toBe(MERGE1080);
  });

  it("max descarta las pistas mudas que no admiten combinación", () => {
    // Con merge disponible no se baja el 1080p mudo; se prefiere combinar.
    expect(batchOption(result([MERGE1080, MUTED, DIRECT720]), "max")).toBe(MERGE1080);
    // Sin merge, la más alta utilizable es la progresiva de 720p.
    expect(batchOption(result([MUTED, DIRECT720]), "max")).toBe(DIRECT720);
  });

  it("recommended devuelve null si sólo hay combinaciones", () => {
    expect(batchOption(result([MERGE1080]), "recommended")).toBeNull();
  });

  it("max devuelve null si sólo hay pistas mudas sin combinación", () => {
    expect(batchOption(result([MUTED]), "max")).toBeNull();
  });

  it("recommended y max siguen sin elegir audio ni fotos", () => {
    expect(batchOption(result([MP3]), "recommended")).toBeNull();
    expect(batchOption(result([MP3]), "max")).toBeNull();
  });

  it("audio elige la pista de sonido de mayor bitrate", () => {
    expect(batchOption(result([DIRECT720, AUDIO128, AUDIO320]), "audio")).toBe(AUDIO320);
    expect(batchOption(result([AUDIO128, AUDIO320]), "audio")).toBe(AUDIO320);
  });

  it("audio ignora vídeos y combinaciones, aunque sean de mayor calidad", () => {
    expect(batchOption(result([MERGE1080, DIRECT720, AUDIO128]), "audio")).toBe(AUDIO128);
  });

  it("audio a igual bitrate conserva el orden del servicio", () => {
    expect(batchOption(result([M4A128, AUDIO128]), "audio")).toBe(M4A128);
    expect(batchOption(result([AUDIO128, M4A128]), "audio")).toBe(AUDIO128);
  });

  it("audio devuelve null si no hay pistas de audio", () => {
    expect(batchOption(result([DIRECT720, MERGE1080]), "audio")).toBeNull();
    expect(batchOption(result([]), "audio")).toBeNull();
  });
});
