"use client";

/**
 * Panel de resultado para un vídeo suelto.
 *
 * Presentacional: recibe el resultado y cuatro callbacks. No tiene estado propio
 * salvo el foco de teclado de las tarjetas de opción y la pestaña
 * Vídeo/Audio, que son puramente de presentación.
 *
 * Una publicación de fotos de TikTok (carrusel) devuelve una opción por imagen,
 * con miniatura propia. Se pintan como galería con descarga individual y
 * «Descargar todas»; las calidades de vídeo/audio siguen en su lista de siempre.
 *
 * Cuando la lista es larga (YouTube trae ~17 vídeos y ~7 audios) las opciones
 * se parten en dos pestañas; con pocas opciones (TikTok: 2 MP4 + 1 MP3) se
 * lista todo en una sola columna, sin pestañas. Cada opción de vídeo puede
 * llevar una etiqueta de audio según el campo `hasAudio` del modelo.
 */

import { useState } from "react";

import { Download } from "@/components/icons";
import type { DownloadOption, TikTokResult } from "@/lib/models";
import { optionLabel } from "@/lib/models";

import DestinationRow from "./DestinationRow";
import type { Destination } from "./useDestination";

export interface VideoPanelProps {
  result: TikTokResult;
  selected: number;
  busy: boolean;
  destination: Destination;
  onSelect: (index: number) => void;
  onDownloadOption: (index: number) => void;
  onDownloadPhotos: () => void;
  onReset: () => void;
}

/** Etiqueta de estado de audio de una opción de vídeo, o `null` si no aplica. */
function audioBadge(option: DownloadOption): { text: string; className: string } | null {
  // Una URL relativa (`/api/merge?…`) es una opción que el servidor combinará
  // con una pista de audio antes de entregar el archivo.
  const mergeable = option.url.startsWith("/");
  if (option.hasAudio === false) {
    return mergeable
      ? { text: "Se combina con audio", className: "badge" }
      : { text: "Sin audio", className: "badge badge--muted" };
  }
  if (option.hasAudio === true) {
    return { text: "Con audio", className: "badge badge--ok" };
  }
  // La fuente no declara el dato: no se inventa ninguna etiqueta.
  return null;
}

export default function VideoPanel({
  result,
  selected,
  busy,
  destination,
  onSelect,
  onDownloadOption,
  onDownloadPhotos,
  onReset,
}: VideoPanelProps) {
  const [tab, setTab] = useState<"video" | "audio">("video");

  // Cada opción conserva su índice original: el selector de calidades no debe
  // renumerarse cuando delante hay fotos o cuando cambia la pestaña.
  const photos = result.downloads
    .map((option, index) => ({ option, index }))
    .filter((entry) => entry.option.kind === "image");
  const mediaEntries = result.downloads
    .map((option, index) => ({ option, index }))
    .filter((entry) => entry.option.kind !== "image");
  const videoEntries = mediaEntries.filter((entry) => entry.option.kind !== "audio");
  const audioEntries = mediaEntries.filter((entry) => entry.option.kind === "audio");

  // Con listas largas (YouTube) una sola columna se hace interminable; con
  // pocas opciones (TikTok) las pestañas sólo añaden un clic más.
  const useTabs = videoEntries.length >= 8 || audioEntries.length >= 5;
  const visibleEntries = useTabs
    ? tab === "audio"
      ? audioEntries
      : videoEntries
    : mediaEntries;

  const selectedOption = result.downloads[selected];

  /** Cambia de pestaña y, si la opción marcada no está en ella, marca la primera. */
  const switchTab = (next: "video" | "audio") => {
    setTab(next);
    const list = next === "audio" ? audioEntries : videoEntries;
    if (!list.some((entry) => entry.index === selected)) {
      const first = list[0];
      if (first) onSelect(first.index);
    }
  };

  return (
    <>
      <div className="card result">
        <div className="result__thumb">
          {result.thumbnail ? <img src={result.thumbnail} alt="" /> : "Sin vista\nprevia"}
        </div>
        <div className="result__body">
          <h1 className="result__title">{result.title ?? "(sin título)"}</h1>
          <div className="result__meta">
            <span>
              ID <b>{result.videoId ?? "—"}</b>
            </span>
            <span>
              {photos.length > 0 ? "Fotos" : "Opciones"}{" "}
              <b>{photos.length > 0 ? photos.length : result.downloads.length}</b>
            </span>
          </div>
        </div>
      </div>

      {photos.length > 0 && (
        <>
          <div className="section-title">
            {photos.length} foto{photos.length === 1 ? "" : "s"}
          </div>

          <div className="photos">
            {photos.map(({ option, index }, position) => (
              <div className="card photo" key={`${option.url}-${index}`}>
                <span className="photo__thumb">
                  {option.thumbnail ? <img src={option.thumbnail} alt="" /> : "Foto"}
                </span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm photo__btn"
                  onClick={() => onDownloadOption(index)}
                  disabled={busy}
                  aria-label={`Descargar foto ${position + 1}`}
                >
                  <Download size={13} aria-hidden="true" /> {position + 1}
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--primary photos__all"
            onClick={onDownloadPhotos}
            disabled={busy}
          >
            <Download size={15} aria-hidden="true" /> Descargar todas
          </button>
        </>
      )}

      {mediaEntries.length > 0 && (
        <>
          <div className="section-title">Opciones de descarga</div>

          {useTabs && (
            <div className="option-tabs" role="tablist" aria-label="Tipo de opción">
              <button
                type="button"
                role="tab"
                className="option-tab"
                aria-selected={tab === "video"}
                onClick={() => switchTab("video")}
              >
                Vídeo
                <span className="option-tab__count">{videoEntries.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                className="option-tab"
                aria-selected={tab === "audio"}
                onClick={() => switchTab("audio")}
              >
                Audio
                <span className="option-tab__count">{audioEntries.length}</span>
              </button>
            </div>
          )}

          <div className="options">
            {visibleEntries.map(({ option, index }) => {
              const badge = option.kind === "audio" ? null : audioBadge(option);
              return (
                <div
                  key={`${option.url}-${index}`}
                  className={`card option${selected === index ? " option--selected" : ""}`}
                  onClick={() => onSelect(index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSelect(index);
                  }}
                >
                  <span className="option__radio" aria-hidden="true" />
                  <span className="option__name">{option.name}</span>
                  {badge && <span className={badge.className}>{badge.text}</span>}
                  <span className="option__badge">{optionLabel(option)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="card download-bar">
        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onDownloadOption(selected)}
            disabled={busy || !selectedOption || selectedOption.kind === "image"}
          >
            <Download size={15} aria-hidden="true" /> Descargar
            {selectedOption && selectedOption.kind !== "image"
              ? ` · ${optionLabel(selectedOption)}`
              : ""}
          </button>

          <button type="button" className="btn btn--ghost" onClick={onReset} disabled={busy}>
            Limpiar
          </button>

          <DestinationRow destination={destination} busy={busy} />
        </div>
      </div>
    </>
  );
}
