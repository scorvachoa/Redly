"use client";

/**
 * Panel de resultado para un vídeo suelto.
 *
 * Presentacional: recibe el resultado y cuatro callbacks. No tiene estado propio
 * salvo el foco de teclado de las tarjetas de opción, que es puramente visual.
 *
 * Una publicación de fotos de TikTok (carrusel) devuelve una opción por imagen,
 * con miniatura propia. Se pintan como galería con descarga individual y
 * «Descargar todas»; las calidades de vídeo/audio siguen en su lista de siempre.
 */

import { Download } from "@/components/icons";
import type { TikTokResult } from "@/lib/models";
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
  // Cada opción conserva su índice original: el selector de calidades no debe
  // renumerarse cuando delante hay fotos.
  const photos = result.downloads
    .map((option, index) => ({ option, index }))
    .filter((entry) => entry.option.kind === "image");
  const mediaOptions = result.downloads
    .map((option, index) => ({ option, index }))
    .filter((entry) => entry.option.kind !== "image");

  const selectedOption = result.downloads[selected];

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
          <div className="list-head">
            <div className="section-title">
              {photos.length} foto{photos.length === 1 ? "" : "s"}
            </div>
            <div className="list-head__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onDownloadPhotos}
                disabled={busy}
              >
                <Download size={14} aria-hidden="true" /> Descargar todas
              </button>
            </div>
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
        </>
      )}

      {mediaOptions.length > 0 && (
        <>
          <div className="section-title">Opciones de descarga</div>
          <div className="options">
            {mediaOptions.map(({ option, index }) => (
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
                <span className="option__badge">{optionLabel(option)}</span>
              </div>
            ))}
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
