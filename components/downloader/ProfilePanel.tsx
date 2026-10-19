"use client";

/**
 * Panel de resultado para un perfil listado.
 *
 * Presentacional: recibe la lista, las estadísticas y los callbacks. Las casillas
 * y el recuento de pendientes se calculan fuera, de modo que este componente no
 * tiene más lógica que la de pintar.
 */

import { Download } from "@/components/icons";
import type { BatchQuality } from "@/lib/models";
import type { ProfileVideo } from "@/lib/models";
import type { ProfileMeta } from "@/lib/savetik";

import DestinationRow from "./DestinationRow";
import type { Destination } from "./useDestination";

export interface ProfileStats {
  pending: number;
  done: number;
  pages: number;
}

/** Una entrada del selector de calidad del lote. */
export interface QualityOption {
  value: BatchQuality;
  label: string;
}

export interface ProfilePanelProps {
  items: ProfileVideo[];
  /** Título/canal/total del listado, si la fuente los aporta (YouTube). */
  meta?: ProfileMeta | null;
  stats: ProfileStats;
  wanted: number;
  doneIds: ReadonlySet<string>;
  checkedIds: ReadonlySet<string>;
  busy: boolean;
  historyCount: number;
  historyAvailable: boolean;
  destination: Destination;
  /** Calidad con la que se baja el lote. */
  qualityMode: BatchQuality;
  /** Opciones del selector; si hay menos de dos no se pinta el selector. */
  qualityOptions: readonly QualityOption[];
  onQualityChange: (mode: BatchQuality) => void;
  onWantedChange: (value: number) => void;
  onToggleChecked: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onReanalyze: () => void;
  onClearHistory: () => void;
  onDownloadAll: () => void;
  onReset: () => void;
}

export default function ProfilePanel({
  items,
  meta,
  stats,
  wanted,
  doneIds,
  checkedIds,
  busy,
  historyCount,
  historyAvailable,
  destination,
  qualityMode,
  qualityOptions,
  onQualityChange,
  onWantedChange,
  onToggleChecked,
  onSelectAll,
  onSelectNone,
  onReanalyze,
  onClearHistory,
  onDownloadAll,
  onReset,
}: ProfilePanelProps) {
  // Las casillas de los vídeos ya bajados están deshabilitadas, así que no
  // cuentan: «Seleccionar todo» sólo puede alcanzar los que aún se pueden marcar.
  const selectableCount = items.reduce(
    (total, item) => (doneIds.has(item.id) ? total : total + 1),
    0,
  );
  const allSelected = selectableCount > 0 && checkedIds.size >= selectableCount;
  // Con meta se titula con el nombre real del listado; sin ella (TikTok) se
  // conserva el texto genérico de siempre.
  const title = meta?.title ?? `Listado con ${items.length} vídeo(s)`;
  const total = meta?.total ?? items.length;

  return (
    <>
      <div className="card result">
        <div className="result__thumb">
          {items[0]?.thumbnail ? <img src={items[0].thumbnail} alt="" /> : "Listado"}
        </div>
        <div className="result__body">
          <h1 className="result__title">{title}</h1>
          <div className="result__meta">
            <span>
              {meta?.channel ? `${meta.channel} · ` : ""}
              {total} vídeo(s)
            </span>
            <span>Se descargan uno a uno, con pausa entre vídeos.</span>
            <span>Lo ya bajado queda marcado y no se vuelve a descargar.</span>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat__value">{items.length}</div>
          <div className="stat__label">Listados</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.pending}</div>
          <div className="stat__label">Pendientes</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.done}</div>
          <div className="stat__label">Ya bajados</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.pages}</div>
          <div className="stat__label">Páginas</div>
        </div>
      </div>

      <div className="card history-bar">
        <div className="history-bar__head">
          <label className="label" htmlFor="wanted">
            Vídeos nuevos a buscar
          </label>

          <span className="history-bar__meta">
            <span className="history-bar__count">
              <b>{historyCount}</b> en el historial
            </span>
            {historyCount > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onClearHistory}
                disabled={busy}
              >
                Borrar historial
              </button>
            )}
          </span>
        </div>

        <div className="history-bar__row">
          <input
            id="wanted"
            className="input input--narrow"
            type="number"
            min={1}
            max={1000}
            value={wanted}
            onChange={(event) => onWantedChange(Number(event.target.value))}
            disabled={busy}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onReanalyze}
            disabled={busy}
          >
            Volver a analizar
          </button>
        </div>

        {!historyAvailable && (
          <div className="note">
            Tu navegador no deja guardar historial (modo privado): cada análisis empezará de
            cero.
          </div>
        )}
      </div>

      <div className="list-head">
        <div className="section-title">Vídeos del listado</div>

        <div className="list-head__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onSelectAll}
            disabled={busy || allSelected}
          >
            Seleccionar todo
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onSelectNone}
            disabled={busy || checkedIds.size === 0}
          >
            Deseleccionar todo
          </button>
        </div>
      </div>

      <div className="videos">
        {items.map((item, index) => {
          const isDone = doneIds.has(item.id);
          return (
            /* Es un `<label>`, no un `<div>`: en móvil tocar cualquier punto de la
               fila marca o desmarca, en vez de darle a una casilla de 16px. */
            <label
              className={`card video-row${isDone ? " video-row--done" : ""}`}
              key={`${item.id}-${index}`}
            >
              <input
                type="checkbox"
                className="video-row__check"
                checked={checkedIds.has(item.id)}
                onChange={() => onToggleChecked(item.id)}
                disabled={isDone || busy}
                aria-label={item.title ?? item.id}
              />
              <span className="video-row__idx">{index + 1}</span>
              <span className="video-row__body">
                <span className="video-row__title">{item.title ?? "(sin título)"}</span>
                <span className="video-row__meta">
                  {item.channel ?? "—"}
                  {item.views ? ` · ${item.views} vistas` : ""}
                </span>
              </span>
              {isDone && <span className="badge badge--done">Ya descargado</span>}
              <span className="badge">{(item.format ?? "mp4").toUpperCase()}</span>
            </label>
          );
        })}
      </div>

      <div className="card download-bar">
        <div className="actions">
          {qualityOptions.length > 1 && (
            <label className="quality" htmlFor="batch-quality">
              <span className="quality__label">Calidad</span>
              <select
                id="batch-quality"
                className="select"
                value={qualityMode}
                onChange={(event) => onQualityChange(event.target.value as BatchQuality)}
                disabled={busy}
              >
                {qualityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn btn--primary"
            onClick={onDownloadAll}
            disabled={busy || checkedIds.size === 0}
          >
            <Download size={15} aria-hidden="true" /> Descargar {checkedIds.size}{" "}
            {qualityMode === "audio" ? "audio(s)" : "vídeo(s)"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onReset} disabled={busy}>
            Limpiar
          </button>

          <DestinationRow destination={destination} busy={busy} />
        </div>
      </div>

      <div className="note">
        El lote se ejecuta en el navegador, uno a uno, con una pausa entre vídeos. Los ya
        descargados aparecen marcados y no se vuelven a bajar.
      </div>
    </>
  );
}
