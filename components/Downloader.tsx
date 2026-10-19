"use client";

/**
 * Descargador multiplataforma.
 *
 * Este componente es el **orquestador**: mantiene el estado del flujo (URL →
 * análisis → resultado) y coordina las piezas extraídas:
 *
 * - `useDestination`      → selector de carpeta y fábrica de destinos.
 * - `useDownloadHistory`  → historial reactivo de descargas.
 * - `downloadWithProgress` (`lib/download-stream.ts`) → streaming con progreso.
 * - `VideoPanel` / `ProfilePanel` → resultados, sin lógica de estado.
 *
 * La paginación del perfil se hace invocación a invocación contra
 * `/api/profile`: cada llamada es corta y así no se choca con el `maxDuration`
 * de la función serverless.
 */

import { useCallback, useRef, useState } from "react";

import PlatformIcon from "@/components/PlatformIcon";
import ProgressBar, { IDLE_PROGRESS, type ProgressState } from "@/components/downloader/ProgressBar";
import ProfilePanel, { type ProfileStats } from "@/components/downloader/ProfilePanel";
import VideoPanel from "@/components/downloader/VideoPanel";
import { useDestination } from "@/components/downloader/useDestination";
import { useDownloadHistory } from "@/components/downloader/useDownloadHistory";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import {
  CircleCheck,
  CircleInfo,
  Download,
  ListUl,
  Lock,
  TriangleExclamation,
  Video,
} from "@/components/icons";
import { downloadWithProgress, progressLabel } from "@/lib/download-stream";
import { joinDestination } from "@/lib/fsaccess";
import {
  batchOption,
  type BatchQuality,
  type DownloadOption,
  type ProfileVideo,
  type TikTokResult,
} from "@/lib/models";
import { getPlatform, type Platform } from "@/lib/platforms";
import type { ProfileMeta } from "@/lib/savetik";
import { classifyInput } from "@/lib/urlrules";
import { profileFolderName } from "@/lib/urls";

type Mode = "idle" | "video" | "profile";

interface Status {
  kind: "info" | "ok" | "error";
  text: string;
}

/** Mensaje inicial, en función de la plataforma de la página. */
function defaultStatus(platform: Platform): Status {
  return { kind: "info", text: `Pega una URL de ${platform.name} para empezar` };
}

/** Vídeos pendientes que se buscan por defecto al analizar un perfil. */
const DEFAULT_PROFILE_WANTED = 100;
/** Máximo de páginas (invocaciones de la API) por análisis. */
const MAX_ANALYSIS_PAGES = 30;
/** Pausa entre invitaciones al paginar el perfil. */
const PROFILE_PAGE_PAUSE_MS = 300;
/** Pausa entre descargas del lote en el navegador. */
const BATCH_PAUSE_MS = 700;

interface ProfilePageResponse {
  ok?: boolean;
  error?: string;
  items?: ProfileVideo[];
  meta?: ProfileMeta | null;
  next_cursor?: string | number | null;
}

/**
 * Nombre de archivo de una opción del resultado.
 *
 * En un carrusel se numeran las fotos (`Redly_<id>_3.jpeg`): sin el índice,
 * todas acabarían con el mismo nombre y se pisarían en el destino. El id se
 * usa sólo si es un identificador razonable: los de TikTok son numéricos y
 * los de YouTube alfanuméricos (`dQw4w9WgXcQ`); cualquier otra cosa cae a
 * «video» para no generar nombres raros.
 */
function optionFilename(
  videoId: string | null | undefined,
  option: DownloadOption,
  photoIndex: number,
  photoCount: number,
): string {
  const usable = videoId && /^[A-Za-z0-9_-]{6,}$/.test(videoId);
  const id = usable ? videoId : "video";
  const isImage = option.kind === "image";
  const suffix = isImage && photoCount > 1 ? `_${photoIndex + 1}` : "";
  const extension = option.format ?? (isImage ? "jpeg" : "mp4");
  return `Redly_${id}${suffix}.${extension}`;
}

/**
 * Índice de la opción preseleccionada al mostrar un resultado.
 *
 * La preselección es la **recomendada**: la primera pista de medios que ya
 * trae audio por sí misma (la progresiva de YouTube, el MP4 estándar de
 * TikTok). Si ninguna lo declara, se marca la primera opción de medios.
 */
function preferredMediaIndex(result: TikTokResult): number {
  const withAudio = result.downloads.findIndex(
    (option) => option.kind !== "image" && option.hasAudio === true,
  );
  if (withAudio !== -1) return withAudio;
  const first = result.downloads.findIndex((option) => option.kind !== "image");
  return first === -1 ? 0 : first;
}

/**
 * Lee la respuesta JSON de la API.
 *
 * Si el cuerpo viene vacío o cortado (timeout de la función, proxy, red
 * caída), `response.json()` lanza un `SyntaxError` crudo
 * («Unexpected end of JSON input») que se escaparía al estado de la UI; aquí
 * se convierte en un mensaje claro con el código HTTP.
 */
async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`El servidor no respondió con JSON (HTTP ${response.status}).`);
  }
}

/**
 * Pide al servidor las opciones del post y elige la de calidad indicada.
 *
 * El listado sólo entrega el MP4 estándar; las calidades reales sólo aparecen
 * al analizar el post. Si la petición falla o está limitada por tasa se
 * devuelve `null` y se conserva la URL del listado: mejorar la calidad nunca
 * debe impedir que el vídeo se descargue.
 *
 * La selección vive en `batchOption` (`lib/models.ts`): en `recommended` sólo
 * se consideran opciones directas; en `max` también las que SnapYT sirve como
 * combinación (`/api/merge?…`), marcadas con `isMerge` para que el lote ejecute
 * esa fase antes de streamar; en `audio` sólo la pista de sonido.
 */
async function fetchQualityUrl(
  postUrl: string,
  mode: BatchQuality,
): Promise<{ url: string; isMerge: boolean; format?: string | null } | null> {
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: postUrl }),
    });
    if (!response.ok) return null;
    const data = await readJson<{ ok?: boolean; result?: TikTokResult }>(response);
    if (!data.ok || !data.result) return null;
    const option = batchOption(data.result, mode);
    return option
      ? { url: option.url, isMerge: option.url.startsWith("/"), format: option.format }
      : null;
  } catch {
    return null;
  }
}

export default function Downloader({ platform }: { platform: Platform }) {
  // En YouTube el modo «perfil» es el listado de una lista de reproducción
  // (no un @usuario): la copia de la UI se ajusta al sustantivo correcto.
  const isPlaylistPlatform = platform.slug === "youtube";
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [status, setStatus] = useState<Status>(() => defaultStatus(platform));
  const [busy, setBusy] = useState(false);

  const [result, setResult] = useState<TikTokResult | null>(null);
  const [selected, setSelected] = useState(0);

  const [items, setItems] = useState<ProfileVideo[]>([]);
  const [profileMeta, setProfileMeta] = useState<ProfileMeta | null>(null);
  const [profileWanted, setProfileWanted] = useState<number>(DEFAULT_PROFILE_WANTED);
  const [profileStats, setProfileStats] = useState<ProfileStats>({ pending: 0, done: 0, pages: 0 });
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  /** Calidad con la que baja el lote; sólo tiene efecto en listas de YouTube. */
  const [qualityMode, setQualityMode] = useState<BatchQuality>("recommended");

  const [progress, setProgress] = useState<ProgressState>(IDLE_PROGRESS);

  const inputRef = useRef<HTMLInputElement>(null);
  const history = useDownloadHistory();

  /** Subcarpeta del perfil en curso; `null` en modo vídeo (se escribe directo). */
  const destSubdir = mode === "profile" ? profileFolderName(url) : null;
  const destination = useDestination({
    subdir: destSubdir,
    onError: (message) => setStatus({ kind: "error", text: message }),
  });

  const reset = useCallback(() => {
    setResult(null);
    setItems([]);
    setProfileMeta(null);
    setSelected(0);
    setDoneIds(new Set());
    setCheckedIds(new Set());
    setProfileStats({ pending: 0, done: 0, pages: 0 });
    setProgress(IDLE_PROGRESS);
  }, []);

  /**
   * «Limpiar» de ambos paneles. `reset` sólo borra los datos del resultado,
   * así que además se vuelve a `idle`, se vacía la URL del input y se
   * restaura el contador de vídeos a buscar: al terminar debe quedar la misma
   * pantalla que al entrar por primera vez (sin nada residual del análisis).
   *
   * No se toca la carpeta elegida (`useDestination`): es una preferencia del
   * usuario, no datos del resultado.
   */
  const clearAll = useCallback(() => {
    reset();
    setMode("idle");
    setUrl("");
    setProfileWanted(DEFAULT_PROFILE_WANTED);
    setStatus(defaultStatus(platform));
  }, [reset, platform]);

  const clearHistory = useCallback(() => {
    history.clear();
    // Las casillas dejan de saber qué está hecho: se marcan todas como pendientes.
    setDoneIds(new Set());
    setCheckedIds(new Set(items.map((item) => item.id)));
    setProfileStats((stats) => ({ ...stats, done: 0, pending: items.length }));
    setStatus({ kind: "ok", text: "Historial borrado." });
  }, [history, items]);

  const toggleChecked = useCallback((id: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Marca todos los seleccionables; los ya bajados quedan fuera (casilla bloqueada). */
  const selectAllChecked = useCallback(() => {
    setCheckedIds(
      new Set(items.filter((item) => !doneIds.has(item.id)).map((item) => item.id)),
    );
  }, [items, doneIds]);

  /** Vacía la selección sin tocar el listado ni el historial. */
  const clearChecked = useCallback(() => {
    setCheckedIds(new Set());
  }, []);

  // --- Análisis ---------------------------------------------------------

  /**
   * Pagina `/api/profile` hasta reunir suficientes pendientes.
   * Devuelve el listado, el reparto pendiente/ya bajado, las páginas usadas
   * y los metadatos del listado (título/canal/total, si los aporta la fuente).
   */
  const listProfile = useCallback(
    async (target: string, wanted: number) => {
      const collected: ProfileVideo[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      let page = 1;
      let pages = 0;
      let doneFound = 0;
      let meta: ProfileMeta | null = null;

      for (;;) {
        setStatus({
          kind: "info",
          text: `Listando… página ${page} · ${collected.length} vídeo(s)`,
        });

        const response: Response = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target, cursor, page }),
        });
        const data: ProfilePageResponse = await readJson<ProfilePageResponse>(response);
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "No se pudo hacer el listado.");
        }

        for (const item of data.items ?? []) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          collected.push(item);
          if (history.isDone(item.id)) doneFound += 1;
        }
        // Los metadatos del listado viajan con la primera página; si una
        // fuente no los aporta, se queda `null` y la UI usa texto genérico.
        if (!meta && data.meta) meta = data.meta;

        pages += 1;
        const pendingCount = collected.length - doneFound;
        const rawNext = data.next_cursor;
        const nextCursor =
          rawNext === null || rawNext === undefined || String(rawNext).trim() === ""
            ? null
            : String(rawNext);

        if (pendingCount >= wanted) break;
        if (nextCursor === null) break;
        if (pages >= MAX_ANALYSIS_PAGES) break;

        await new Promise((resolve) => setTimeout(resolve, PROFILE_PAGE_PAUSE_MS));
        cursor = nextCursor;
        page += 1;
      }

      const done = collected.filter((item) => history.isDone(item.id));
      const pending = collected.filter((item) => !history.isDone(item.id));
      return { collected, done, pending, pages, meta };
    },
    [history],
  );

  const analyze = useCallback(async () => {
    const classified = classifyInput(url);
    if (!classified) {
      setStatus({ kind: "error", text: `Introduce una URL de ${platform.name}.` });
      inputRef.current?.focus();
      return;
    }
    // Cada página descarga sólo su plataforma: detectar por host basta para
    // enrutar la API, pero aquí se compara con la de la página para no
    // procesar una URL ajena con el flujo equivocado.
    if (classified.slug !== platform.slug) {
      const other = getPlatform(classified.slug)?.name ?? "otra plataforma";
      setStatus({
        kind: "error",
        text: `Esa URL es de ${other}. Introduce una URL de ${platform.name}.`,
      });
      inputRef.current?.focus();
      return;
    }

    // Los canales/listas se descartan aquí para no mandarlos a la API: la
    // respuesta sería un error igual, pero llega antes y con mejor mensaje.
    const classifiedPlatform = getPlatform(classified.slug);
    if (classified.kind === "profile" && classifiedPlatform?.profilesReady !== true) {
      setStatus({
        kind: "error",
        text: `Los canales de ${classifiedPlatform?.name ?? "esa plataforma"} aún no están disponibles.`,
      });
      return;
    }
    if (classified.kind === "unsupported") {
      setStatus({
        kind: "error",
        text: `Esa URL de ${classifiedPlatform?.name ?? "esa plataforma"} no corresponde a un vídeo concreto.`,
      });
      return;
    }

    reset();
    setBusy(true);
    setStatus({ kind: "info", text: "Analizando…" });

    try {
      if (classified.kind === "profile") {
        const wanted =
          Number.isFinite(profileWanted) && profileWanted > 0
            ? Math.floor(profileWanted)
            : DEFAULT_PROFILE_WANTED;

        const { collected, done, pending, pages, meta } = await listProfile(classified.url, wanted);

        setItems(collected);
        setProfileMeta(meta);
        setDoneIds(new Set(done.map((item) => item.id)));
        setCheckedIds(new Set(pending.map((item) => item.id)));
        setProfileStats({ pending: pending.length, done: done.length, pages });
        setMode("profile");
        setStatus({
          kind: "ok",
          text: `Listado listo · ${pending.length} pendiente(s) · ${done.length} ya descargado(s)`,
        });
      } else {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: classified.url }),
        });
        const data = await readJson<{
          ok?: boolean;
          error?: string;
          result?: TikTokResult;
        }>(response);
        if (!response.ok || !data.ok || !data.result) {
          throw new Error(data.error ?? "No se pudo analizar el vídeo.");
        }

        setResult(data.result);
        setMode("video");
        setSelected(preferredMediaIndex(data.result));
        setStatus({ kind: "ok", text: `Listo · ${data.result.downloads.length} opción(es) encontradas` });
      }
    } catch (error) {
      setMode("idle");
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }, [url, reset, profileWanted, listProfile, platform]);

  // --- Descargas --------------------------------------------------------

  const downloadOption = useCallback(
    async (index: number) => {
      if (!result) return;
      const option: DownloadOption | undefined = result.downloads[index];
      if (!option) return;

      const images = result.downloads.filter((item) => item.kind === "image");
      const photoIndex = result.downloads
        .slice(0, index)
        .filter((item) => item.kind === "image").length;
      const name = optionFilename(result.videoId, option, photoIndex, images.length);

      // Una URL relativa (`/api/merge?…`) es una opción de YouTube que el
      // servidor debe combinar (vídeo + audio) antes de poder descargarla.
      const isMerge = option.url.startsWith("/");

      setBusy(true);
      setStatus({
        kind: "info",
        text: isMerge
          ? "Combinando vídeo y audio en el servidor…"
          : option.kind === "image"
            ? "Descargando foto…"
            : "Descargando…",
      });
      setProgress({
        done: 0,
        total: null,
        label: isMerge ? "Preparando la mezcla (puede tardar)…" : "Conectando con el CDN…",
        indeterminate: true,
      });

      try {
        let sourceUrl = option.url;
        if (isMerge) {
          // Fase 1: SnapYT une las pistas y devuelve la URL temporal del
          // archivo ya con audio (el progreso real empieza en la fase 2).
          const prepared = await fetch(option.url);
          const data = (await prepared.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
            url?: string;
          };
          if (!prepared.ok || !data.ok || !data.url) {
            throw new Error(data.error ?? "No se pudo combinar el vídeo con audio.");
          }
          sourceUrl = data.url;
          setProgress({
            done: 0,
            total: null,
            label: "Descargando el archivo combinado…",
            indeterminate: true,
          });
        }

        // Fase 2 (y flujo normal): stream con progreso vía /api/download.
        const params = new URLSearchParams({ url: sourceUrl, name });
        const bytes = await downloadWithProgress(
          `/api/download?${params.toString()}`,
          name,
          destination.makeSink,
          (done, total) => {
            setProgress({
              done,
              total,
              label: progressLabel(done, total),
              indeterminate: false,
            });
          },
        );
        if (result.videoId) {
          history.mark(result.videoId, "ok", {
            file: name,
            bytes: bytes ?? undefined,
            title: result.title ?? undefined,
          });
        }
        setStatus({ kind: "ok", text: "Descarga completada" });
        setProgress((p) => ({
          ...p,
          label: destination.dirHandle
            ? `Guardado en ${destination.label}`
            : "Guardado en Descargas",
          indeterminate: false,
        }));
      } catch (error) {
        setStatus({ kind: "error", text: (error as Error).message });
        setProgress(IDLE_PROGRESS);
      } finally {
        setBusy(false);
      }
    },
    [result, destination, history],
  );

  /**
   * Descarga las fotos de un carrusel una a una.
   *
   * Cada foto lleva su propia clave de historial (`<id>#<n>`): el historial
   * guarda por id, y con una sola clave todas se pisarían entre sí.
   */
  const downloadPhotos = useCallback(async () => {
    if (!result) return;
    const photos = result.downloads.filter((option) => option.kind === "image");
    if (photos.length === 0) return;

    setBusy(true);
    let completed = 0;
    let failed = 0;
    let lastError: string | null = null;

    for (let index = 0; index < photos.length; index++) {
      const option = photos[index];
      const name = optionFilename(result.videoId, option, index, photos.length);
      setStatus({ kind: "info", text: `Descargando foto ${index + 1} de ${photos.length}…` });
      setProgress({
        done: 0,
        total: null,
        label: `${index + 1}/${photos.length} · ${name}`,
        indeterminate: true,
      });

      try {
        const params = new URLSearchParams({ url: option.url, name });
        const bytes = await downloadWithProgress(
          `/api/download?${params.toString()}`,
          name,
          destination.makeSink,
          (done, total) => {
            setProgress({
              done,
              total,
              label: progressLabel(done, total, `${index + 1}/${photos.length}`),
              indeterminate: false,
            });
          },
        );
        completed += 1;
        if (result.videoId) {
          history.mark(`${result.videoId}#${index + 1}`, "ok", {
            file: name,
            bytes,
            title: result.title ?? undefined,
          });
        }
      } catch (error) {
        failed += 1;
        lastError = (error as Error)?.message ?? "Error desconocido";
      }

      // Misma pausa que en el lote de perfil: no golpear al CDN.
      if (index < photos.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
      }
    }

    setBusy(false);
    setStatus({
      kind: failed === 0 ? "ok" : "error",
      text: `Fotos terminadas · ${completed} descargada(s) · ${failed} fallo(s)${
        failed > 0 ? ` · ${lastError ?? ""}` : ""
      }`,
    });
    setProgress({
      done: 0,
      total: null,
      label: destination.dirHandle ? `Guardadas en ${destination.label}` : "Guardadas en Descargas",
      indeterminate: false,
    });
  }, [result, destination, history]);

  const downloadAll = useCallback(async () => {
    const queue = items.filter((item) => checkedIds.has(item.id));
    if (queue.length === 0) {
      setStatus({ kind: "info", text: "No hay vídeos marcados para descargar." });
      return;
    }

    setBusy(true);
    let completed = 0;
    let failed = 0;
    let lastError: string | null = null;
    const mediaWord = qualityMode === "audio" ? "audio" : "vídeo";

    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      const position = `${index + 1}/${queue.length}`;
      setStatus({ kind: "info", text: `Descargando ${mediaWord} ${index + 1} de ${queue.length}…` });
      setProgress({
        done: 0,
        total: null,
        label: `${position} · ${item.title ?? item.id}`,
        indeterminate: true,
      });

      try {
        // El listado sólo trae el MP4 estándar: se resuelve la calidad pedida
        // (y, si no llega o falla la consulta, se baja el que ya se tenía).
        const resolved = item.postUrl ? await fetchQualityUrl(item.postUrl, qualityMode) : null;

        // En modo audio no se recurre al MP4 del listado: quien pidió sonido
        // recibiría un vídeo si la consulta fallara, que es peor que un fallo
        // contado en el resumen del lote.
        if (!resolved && qualityMode === "audio") {
          throw new Error("Sin pista de audio disponible; se omite este vídeo.");
        }

        const chosen = resolved ?? { url: item.url, isMerge: false, format: item.format };

        // Una URL relativa (`/api/merge?…`) es una opción de YouTube que el
        // servidor debe combinar (vídeo + audio) antes de poder descargarla.
        let sourceUrl = chosen.url;
        if (chosen.isMerge) {
          setProgress({
            done: 0,
            total: null,
            label: `${position} · Combinando vídeo y audio…`,
            indeterminate: true,
          });
          const prepared = await fetch(chosen.url);
          const merged = (await prepared.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
            url?: string;
          };
          if (!prepared.ok || !merged.ok || !merged.url) {
            throw new Error(merged.error ?? "No se pudo combinar el vídeo con audio.");
          }
          sourceUrl = merged.url;
          setProgress({
            done: 0,
            total: null,
            label: `${position} · Descargando el archivo combinado…`,
            indeterminate: true,
          });
        }

        // El nombre usa el formato de la opción resuelta (mp4 tras combinar;
        // mp3/m4a/opus en modo audio).
        const extension = chosen.isMerge
          ? "mp4"
          : (chosen.format ?? (qualityMode === "audio" ? "mp3" : (item.format ?? "mp4")));
        const name = `Redly_${item.id}.${extension}`;
        const params = new URLSearchParams({ url: sourceUrl, name });
        const bytes = await downloadWithProgress(
          `/api/download?${params.toString()}`,
          name,
          destination.makeSink,
          (done, total) => {
            setProgress({
              done,
              total,
              label: progressLabel(done, total, `${index + 1}/${queue.length}`),
              indeterminate: false,
            });
          },
        );
        completed += 1;
        // Se persiste tras cada vídeo: un corte no pierde el progreso ya hecho.
        history.mark(item.id, "ok", { file: name, bytes, title: item.title ?? undefined });
        setDoneIds((current) => new Set(current).add(item.id));
        setCheckedIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
        setProfileStats((stats) => ({
          ...stats,
          pending: Math.max(0, stats.pending - 1),
          done: stats.done + 1,
        }));
      } catch (error) {
        failed += 1;
        lastError = (error as Error)?.message ?? "Error desconocido";
        history.mark(item.id, "error", {
          title: item.title ?? undefined,
          error: lastError,
        });
      }

      // Pequeña pausa entre vídeos para no golpear al servicio.
      if (index < queue.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
      }
    }

    setBusy(false);
    setStatus({
      kind: failed === 0 ? "ok" : "error",
      text: `Lote terminado · ${completed} descargado(s) · ${failed} fallo(s)${
        failed > 0 ? ` · ${lastError ?? ""}` : ""
      }`,
    });
    setProgress({
      done: 0,
      total: null,
      label: destination.dirHandle
        ? `Guardados en ${joinDestination(destination.dirLabel ?? "", destSubdir)}`
        : destSubdir
          ? `Guardados en Descargas/${destSubdir}`
          : "Guardados en Descargas",
      indeterminate: false,
    });
  }, [items, checkedIds, qualityMode, destination, history, destSubdir]);

  const busyLabel = busy && status.kind === "info" ? status.text : null;

  // --- Render -----------------------------------------------------------

  return (
    <div className="shell">
      <SiteHeader />

      <main className="main">
        <div className="tool-head" style={{ "--tile": platform.accent } as React.CSSProperties}>
          <span className="tool-head__icon" aria-hidden="true">
            <PlatformIcon slug={platform.slug} size={22} />
          </span>
          <div className="tool-head__body">
            <h1 className="tool-head__title">Descargar de {platform.name}</h1>
            <p className="tool-head__lead">
              Pega la URL de un vídeo
              {platform.profilesReady
                ? isPlaylistPlatform
                  ? " o la de una lista de reproducción"
                  : " o de un perfil público"
                : ""}
              . El servidor hace de proxy: tu navegador nunca habla directamente con{" "}
              {platform.name}.
            </p>
          </div>
        </div>

        <div className="chips">
          <span className="chip">
            <Video size={13} /> Vídeo individual
          </span>
          {platform.profilesReady && (
            <span className="chip">
              <ListUl size={13} /> {isPlaylistPlatform ? "Lista completa en lote" : "Perfil completo en lote"}
            </span>
          )}
          <span className="chip">
            <Lock size={13} /> Sin registro
          </span>
        </div>

        <div className="card tool-card">
          <label className="label" htmlFor="url">
            URL de {platform.name}
          </label>
          <div className="url-row">
            <input
              id="url"
              ref={inputRef}
              className="input"
              type="url"
              spellCheck={false}
              placeholder={
                platform.profilesReady
                  ? isPlaylistPlatform
                    ? `la URL de un vídeo o una lista de reproducción`
                    : `@usuario  ·  o la URL de un vídeo o foto`
                  : `la URL de un vídeo de ${platform.name}`
              }
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy) void analyze();
              }}
            />
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void analyze()}
              disabled={busy}
            >
              {busyLabel ?? "Analizar"}
            </button>
          </div>

          <div className={`status status--${status.kind}`}>
            <span className="status__icon" aria-hidden="true">
              {status.kind === "ok" ? (
                <CircleCheck size={14} />
              ) : status.kind === "error" ? (
                <TriangleExclamation size={14} />
              ) : (
                <CircleInfo size={14} />
              )}
            </span>
            <span>{status.text}</span>
          </div>
        </div>

        {mode === "idle" && (
          <>
            <div className="mode-grid">
              <div className="mode-card">
                <span className="mode-card__icon" aria-hidden="true">
                  <Video size={15} />
                </span>
                <span className="mode-card__body">
                  <span className="mode-card__title">Un vídeo suelto</span>
                  <span className="mode-card__text">
                    Se analiza solo. Elige entre las calidades y formatos que encuentre el
                    servicio.
                  </span>
                </span>
              </div>
              {platform.profilesReady && (
                <div className="mode-card">
                  <span className="mode-card__icon" aria-hidden="true">
                    <ListUl size={15} />
                  </span>
                  <span className="mode-card__body">
                  <span className="mode-card__title">
                    {isPlaylistPlatform ? "Una lista completa" : "Un perfil entero"}
                  </span>
                  <span className="mode-card__text">
                    {isPlaylistPlatform
                      ? "Se lista la reproducción completa y se bajan los vídeos uno a uno, con reanudación y carpeta propia."
                      : "Se pagina el listado y se bajan los pendientes uno a uno, con reanudación y carpeta propia."}
                  </span>
                  </span>
                </div>
              )}
            </div>
            <div className="hint">
              {platform.profilesReady ? (
                <>
                  Acepta la URL de un <b>vídeo</b> o la de una{" "}
                  <b>{isPlaylistPlatform ? "lista de reproducción" : "perfil"}</b>
                  {isPlaylistPlatform ? "" : " (<code>@usuario</code>)"}.
                </>
              ) : (
                <>
                  Acepta la URL de un <b>vídeo</b> (también Shorts y enlaces{" "}
                  <code>youtu.be</code>).
                </>
              )}{" "}
              Sólo se admite contenido público: no se eluden CAPTCHA ni controles de acceso.
            </div>
          </>
        )}

        {mode === "video" && result && (
          <VideoPanel
            result={result}
            selected={selected}
            busy={busy}
            destination={destination}
            onSelect={setSelected}
            onDownloadOption={(index) => void downloadOption(index)}
            onDownloadPhotos={() => void downloadPhotos()}
            onReset={clearAll}
          />
        )}

        {mode === "profile" && (
          <ProfilePanel
            items={items}
            meta={profileMeta}
            stats={profileStats}
            wanted={profileWanted}
            doneIds={doneIds}
            checkedIds={checkedIds}
            busy={busy}
            historyCount={history.count}
            historyAvailable={history.available}
            destination={destination}
            // El selector sólo aparece donde hay más de una calidad real: en
            // YouTube la resolución alta requiere combinación; en TikTok el
            // listado ya resuelve el HD, así que no hay nada que elegir.
            qualityMode={qualityMode}
            qualityOptions={
              isPlaylistPlatform
                ? [
                    { value: "recommended", label: "Recomendada (con audio)" },
                    { value: "max", label: "Máxima calidad (con combinación)" },
                    { value: "audio", label: "Solo audio" },
                  ]
                : []
            }
            onQualityChange={setQualityMode}
            onWantedChange={setProfileWanted}
            onToggleChecked={toggleChecked}
            onSelectAll={selectAllChecked}
            onSelectNone={clearChecked}
            onReanalyze={() => void analyze()}
            onClearHistory={clearHistory}
            onDownloadAll={() => void downloadAll()}
            onReset={clearAll}
          />
        )}

        <ProgressBar progress={progress} visible={busy || Boolean(progress.label)} />
      </main>

      <SiteFooter />
    </div>
  );
}
