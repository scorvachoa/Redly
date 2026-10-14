import { NextResponse } from "next/server";

import { RedlyError } from "@/lib/exceptions";

/**
 * Respuesta de error uniforme para las rutas de la API.
 *
 * El nombre lleva `_` inicial porque es una carpeta/archivo privado para el
 * router de Next: así no choca con el `error.tsx` de boundary y los archivos
 * de ruta no exportan nada que Next no espere.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof RedlyError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }
  return NextResponse.json(
    { ok: false, error: "Error inesperado del servidor." },
    { status: 500 },
  );
}
