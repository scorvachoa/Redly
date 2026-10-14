#!/usr/bin/env node
/**
 * Red.ly — CLI en TypeScript.
 *
 * Port de `main.py`. Uso:
 *
 *   npm run cli -- --url "https://www.tiktok.com/@usuario/video/123"
 *   npm run cli -- --profile "@usuario" --max 10
 *   npm run cli -- --batch lista.txt --delay 2 --yes
 */

import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import pc from "picocolors";

import { itemOutputPath, joinOutputDir, Manifest, runBatch } from "@/lib/batch";
import { BATCH_DEFAULT_MAX_VIDEOS, BATCH_DELAY_SECONDS, DOWNLOAD_DIRECTORY, maskUrl } from "@/lib/config";
import { TikVidClient } from "@/lib/client";
import { buildFilename, downloadToFile, resolveUrl } from "@/lib/downloader";
import { RedlyError } from "@/lib/exceptions";
import { optionLabel, summarize, type DownloadOption, type ProfileVideo, type TikTokResult } from "@/lib/models";
import { searchAny, SavetikSource } from "@/lib/savetik";
import {
  isProfileUrl,
  isTikTokUrl,
  inputToProfileUrl,
  normalizeTikTokUrl,
  profileFolderName,
} from "@/lib/urls";

const BANNER = `
╭────────────────────────────────────╮
│           Red.ly  (CLI)           │
╰────────────────────────────────────╯`;

interface CliOptions {
  url?: string;
  profile?: string;
  batch?: string;
  max: string;
  delay: string;
  listOnly?: boolean;
  yes?: boolean;
  /**
   * Commander interpreta `--no-resume` y `--no-download` como la negación de
   * `resume` / `download`: crea esas claves por defecto a `true` y las pone en
   * `false` cuando se pasa el flag. Por eso se leen así y no como `noResume`.
   */
  resume?: boolean;
  option?: string;
  outputDir?: string;
  download?: boolean;
  debug?: boolean;
}

function out(message = ""): void {
  process.stdout.write(`${message}\n`);
}

function ok(message: string): void {
  out(pc.green(message));
}

function warn(message: string): void {
  out(pc.yellow(message));
}

function fail(message: string): void {
  process.stderr.write(`${pc.red(message)}\n`);
}

/** Selección automática para el lote: mejor MP4 (HD si existe). */
function pickAutoOption(result: TikTokResult): DownloadOption {
  const mp4s = result.downloads.filter((option) => (option.format ?? "").toLowerCase() === "mp4");
  const candidates = mp4s.length > 0 ? mp4s : result.downloads;
  const hd = candidates.find((option) => (option.quality ?? "").toLowerCase() === "hd");
  return hd ?? candidates[0];
}

async function videoUrlToItem(url: string, source: SavetikSource): Promise<ProfileVideo> {
  const result = await searchAny(url, { savetik: source, tikvid: new TikVidClient() });
  const option = pickAutoOption(result);
  const id = result.videoId ?? `anon_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    title: result.title ?? null,
    url: option.url,
    format: (option.format ?? "mp4").toLowerCase(),
  };
}

/** Ítem de cola: un vídeo con la subcarpeta destino (el perfil, o la raíz). */
interface QueuedItem extends ProfileVideo {
  /** Handle del perfil como subcarpeta, o `null` para escribir en la raíz. */
  subdir: string | null;
}

interface CollectResult {
  items: QueuedItem[];
  skipped: number;
}

/** Une perfiles y vídeos sueltos en una cola de descarga plana, sin los ya descargados. */
async function collectTargets(options: CliOptions): Promise<CollectResult> {
  const source = new SavetikSource();
  const profileTargets: string[] = [];
  const videoTargets: string[] = [];

  if (options.profile) profileTargets.push(inputToProfileUrl(options.profile));

  if (options.batch) {
    let content = "";
    try {
      content = await readFile(options.batch, "utf8");
    } catch {
      fail(`No se pudo leer el fichero de lote: ${options.batch}`);
      return { items: [], skipped: 0 };
    }
    for (const line of content.split(/\r?\n/)) {
      const entry = normalizeTikTokUrl(line.trim());
      if (!entry || entry.startsWith("#")) continue;
      if (!isTikTokUrl(entry)) {
        warn(`· Línea ignorada (no es TikTok): ${entry}`);
        continue;
      }
      if (isProfileUrl(entry)) profileTargets.push(entry);
      else videoTargets.push(entry);
    }
  }

  if (options.url) {
    const entry = normalizeTikTokUrl(options.url.trim());
    if (isTikTokUrl(entry) && isProfileUrl(entry)) profileTargets.push(entry);
  }

  // El manifiesto se consulta ANTES de listar, para que `--max` cuente
  // pendientes de verdad y la lista no arrastre lo ya descargado.
  const downloadDir = options.outputDir ?? DOWNLOAD_DIRECTORY;
  const resume = options.resume !== false;
  // El manifiesto vive en la RAÍZ y es compartido: los ids de vídeo son únicos
  // globalmente, así el historial no se duplica entre perfiles.
  const manifest = new Manifest(`${downloadDir}/manifest.json`);
  if (resume) await manifest.load();

  // Cada perfil escribe en su propia subcarpeta (`downloads/scout2015`), pero
  // el filtrado y el lote deben calcular la misma ruta: se resuelve aquí.
  const isDone = async (subdir: string | null, item: ProfileVideo): Promise<boolean> =>
    resume &&
    (await manifest.isDone(item.id, itemOutputPath(joinOutputDir(downloadDir, subdir), item)));

  const limit = Number(options.max) > 0 ? Number(options.max) : null;
  const items: QueuedItem[] = [];
  let skipped = 0;

  for (const profile of profileTargets) {
    const remaining = limit === null ? null : limit - items.length;
    if (remaining !== null && remaining <= 0) break;
    const subdir = profileFolderName(profile);
    out(`\n${pc.bold("Listando perfil...")} ${maskUrl(profile)}`);
    if (subdir) out(pc.dim(`  · destino: ${joinOutputDir(downloadDir, subdir)}`));
    try {
      const listed = await source.listProfilePending(
        profile,
        (item) => isDone(subdir, item),
        remaining ?? undefined,
        (page, pending, skippedSoFar) =>
          out(
            pc.dim(
              `  · página ${page}: ${pending} pendiente(s) · ${skippedSoFar} ya descargado(s)`,
            ),
          ),
      );
      items.push(...listed.items.map((item) => ({ ...item, subdir })));
      skipped += listed.skipped;
    } catch (error) {
      fail(`✗ No se pudo listar: ${(error as Error).message}`);
    }
  }

  for (const video of videoTargets) {
    const remaining = limit === null ? null : limit - items.length;
    if (remaining !== null && remaining <= 0) break;
    out(`\n${pc.bold("Analizando vídeo...")} ${maskUrl(video)}`);
    try {
      const item = await videoUrlToItem(video, source);
      if (await isDone(null, item)) {
        skipped += 1;
        out(pc.dim(`  · ya descargado, se omite: ${item.id}`));
        continue;
      }
      // Un vídeo suelto no tiene perfil conocido: va a la raíz del destino.
      items.push({ ...item, subdir: null });
    } catch (error) {
      fail(`✗ No se pudo analizar: ${(error as Error).message}`);
    }
  }

  if (skipped > 0) {
    out(pc.dim(`  · ${skipped} ya descargado(s) se omiten de la cola`));
  }

  return { items, skipped };
}

function showProfileTable(items: QueuedItem[]): void {
  out("");
  out(pc.bold(`Vídeos del perfil (${items.length})`));
  items.forEach((item, index) => {
    const idx = String(index + 1).padStart(3, " ");
    const title = (item.title ?? "(sin título)").slice(0, 52);
    const views = item.views ? `  ${item.views}` : "";
    const folder = item.subdir ? pc.dim(`  ${item.subdir}/`) : "";
    out(`  ${pc.cyan(idx)}  ${pc.dim(item.id)}  ${title}${pc.dim(views)}${folder}`);
  });
}

async function runBatchMode(options: CliOptions): Promise<number> {
  const { items, skipped } = await collectTargets(options);
  if (items.length === 0) {
    if (skipped > 0) {
      out(pc.yellow(`No hay vídeos pendientes: los ${skipped} ya estaban descargados.`));
      out(pc.dim("Usa --no-resume para volver a descargarlos."));
      return 0;
    }
    fail("No hay vídeos que descargar.");
    return 1;
  }

  showProfileTable(items);

  if (options.listOnly) {
    out(`\n${pc.yellow("Listado terminado (--list-only).")}`);
    return 0;
  }

  if (!options.yes) {
    const downloadDir = options.outputDir ?? DOWNLOAD_DIRECTORY;
    const subdirs = [...new Set(items.map((item) => item.subdir).filter((s): s is string => !!s))];
    const layout = subdirs.length
      ? subdirs.map((s) => joinOutputDir(downloadDir, s)).join(", ")
      : downloadDir;
    out(
      `\n${pc.bold(`Se descargarán ${items.length} vídeo(s)`)} en ` +
        `${pc.cyan(layout)} (pausa ${options.delay}s entre vídeos).`,
    );
    const answer = await prompt("¿Continuar? [s/N]: ");
    if (!["s", "si", "sí", "y", "yes"].includes(answer.toLowerCase())) {
      out(pc.yellow("Cancelado."));
      return 0;
    }
  }

  const delay = Number(options.delay) || BATCH_DELAY_SECONDS;
  const downloadDir = options.outputDir ?? DOWNLOAD_DIRECTORY;

  out(`\n${pc.bold("Descargando...")}`);

  try {
    const report = await runBatch(
      items,
      {
        delay,
        resume: options.resume !== false,
        downloadDir,
        // El destino real de cada ítem es su subcarpeta de perfil; el
        // manifiesto se queda en la raíz (compartido).
        subdirFor: (item) => (item as QueuedItem).subdir ?? null,
      },
      {
        onItemStart: (index, total, item) =>
          out(`${pc.cyan(`${index}/${total}`)} ${(item.title ?? item.id).slice(0, 56)}`),
        onItemDone: (_index, _total, result) => {
          if (result.state === "ok") {
            out(pc.green(`      ✓ ${result.file} (${(result.bytes ?? 0).toLocaleString()} bytes)`));
          } else if (result.state === "skipped") {
            out(pc.dim(`      ↷ ya descargado: ${result.file}`));
          } else {
            out(pc.red(`      ✗ ${result.error}`));
          }
        },
      },
    );

    out(`\n${pc.green("✓ Lote terminado")} · ${summarize(report)}`);
    out(pc.dim(`Manifiesto: ${downloadDir}/manifest.json`));
    if (report.failed > 0) {
      warn("Reejecuta el mismo comando para reintentar los fallos.");
      return 1;
    }
    return 0;
  } catch (error) {
    if ((error as Error).name === "KeyboardInterruptLike") {
      warn("Lote interrumpido (el manifiesto conserva el progreso).");
      return 130;
    }
    throw error;
  }
}

async function runSingle(options: CliOptions): Promise<number> {
  let url = (options.url ?? "").trim();
  if (!url) url = (await prompt("Introduce una URL de TikTok:\n> ")).trim();

  if (!isTikTokUrl(url)) {
    fail("La URL no parece ser una URL válida de TikTok.");
    return 1;
  }
  if (isProfileUrl(url)) {
    return runBatchMode({ ...options, url });
  }

  out(`\n${pc.bold("Analizando vídeo...")}`);
  out(pc.green("✓ URL válida"));

  const result = await searchAny(url, { tikvid: new TikVidClient() });
  out(pc.green("✓ Información obtenida"));

  out(`\n${pc.bold("Título:")}\n${result.title ?? "(no disponible)"}`);
  out(`\n${pc.bold("ID:")}\n${result.videoId ?? "(no disponible)"}`);
  out(`\n${pc.bold("Thumbnail:")}\n${result.thumbnail ?? "(no disponible)"}`);

  out(`\n${pc.bold("Opciones:")}`);
  result.downloads.forEach((option, index) => {
    out(`  [${index + 1}] ${option.name}  ${pc.dim(optionLabel(option))}`);
  });

  const option = await selectOption(result, options.option);
  out(`\n${pc.bold("Resolviendo URL...")}`);
  const info = await resolveUrl(option.url);
  ok("✓ URL temporal encontrada");
  out(`  CDN: ${pc.cyan(new URL(info.finalUrl).hostname)}`);

  if (options.download === false) {
    out(`\n${pc.yellow("Descarga omitida (--no-download).")}`);
    out(pc.dim(maskUrl(info.finalUrl)));
    return 0;
  }

  const filename = buildFilename(result.videoId, option.quality, option.format);
  const downloadDir = options.outputDir ?? DOWNLOAD_DIRECTORY;
  const target = `${downloadDir.replace(/\/+$/, "")}/${filename}`;

  let lastPercent = -1;
  const { path, bytes } = await downloadToFile(info.finalUrl, target, (done, total) => {
    if (total) {
      const percent = Math.min(Math.round((done / total) * 100), 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        process.stdout.write(`\r  ${pc.cyan(`${percent}%`)}  ${formatDone(done, total)}`);
      }
    }
  });
  process.stdout.write("\n");

  out(`\n${pc.green("✓ Descarga completada")}`);
  out(`\n${pc.bold("Archivo:")}\n${path}  ${pc.dim(`(${bytes.toLocaleString()} bytes)`)}`);
  return 0;
}

function formatDone(done: number, total: number): string {
  const toMb = (value: number) => `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${toMb(done)} / ${toMb(total)}`;
}

async function selectOption(result: TikTokResult, requested?: string): Promise<DownloadOption> {
  const count = result.downloads.length;
  if (requested) {
    const index = Number(requested);
    if (!Number.isInteger(index) || index < 1 || index > count) {
      throw new RedlyError(`La opción ${requested} no existe (hay ${count}).`);
    }
    return result.downloads[index - 1];
  }
  for (;;) {
    const raw = (await prompt(`\nSelecciona una opción (1-${count}): `)).trim();
    if (["q", "salir", "exit"].includes(raw.toLowerCase())) {
      throw new Error("Cancelado");
    }
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 1 && index <= count) {
      return result.downloads[index - 1];
    }
    out(pc.red("Opción no válida."));
  }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).then((answer) => {
    rl.close();
    return answer;
  });
}

async function main(): Promise<number> {
  const program = new Command();
  program
    .name("redly")
    .description("Cliente TypeScript del flujo HTTP de TikVid/SavTikPro para URLs de TikTok.")
    .option("--url <url>", "URL de TikTok: vídeo (interactivo) o perfil (lote)")
    .option("--profile <perfil>", "URL de perfil o @usuario: lista y descarga en lote")
    .option("--batch <fichero>", "Fichero con una URL de TikTok (vídeo o perfil) por línea")
    .option("--max <n>", "Máximo de vídeos del lote (0 = sin límite)", String(BATCH_DEFAULT_MAX_VIDEOS))
    .option("--delay <s>", "Pausa en segundos entre vídeos", String(BATCH_DELAY_SECONDS))
    .option("--list-only", "Sólo lista los vídeos, no descarga nada")
    .option("-y, --yes", "No pide confirmación antes del lote")
    .option("--no-resume", "Vuelve a descargar lo ya marcado como completado")
    .option("--option <i>", "Índice de la opción de descarga (1-based), en modo vídeo")
    .option("--output-dir <dir>", `Carpeta de destino (por defecto: ${DOWNLOAD_DIRECTORY})`)
    .option("--no-download", "Resuelve la URL temporal pero no descarga, en modo vídeo")
    .option("--debug", "Muestra información de depuración")
    .version("1.0.0");

  program.parse();
  const options = program.opts<CliOptions>();

  out(BANNER);

  const batchMode = Boolean(options.profile || options.batch);
  const urlIsProfile = options.url ? isProfileUrl(options.url.trim()) : false;

  try {
    if (batchMode || urlIsProfile) return await runBatchMode(options);
    return await runSingle(options);
  } catch (error) {
    if ((error as Error).name === "Cancelado" || (error as Error).message === "Cancelado") {
      out(pc.yellow("\nOperación cancelada."));
      return 130;
    }
    if (error instanceof RedlyError) {
      fail(`\n✗ ${error.message}`);
      return 1;
    }
    fail(`\n✗ ${(error as Error).message ?? "Error inesperado"}`);
    if (options.debug) console.error(error);
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
