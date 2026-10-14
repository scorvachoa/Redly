"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "redly-theme";

type Theme = "light" | "dark";

/**
 * Botón de tema claro/oscuro.
 *
 * El valor inicial lo aplica el *bootstrap* inline de `app/layout.tsx` antes del
 * primer pintado, así que este componente **no escribe en montar**: sólo lee el
 * `data-theme` ya presente y sólo escribe cuando el usuario pulsa. (Escribir en
 * el montaje, como hacía antes, provocaba un destello a claro y dejaba
 * `localStorage` inconsistente entre la portada y el resto de rutas.)
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  // Refleja lo que ya está aplicado; no toca el DOM ni el almacenamiento.
  useEffect(() => {
    const applied = document.documentElement.getAttribute("data-theme");
    setTheme(applied === "dark" ? "dark" : "light");

    // Si el tema cambia en otra pestaña, el botón se sincroniza.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === "dark" || event.newValue === "light") {
        setTheme(event.newValue);
        document.documentElement.setAttribute("data-theme", event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Almacenamiento bloqueado (modo privado): el tema sigue funcionando
      // durante la sesión, simplemente no se recuerda.
    }
    setTheme(next);
  }, [theme]);

  return (
    <button
      type="button"
      className="btn btn--theme"
      onClick={toggle}
      aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      aria-pressed={theme === "dark"}
      title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/* Iconos SVG propios: sin dependencias y se adaptan al color actual. */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.4 8.4 0 1 0 20 14.5Z" />
    </svg>
  );
}
