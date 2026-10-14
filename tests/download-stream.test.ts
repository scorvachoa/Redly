import { describe, expect, it } from "vitest";

import { formatBytes, isProfileLike, progressLabel } from "@/lib/download-stream";

describe("formatBytes", () => {
  it("formatea con la unidad adecuada", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("devuelve ? para tamaños desconocidos", () => {
    expect(formatBytes(null)).toBe("?");
    expect(formatBytes(undefined)).toBe("?");
  });

  it("redondea enteros sin decimales", () => {
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("isProfileLike", () => {
  it("reconoce la ruta de un perfil", () => {
    expect(isProfileLike("https://www.tiktok.com/@scout2015")).toBe(true);
    expect(isProfileLike("https://www.tiktok.com/@scout2015/")).toBe(true);
    expect(isProfileLike("https://tiktok.com/@usuario")).toBe(true);
  });

  it("rechaza la de un vídeo suelto", () => {
    expect(isProfileLike("https://www.tiktok.com/@u/video/12345")).toBe(false);
    expect(isProfileLike("https://www.tiktok.com/@u/photo/12345")).toBe(false);
  });

  it("rechaza basura sin lanzar", () => {
    expect(isProfileLike("")).toBe(false);
    expect(isProfileLike("no url")).toBe(false);
    expect(isProfileLike("https://")).toBe(false);
  });
});

describe("progressLabel", () => {
  it("con total muestra porcentaje", () => {
    expect(progressLabel(50, 100)).toBe("50 B de 100 B · 50%");
  });

  it("sin total sólo muestra lo descargado", () => {
    expect(progressLabel(2048, null)).toBe("2.0 KB descargados");
    expect(progressLabel(2048, 0)).toBe("2.0 KB descargados");
  });

  it("acepta un prefijo para el contador del lote", () => {
    expect(progressLabel(50, 100, "2/5")).toBe("2/5 · 50 B de 100 B · 50%");
  });

  it("limita el porcentaje al 100", () => {
    expect(progressLabel(200, 100)).toContain("100%");
  });
});
