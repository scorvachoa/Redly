"use client";

/**
 * Botón de instalación como aplicación (PWA).
 *
 * Tres caminos distintos, porque cada navegador se comporta a su manera:
 *
 * - **Android / escritorio (Chromium)**: dispara `beforeinstallprompt`. El
 *   navegador decide si el usuario puede instalar en función del manifiesto,
 *   el service worker y el uso; si decide que sí, emite el evento y aquí se
 *   muestra el botón.
 * - **iOS (Safari)**: no implementa `beforeinstallprompt`. Se muestran las
 *   instrucciones de «Compartir → Añadir a pantalla de inicio».
 * - **Ya instalada**: se detecta por `display-mode: standalone` (y por
 *   `navigator.standalone`, que sólo existe en iOS) y se muestra un estado de
 *   confirmación.
 *
 * Todo se resuelve en el cliente; el servidor no pinta nada de esto para no
 * hidratar contra la hidratación del navegador.
 */

import { useCallback, useEffect, useState } from "react";

import { CircleCheck, Download } from "@/components/icons";

/** Evento `beforeinstallprompt`, que no está tipado en TS DOM lib. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari expone el modo app como `navigator.standalone`.
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

function isAppleDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ se identifica como Mac, pero tiene puntos táctiles.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export default function InstallApp() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [apple, setApple] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setApple(isAppleDevice());

    const onBeforeInstall = (event: Event) => {
      // Sin preventDefault el navegador mostraría su propia barra y aquí no
      // habría forma de saber si el usuario aceptó o no.
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setDismissed(false);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    else setDismissed(true);
    // El evento sólo se puede usar una vez: se limpia pase lo que pase.
    setPromptEvent(null);
  }, [promptEvent]);

  if (installed) {
    return (
      <div className="install">
        <div className="install__row">
          <span className="install__icon install__icon--ok" aria-hidden="true">
            <CircleCheck size={15} focusable="false" />
          </span>
          <p className="install__text">
            Red.ly ya está instalada. Se abre en su propia ventana, sin barra de navegador.
          </p>
        </div>
      </div>
    );
  }

  if (promptEvent) {
    return (
      <div className="install">
        <div className="install__row">
          <span className="install__icon" aria-hidden="true">
            <Download size={15} focusable="false" />
          </span>
          <p className="install__text">
            {dismissed
              ? "Vale, no la instalamos ahora. Si cambias de idea, recarga la página."
              : "Tu navegador puede añadirla a la pantalla de inicio."}
          </p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void install()}>
            Instalar
          </button>
        </div>
      </div>
    );
  }

  if (apple) {
    return (
      <div className="install">
        <div className="install__row">
          <span className="install__icon" aria-hidden="true">
            <Download size={15} focusable="false" />
          </span>
          <p className="install__text">Para añadirla a tu pantalla de inicio:</p>
        </div>
        <ol className="install__steps">
          <li>
            <b>1.</b> Toca el botón <b>Compartir</b> de Safari (el cuadrado con la flecha).
          </li>
          <li>
            <b>2.</b> Elige <b>Añadir a pantalla de inicio</b>.
          </li>
          <li>
            <b>3.</b> Confirma con <b>Añadir</b>. Aparecerá con el icono de Red.ly.
          </li>
        </ol>
      </div>
    );
  }

  return (
    <div className="install">
      <div className="install__row">
        <span className="install__icon" aria-hidden="true">
          <Download size={15} focusable="false" />
        </span>
        <p className="install__text">
          Abre el menú del navegador y elige <b>Instalar aplicación</b> o{" "}
          <b>Añadir a pantalla de inicio</b>. Si no aparece, tu navegador todavía no la
          ofrece: sigue funcionando igual desde la pestaña.
        </p>
      </div>
    </div>
  );
}
