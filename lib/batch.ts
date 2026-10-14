/**
 * Descarga en masa secuencial con manifiesto de reanudación (CLI).
 *
 * Port de `app/batch.py`. Diseño (límites de la especificación):
 *
 * - Los vídeos se descargan **uno a uno, en serie** (nunca en paralelo).
 * - `manifest.json` guarda sólo estado (`ok`/`error`), nombre de archivo y
 *   bytes: **nunca** URLs ni tokens, que caducan en ~1 hora.
 * - Reejecutar el lote omite los vídeos ya `ok` (con archivo presente) y vuelve
 *   a intentar los fallidos (con tokens frescos de la nueva consulta).
 * - Pausa configurable entre vídeos para no golpear al servicio.
 */

import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { BATCH_DELAY_SECONDS } from "./config";
import { buildFilename, downloadToFile, resolveUrl, sanitizeFilename } from "./downloader";
import { DownloadError, UnavailableError } from "./exceptions";
import type { BatchItemResult, BatchReport, ProfileVideo } from "./models";

const MANIFEST_VERSION = 1;

interface ManifestEntry {
  state: "ok" | "error";
  file?: string;
  bytes?: number;
  title?: string;
  error?: string;
  updated: number;
}

/** Estado persistente del lote (JSON pequeño, escritura atómica). */
export class Manifest {
  readonly path: string;
  private items: Record<string, ManifestEntry> = {};

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as { items?: Record<string, ManifestEntry> };
      if (parsed && typeof parsed.items === "object" && parsed.items) {
        this.items = parsed.items;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      // Archivo ilegible o JSON inválido: se empieza de cero.
      this.items = {};
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const payload = JSON.stringify(
      { version: MANIFEST_VERSION, items: this.items },
      null,
      2,
    );
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, this.path);
  }

  get(key: string): ManifestEntry | null {
    const entry = this.items[key];
    return entry && typeof entry === "object" ? entry : null;
  }

  async mark(
    key: string,
    state: "ok" | "error",
    fields: { file?: string; bytes?: number; title?: string; error?: string } = {},
  ): Promise<void> {
    const entry: ManifestEntry = { state, updated: Math.floor(Date.now() / 1000) };
    if (fields.file) entry.file = fields.file;
    if (fields.bytes !== undefined) entry.bytes = fields.bytes;
    if (fields.title) entry.title = fields.title;
    if (fields.error) entry.error = fields.error;
    this.items[key] = entry;
    await this.save();
  }

  async isDone(key: string, outputPath: string): Promise<boolean> {
    const entry = this.get(key);
    if (!entry || entry.state !== "ok") return false;
    try {
      const info = await stat(outputPath);
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }
}

export type BatchHooks = {
  onItemStart?: (index: number, total: number, item: ProfileVideo) => void;
  onItemProgress?: (written: number, total: number | null) => void;
  onItemDone?: (index: number, total: number, result: BatchItemResult) => void;
  onStatus?: (message: string) => void;
};

export interface BatchOptions {
  delay?: number;
  resume?: boolean;
  downloadDir?: string;
  /**
   * Subcarpeta por ítem (por ejemplo el perfil al que pertenece). Devuelve
   * `null` para escribir en la raíz. El manifiesto se queda siempre en la raíz
   * de `downloadDir`, compartido entre perfiles.
   */
  subdirFor?: (item: ProfileVideo) => string | null | undefined;
}

/** Une la raíz de destino con una subcarpeta opcional (sin duplicar barras). */
export function joinOutputDir(root: string, subdir?: string | null): string {
  const base = (root || "").replace(/[\\/]+$/, "");
  const folder = (subdir || "").replace(/^[\\/]+|[\\/]+$/g, "");
  return folder ? `${base}/${folder}` : base;
}

/** Ejecuta un lote de `ProfileVideo` en orden secuencial. */
export async function runBatch(
  items: ProfileVideo[],
  options: BatchOptions = {},
  hooks: BatchHooks = {},
): Promise<BatchReport> {
  const delay = options.delay ?? BATCH_DELAY_SECONDS;
  const resume = options.resume ?? true;
  const downloadDir = options.downloadDir ?? "downloads";
  const manifest = new Manifest(`${downloadDir}/manifest.json`);
  await manifest.load();

  const results: BatchItemResult[] = [];
  const total = items.length;
  hooks.onStatus?.(`lote: ${total} vídeos (delay=${delay}s resume=${resume})`);

  for (let index = 0; index < total; index++) {
    const item = items[index];
    const key = item.id;
    const target = itemOutputPath(joinOutputDir(downloadDir, options.subdirFor?.(item)), item);
    let result: BatchItemResult;

    if (resume && (await manifest.isDone(key, target))) {
      const info = await stat(target).catch(() => null);
      result = {
        key,
        state: "skipped",
        file: filenameOf(target),
        bytes: info?.size ?? null,
        title: item.title ?? null,
      };
    } else {
      result = await downloadOne(index + 1, total, item, key, target, manifest, hooks);
    }

    results.push(result);
    hooks.onItemDone?.(index + 1, total, result);

    if ((result.state === "ok" || result.state === "error") && index < total - 1 && delay > 0) {
      await pause(delay);
    }
  }

  return buildReport(results);
}

async function downloadOne(
  index: number,
  total: number,
  item: ProfileVideo,
  key: string,
  target: string,
  manifest: Manifest,
  hooks: BatchHooks,
): Promise<BatchItemResult> {
  hooks.onItemStart?.(index, total, item);

  try {
    const info = await resolveUrl(item.url);
    const { bytes } = await downloadToFile(info.finalUrl, target, hooks.onItemProgress);
    await manifest.mark(key, "ok", { file: filenameOf(target), bytes, title: item.title ?? undefined });
    return { key, state: "ok", file: filenameOf(target), bytes, title: item.title ?? null };
  } catch (error) {
    if (error instanceof KeyboardInterruptLike) throw error;
    const message =
      error instanceof UnavailableError || error instanceof DownloadError
        ? error.message
        : `Fallo inesperado: ${(error as Error)?.message ?? "Error"}`;
    await manifest.mark(key, "error", { title: item.title ?? undefined, error: message });
    return { key, state: "error", title: item.title ?? null, error: message };
  }
}

/** Excepción sintética para propagar la interrupción (Ctrl+C) del CLI. */
export class KeyboardInterruptLike extends Error {
  constructor() {
    super("Operación cancelada");
    this.name = "KeyboardInterruptLike";
  }
}

/** Ruta de salida de un vídeo del lote (compartida con el filtrado por historial). */
export function itemOutputPath(downloadDir: string, item: ProfileVideo): string {
  const extension = (item.format || "mp4").replace(/^\./, "").toLowerCase();
  const name = /^\d+$/.test(item.id)
    ? buildFilename(item.id, null, extension)
    : sanitizeFilename(`Redly_${item.id}.${extension}`);
  return `${downloadDir.replace(/\/+$/, "")}/${name}`;
}

function filenameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1];
}

function buildReport(results: BatchItemResult[]): BatchReport {
  const downloaded = results.filter((r) => r.state === "ok").length;
  const skipped = results.filter((r) => r.state === "skipped").length;
  const failed = results.filter((r) => r.state === "error").length;
  return { results, downloaded, skipped, failed };
}

async function pause(seconds: number): Promise<void> {
  if (seconds > 0) await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
