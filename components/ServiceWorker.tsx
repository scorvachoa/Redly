"use client";

/**
 * Registra el service worker (`/sw.js`).
 *
 * Es un client component sin marcado: sólo hace falta en el navegador y sólo
 * en producción. En desarrollo se omite a propósito, porque los rebuilds en
 * caliente de `next dev` dejan el worker con un bundle obsoleto y hay que
 * recargar con la dev tools abierta para ver los cambios.
 */

import { useEffect } from "react";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    // Se registra ya en idle: no compite con el primer pintado.
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Un fallo al registrar no debe romper la app: la web funciona igual
        // sin service worker, sólo pierde la instalación y el caché de assets.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
