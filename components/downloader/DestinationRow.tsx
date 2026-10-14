"use client";

/**
 * Fila de «Destino» de la barra de descarga.
 *
 * Presentacional: recibe el hook `useDestination` ya resuelto y pinta la línea
 * con la carpeta actual y el botón de elegirla (o el aviso cuando el navegador
 * no soporta `showDirectoryPicker`).
 *
 * Va como último hijo de `.actions`: los botones quedan a la izquierda y esta
 * etiqueta, con `ml-auto`, al extremo derecho de la misma línea. El destino
 * vive aquí y no en la tarjeta de la URL porque sólo importa al guardar, que
 * es cuando aparecen esos botones.
 */

import { FolderTree } from "@/components/icons";

import type { Destination } from "./useDestination";

export interface DestinationRowProps {
  destination: Destination;
  busy: boolean;
}

export default function DestinationRow({ destination, busy }: DestinationRowProps) {
  return (
    <div className="destination__row">
      <span className="destination__label">
        <FolderTree size={14} aria-hidden="true" /> Destino: <b>{destination.label}</b>
      </span>

      {destination.canPickDir ? (
        <span className="destination__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void destination.chooseDirectory()}
            disabled={busy}
          >
            Elegir carpeta
          </button>
          {destination.dirHandle && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={destination.clearDirectory}
              disabled={busy}
            >
              Usar Descargas
            </button>
          )}
        </span>
      ) : (
        <span className="destination__hint">Tu navegador guardará en {destination.label}.</span>
      )}
    </div>
  );
}
