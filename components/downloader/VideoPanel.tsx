"use client";

/**
 * Panel de resultado para un vídeo suelto.
 *
 * Presentacional: recibe el resultado y dos callbacks. No tiene estado propio
 * salvo el foco de teclado de las tarjetas de opción, que es puramente visual.
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
  onDownload: () => void;
}

export default function VideoPanel({
  result,
  selected,
  busy,
  destination,
  onSelect,
  onDownload,
}: VideoPanelProps) {
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
              Opciones <b>{result.downloads.length}</b>
            </span>
          </div>
        </div>
      </div>

      <div className="section-title">Opciones de descarga</div>
      <div className="options">
        {result.downloads.map((option, index) => (
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

      <div className="card download-bar">
        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={onDownload}
            disabled={busy}
          >
            <Download size={15} aria-hidden="true" /> Descargar
            {result.downloads[selected] ? ` · ${optionLabel(result.downloads[selected])}` : ""}
          </button>

          <DestinationRow destination={destination} busy={busy} />
        </div>
      </div>
    </>
  );
}
