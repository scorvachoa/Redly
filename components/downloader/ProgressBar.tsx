"use client";

/** Barra de progreso lineal, con variante indeterminada. */

export interface ProgressState {
  done: number;
  total: number | null;
  label: string;
  indeterminate: boolean;
}

export const IDLE_PROGRESS: ProgressState = {
  done: 0,
  total: null,
  label: "",
  indeterminate: false,
};

export default function ProgressBar({
  progress,
  visible,
}: {
  progress: ProgressState;
  visible: boolean;
}) {
  if (!visible) return null;

  const percent =
    progress.indeterminate || !progress.total
      ? 0
      : Math.min((progress.done / progress.total) * 100, 100);

  return (
    <div className="progress">
      <div className="progress__bar">
        <div
          className={`progress__fill${progress.indeterminate ? " progress__fill--indeterminate" : ""}`}
          style={progress.indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className="progress__text">{progress.label}</div>
    </div>
  );
}
