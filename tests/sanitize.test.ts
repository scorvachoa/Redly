import { describe, expect, it } from "vitest";

import { MAX_FILENAME_LENGTH, sanitizeFilename, sanitizeFolderName } from "@/lib/sanitize";

describe("sanitizeFilename", () => {
  it("quita path traversal y caracteres inválidos", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("_etc_passwd");
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeFilename("nombre con  espacios.mp4")).toBe("nombre con espacios.mp4");
  });

  it("devuelve un nombre por defecto si queda vacío", () => {
    expect(sanitizeFilename("")).toBe("archivo");
    expect(sanitizeFilename("...")).toBe("archivo");
    expect(sanitizeFilename("///")).toBe("archivo");
  });

  it("respeta los nombres reservados de Windows sólo cuando hay extensión", () => {
    expect(sanitizeFilename("CON.mp4")).toBe("_CON.mp4");
    expect(sanitizeFilename("com3.MP3")).toBe("_com3.MP3");
    // Sin punto no se toca: se conserva el comportamiento del puerto Python.
    expect(sanitizeFilename("CON")).toBe("CON");
  });

  it("trunca conservando la extensión", () => {
    const result = sanitizeFilename(`${"a".repeat(300)}.mp4`);

    expect(result.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(result.endsWith(".mp4")).toBe(true);
  });
});

describe("sanitizeFolderName", () => {
  it("deja los handles normales intactos", () => {
    expect(sanitizeFolderName("scout2015")).toBe("scout2015");
    expect(sanitizeFolderName("user.name_01")).toBe("user.name_01");
  });

  it("quita caracteres inválidos y traversal", () => {
    expect(sanitizeFolderName("a<b>:c/d")).toBe("a_b_c_d");
    expect(sanitizeFolderName("../etc")).toBe("_etc");
  });

  it("no deja puntos ni guiones bajos finales, ni nombres especiales", () => {
    expect(sanitizeFolderName("perfil...")).toBe("perfil");
    expect(sanitizeFolderName(".")).toBe("perfil");
    expect(sanitizeFolderName("CON")).toBe("_CON");
  });

  it("trunca sin conservar extensión (una carpeta no la tiene)", () => {
    expect(sanitizeFolderName("b".repeat(200))).toHaveLength(64);
  });
});
