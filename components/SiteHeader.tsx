import Link from "next/link";

import { Github } from "./icons";
import ThemeToggle from "./ThemeToggle";
import { REPO_URL } from "@/lib/site";

/**
 * Cabecera compartida por todas las rutas: marca a la izquierda; a la
 * derecha, los enlaces legales, el repositorio (sólo icono de GitHub) y el
 * botón de tema. El nombre siempre vuelve a `/`.
 *
 * El contenido va dentro de `.header__inner`, que replica el ancho y el padding
 * de `.main`, de forma que la marca y el grupo de la derecha caen siempre sobre
 * el mismo eje vertical que el texto de la página.
 */
export default function SiteHeader() {
  return (
    <header className="header">
      <div className="header__inner">
        <Link href="/" className="brand__name">
          Red<span>.ly</span>
        </Link>

        <div className="header__side">
          <nav className="nav" aria-label="Principal">
            <Link href="/privacidad" className="nav__trigger">
              Privacidad
            </Link>
            <Link href="/creditos" className="nav__trigger">
              Créditos
            </Link>
            {REPO_URL ? (
              <a
                href={REPO_URL}
                className="nav__trigger nav__trigger--icon"
                target="_blank"
                rel="noreferrer"
                aria-label="Repositorio en GitHub"
              >
                <Github size={16} focusable="false" />
              </a>
            ) : null}
          </nav>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
