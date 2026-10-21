"use client";

/**
 * Página del descargador por plataforma (`/download/<slug>`).
 *
 * Sólo la UI: el estado y las acciones viven en `useDownloaderEngine`
 * (compartido con el buscador de la portada). Aquí se pinta el encabezado de
 * la plataforma, el campo de su URL y los paneles de resultado.
 */

import { useEffect, useRef } from "react";

import PlatformIcon from "@/components/PlatformIcon";
import ProgressBar from "@/components/downloader/ProgressBar";
import ProfilePanel from "@/components/downloader/ProfilePanel";
import VideoPanel from "@/components/downloader/VideoPanel";
import { useDownloaderEngine } from "@/components/downloader/useDownloaderEngine";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import {
  CircleCheck,
  CircleInfo,
  ListUl,
  Lock,
  TriangleExclamation,
  Video,
} from "@/components/icons";
import type { Platform } from "@/lib/platforms";

export default function Downloader({ platform }: { platform: Platform }) {
  const engine = useDownloaderEngine({ platform });
  const {
    url,
    setUrl,
    mode,
    status,
    busy,
    busyLabel,
    result,
    selected,
    items,
    profileMeta,
    profileStats,
    profileWanted,
    doneIds,
    checkedIds,
    qualityMode,
    progress,
    isPlaylistPlatform,
    destination,
    inputRef,
    analyze,
    clearAll,
    clearHistory,
    toggleChecked,
    selectAllChecked,
    clearChecked,
    downloadOption,
    downloadPhotos,
    downloadAll,
    setQualityMode,
    setProfileWanted,
    setSelected,
  } = engine;

  /**
   * Arranque con una URL venida de fuera: la portada manda
   * `/download/<plataforma>?url=<enlace>` y aquí se rellena el campo y se
   * analiza solo.
   *
   * El parámetro se lee de `window.location` y no de `useSearchParams` a
   * propósito: la página es estática (`generateStaticParams`) y ese hook
   * exigiría un `<Suspense>` que dejaría el descargador fuera del HTML
   * prerenderizado. Consumido, se borra de la barra para que un refresco no
   * vuelva a analizar la misma URL.
   */
  const pickedIncomingUrl = useRef(false);
  useEffect(() => {
    if (pickedIncomingUrl.current) return;
    pickedIncomingUrl.current = true;

    const incoming = new URLSearchParams(window.location.search).get("url")?.trim();
    if (!incoming) return;

    setUrl(incoming);
    window.history.replaceState(null, "", window.location.pathname);
    void analyze(incoming);
  }, [analyze, setUrl]);

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
              <ListUl size={13} />{" "}
              {isPlaylistPlatform ? "Lista completa en lote" : "Perfil completo en lote"}
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
                  {isPlaylistPlatform ? "" : <> (<code>@usuario</code>)</>}.
                </>
              ) : (
                <>
                  Acepta la URL de un <b>vídeo</b> o de una{" "}
                  <b>publicación</b> de {platform.name}.
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
            historyCount={engine.historyCount}
            historyAvailable={engine.historyAvailable}
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
