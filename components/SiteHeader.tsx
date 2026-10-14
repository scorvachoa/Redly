import Link from "next/link";

import PlatformIcon from "./PlatformIcon";
import ThemeToggle from "./ThemeToggle";
import { PLATFORMS } from "@/lib/platforms";

/**
 * Cabecera compartida por todas las rutas. El nombre de la marca siempre
 * vuelve a `/`.
 *
 * El contenido va dentro de `.header__inner`, que replica el ancho y el padding
 * de `.main`, de forma que la marca y el botón de tema caen siempre sobre el
 * mismo eje vertical que el texto de la página.
 *
 * Los desplegables se abren con `:hover` y con `:focus-within`, así que no hacen
 * falta client components ni JavaScript. Los disparadores son `<button>`, no
 * `<Link>`: al pulsar sólo se despliega el menú, que antes saltaba a la sección
 * de plataformas. El foco que queda en el botón sostiene `:focus-within` en
 * escritorio y en Android; en iOS los botones no reciben foco al tocar, pero el
 * navegador simula el `:hover` sobre el toque y ese ya basta. Cada plataforma
 * tiene su enlace propio dentro del menú, así que no se pierde ninguna ruta.
 */
export default function SiteHeader() {
  return (
    <header className="header">
      <div className="header__inner">
        <Link href="/" className="brand__name">
          Red<span>.ly</span>
        </Link>

        <nav className="nav" aria-label="Principal">
          <div className="nav__item">
            <button type="button" className="nav__trigger" aria-haspopup="true">
              Descargar <span className="nav__caret" aria-hidden="true" />
            </button>
            <div className="nav__menu">
              <div className="nav__group">Redes sociales</div>
              {PLATFORMS.map((platform) => (
                <Link
                  key={`nav-download-${platform.slug}`}
                  href={`/download/${platform.slug}`}
                  className={`nav__link${platform.ready ? "" : " nav__link--muted"}`}
                >
                  <span
                    className="nav__link-icon"
                    style={{ "--tile": platform.accent } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <PlatformIcon slug={platform.slug} size={13} />
                  </span>
                  <span className="nav__link-name">{platform.name}</span>
                  {platform.ready ? (
                    <span className="nav__link-ready">Disponible</span>
                  ) : (
                    <span className="nav__link-soon">Próximamente</span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          <div className="nav__item">
            <button type="button" className="nav__trigger" aria-haspopup="true">
              Transcribir <span className="nav__caret" aria-hidden="true" />
            </button>
            <div className="nav__menu">
              <div className="nav__group">Redes sociales</div>
              {PLATFORMS.map((platform) => (
                <Link
                  key={`nav-transcript-${platform.slug}`}
                  href={`/transcript/${platform.slug}`}
                  className={`nav__link${platform.transcriptReady ? "" : " nav__link--muted"}`}
                >
                  <span
                    className="nav__link-icon"
                    style={{ "--tile": platform.accent } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <PlatformIcon slug={platform.slug} size={13} />
                  </span>
                  <span className="nav__link-name">{platform.name}</span>
                  {platform.transcriptReady ? (
                    <span className="nav__link-ready">Disponible</span>
                  ) : (
                    <span className="nav__link-soon">Próximamente</span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          <Link href="/#obtener-programa" className="nav__trigger">
            Obtener programa
          </Link>
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}
