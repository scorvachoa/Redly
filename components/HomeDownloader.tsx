"use client";

/**
 * Buscador general de la portada: analiza en la misma página.
 *
 * Un solo campo para todas las redes. Al enviar, el análisis ocurre aquí
 * mismo —sin navegar— y el resultado (vídeo suelto o perfil en lote) se pinta
 * debajo del buscador.
 *
 * Debajo del campo se muestran los iconos de las redes soportadas; mientras
 * se escribe, la que coincida con la entrada (clasificada con
 * `lib/urlrules.ts`, las mismas reglas que usan la API) se resalta.
 */

import { type FormEvent } from "react";

import PlatformIcon from "@/components/PlatformIcon";
import ProgressBar from "@/components/downloader/ProgressBar";
import ProfilePanel from "@/components/downloader/ProfilePanel";
import VideoPanel from "@/components/downloader/VideoPanel";
import { useDownloaderEngine } from "@/components/downloader/useDownloaderEngine";
import { CircleCheck, CircleInfo, TriangleExclamation } from "@/components/icons";
import { PLATFORMS, getPlatform } from "@/lib/platforms";
import { classifyInput } from "@/lib/urlrules";

/**
 * Slug de la red que hay que resaltar en la fila de iconos, o `null`.
 *
 * Sólo se resaltan entradas utilizables (un vídeo concreto, o un perfil en
 * plataformas con listado): la fila es una ayuda visual, no un mensaje de
 * error —el motivo de un fallo lo cuenta la línea de estado al analizar.
 */
function highlightedSlugFor(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const classified = classifyInput(raw);
  if (!classified) return null;
  const platform = getPlatform(classified.slug);
  const usable =
    classified.kind !== "unsupported" &&
    !(classified.kind === "profile" && platform?.profilesReady !== true);
  return usable ? classified.slug : null;
}

export default function HomeDownloader() {
  const engine = useDownloaderEngine({ platform: null });
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

  const highlightedSlug = highlightedSlugFor(url);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void analyze();
  }

  return (
    <div className="home-tool">
      <form className="hero__search" onSubmit={submit} noValidate>
        <label className="label" htmlFor="home-search-url">
          Pega cualquier enlace
        </label>

        <div className="url-row">
          <input
            id="home-search-url"
            ref={inputRef}
            className="input"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="URL de un vídeo o de un perfil · o @usuario de TikTok"
            value={url}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busyLabel ?? "Analizar"}
          </button>
        </div>
      </form>

      <div className="hero__networks">
        <span className="hero__networks-label">Funciona con</span>
        <ul className="hero__networks-row">
          {PLATFORMS.map((platform) => (
            <li
              key={platform.slug}
              className={`hero__network${highlightedSlug === platform.slug ? " hero__network--active" : ""}`}
              style={{ "--tile": platform.accent } as React.CSSProperties}
              title={platform.name}
            >
              <PlatformIcon slug={platform.slug} size={17} />
              <span className="hero__network-name">{platform.name}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={`status status--${status.kind}`} role="status" aria-live="polite">
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
    </div>
  );
}
