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
import { downloadWithProgress, isProfileLike, progressLabel } from "@/lib/download-stream";
import { joinDestination } from "@/lib/fsaccess";
import { bestQualityOption, type DownloadOption, type ProfileVideo, type TikTokResult } from "@/lib/models";
import type { Platform } from "@/lib/platforms";
import { inputToTikTokUrl, profileFolderName } from "@/lib/urls";

type Mode = "idle" | "video" | "profile";

interface Status {
  kind: "info" | "ok" | "error";
  text: string;
}

const DEFAULT_STATUS: Status = { kind: "info", text: "Pega una URL de TikTok para empezar" };

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
  next_cursor?: string | number | null;
}

/**
 * Nombre de archivo de una opción del resultado.
 *
 * En un carrusel se numeran las fotos (`Redly_<id>_3.jpeg`): sin el índice,
 * todas acabarían con el mismo nombre y se pisarían en el destino.
 */
function optionFilename(
  videoId: string | null | undefined,
  option: DownloadOption,
  photoIndex: number,
  photoCount: number,
): string {
  const id = videoId && /^\d+$/.test(videoId) ? videoId : "video";
  const isImage = option.kind === "image";
  const suffix = isImage && photoCount > 1 ? `_${photoIndex + 1}` : "";
  const extension = option.format ?? (isImage ? "jpeg" : "mp4");
  return `Redly_${id}${suffix}.${extension}`;
}

/** Índice de la primera opción que no sea imagen (las calidades de vídeo/audio). */
function firstMediaIndex(result: TikTokResult): number {
  const index = result.downloads.findIndex((option) => option.kind !== "image");
  return index === -1 ? 0 : index;
}

/**
 * Pide al servidor las opciones del post y devuelve la de máxima calidad.
 *
 * El listado de perfil sólo entrega el MP4 estándar; el HD sólo aparece al
 * analizar el post. Si la petición falla, está limitada por tasa o no hay HD,
 * se devuelve `null` y se conserva la URL del listado: mejorar la calidad nunca
 * debe impedir que el vídeo se descargue.
 */
async function fetchBestQualityUrl(postUrl: string): Promise<string | null> {
  try {
    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: postUrl }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { ok?: boolean; result?: TikTokResult };
    if (!data.ok || !data.result) return null;
    return bestQualityOption(data.result)?.url ?? null;
  } catch {
    return null;
  }
}

export default function Downloader({ platform }: { platform: Platform }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [status, setStatus] = useState<Status>(DEFAULT_STATUS);
  const [busy, setBusy] = useState(false);

  const [result, setResult] = useState<TikTokResult | null>(null);
  const [selected, setSelected] = useState(0);

  const [items, setItems] = useState<ProfileVideo[]>([]);
  const [profileWanted, setProfileWanted] = useState<number>(DEFAULT_PROFILE_WANTED);
  const [profileStats, setProfileStats] = useState<ProfileStats>({ pending: 0, done: 0, pages: 0 });
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

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
    setSelected(0);
    setDoneIds(new Set());
    setCheckedIds(new Set());
    setProfileStats({ pending: 0, done: 0, pages: 0 });
    setProgress(IDLE_PROGRESS);
  }, []);

  /**
   * «Limpiar» del modo vídeo. `reset` sólo borra los datos, así que además se
   * vuelve a `idle`: si no, el panel dejaría de pintarse (porque `result` es
   * nulo) pero tampoco se mostrarían las tarjetas de modo.
   */
  const clearResult = useCallback(() => {
    reset();
    setMode("idle");
    setStatus(DEFAULT_STATUS);
  }, [reset]);

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
   * Devuelve el listado, el reparto pendiente/ya bajado y las páginas usadas.
   */
  const listProfile = useCallback(
    async (target: string, wanted: number) => {
      const collected: ProfileVideo[] = [];
      const seen = new Set<string>();
      let cursor: string | null = null;
      let page = 1;
      let pages = 0;
      let doneFound = 0;

      for (;;) {
        setStatus({
          kind: "info",
          text: `Listando perfil… página ${page} · ${collected.length} vídeo(s)`,
        });

        const response = await fetch("/api/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target, cursor, page }),
        });
        const data = (await response.json()) as ProfilePageResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error ?? "No se pudo listar el perfil.");
        }

        for (const item of data.items ?? []) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          collected.push(item);
          if (history.isDone(item.id)) doneFound += 1;
        }

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
      return { collected, done, pending, pages };
    },
    [history],
  );

  const analyze = useCallback(async () => {
    const target = inputToTikTokUrl(url);
    if (!target) {
      setStatus({ kind: "error", text: "Introduce una URL de TikTok." });
      inputRef.current?.focus();
      return;
    }

    reset();
    setBusy(true);
    setStatus({ kind: "info", text: "Analizando…" });

    try {
      if (isProfileLike(target)) {
        const wanted =
          Number.isFinite(profileWanted) && profileWanted > 0
            ? Math.floor(profileWanted)
            : DEFAULT_PROFILE_WANTED;

        const { collected, done, pending, pages } = await listProfile(target, wanted);

        setItems(collected);
        setDoneIds(new Set(done.map((item) => item.id)));
        setCheckedIds(new Set(pending.map((item) => item.id)));
        setProfileStats({ pending: pending.length, done: done.length, pages });
        setMode("profile");
        setStatus({
          kind: "ok",
          text: `Perfil listo · ${pending.length} pendiente(s) · ${done.length} ya descargado(s)`,
        });
      } else {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          result?: TikTokResult;
        };
        if (!response.ok || !data.ok || !data.result) {
          throw new Error(data.error ?? "No se pudo analizar el vídeo.");
        }

        setResult(data.result);
        setMode("video");
        setSelected(firstMediaIndex(data.result));
        setStatus({ kind: "ok", text: `Listo · ${data.result.downloads.length} opción(es) encontradas` });
      }
    } catch (error) {
      setMode("idle");
      setStatus({ kind: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }, [url, reset, profileWanted, listProfile]);

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

      setBusy(true);
      setStatus({ kind: "info", text: option.kind === "image" ? "Descargando foto…" : "Descargando…" });
      setProgress({ done: 0, total: null, label: "Conectando con el CDN…", indeterminate: true });

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

    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      setStatus({ kind: "info", text: `Descargando vídeo ${index + 1} de ${queue.length}…` });
      setProgress({
        done: 0,
        total: null,
        label: `${index + 1}/${queue.length} · ${item.title ?? item.id}`,
        indeterminate: true,
      });

      const name = `Redly_${item.id}.${item.format ?? "mp4"}`;
      try {
        // El listado sólo trae el MP4 estándar: se busca el HD y, si no lo hay
        // o falla la consulta, se baja el que ya se tenía.
        const sourceUrl = item.postUrl
          ? (await fetchBestQualityUrl(item.postUrl)) ?? item.url
          : item.url;
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
  }, [items, checkedIds, destination, history, destSubdir]);

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
              Pega la URL de un vídeo o de un perfil público. El servidor hace de proxy: tu
              navegador nunca habla directamente con {platform.name}.
            </p>
          </div>
        </div>

        <div className="chips">
          <span className="chip">
            <Video size={13} /> Vídeo individual
          </span>
          <span className="chip">
            <ListUl size={13} /> Perfil completo en lote
          </span>
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
              placeholder={`@usuario  ·  o la URL de un vídeo o foto`}
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
              <div className="mode-card">
                <span className="mode-card__icon" aria-hidden="true">
                  <ListUl size={15} />
                </span>
                <span className="mode-card__body">
                  <span className="mode-card__title">Un perfil entero</span>
                  <span className="mode-card__text">
                    Se pagina el listado y se bajan los pendientes uno a uno, con reanudación y
                    carpeta propia.
                  </span>
                </span>
              </div>
            </div>
            <div className="hint">
              Acepta la URL de un <b>vídeo</b> o la de un <b>perfil</b> (<code>@usuario</code>).
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
            onReset={clearResult}
          />
        )}

        {mode === "profile" && (
          <ProfilePanel
            items={items}
            stats={profileStats}
            wanted={profileWanted}
            doneIds={doneIds}
            checkedIds={checkedIds}
            busy={busy}
            historyCount={history.count}
            historyAvailable={history.available}
            destination={destination}
            onWantedChange={setProfileWanted}
            onToggleChecked={toggleChecked}
            onSelectAll={selectAllChecked}
            onSelectNone={clearChecked}
            onReanalyze={() => void analyze()}
            onClearHistory={clearHistory}
            onDownloadAll={() => void downloadAll()}
            onReset={reset}
          />
        )}

        <ProgressBar progress={progress} visible={busy || Boolean(progress.label)} />
      </main>

      <SiteFooter />
    </div>
  );
}
