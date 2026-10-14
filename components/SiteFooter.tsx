import Link from "next/link";

import { PLATFORMS } from "@/lib/platforms";
import { REPO_URL } from "@/lib/site";

/**
 * Pie compartido por la portada, el descargador, «Próximamente», el 404,
 * `/privacidad` y `/creditos`. Su bloque interior replica el ancho de `.main`.
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <div className="brand__name">
            Red<span>.ly</span>
          </div>
          <p className="site-footer__tag">
            Descarga y transcripción de vídeos públicos. Funciona en el navegador y
            en la terminal, sin registro ni cuentas.
          </p>
        </div>

        <div className="site-footer__cols">
          <div className="site-footer__col">
            <div className="site-footer__title">Descargar</div>
            {PLATFORMS.map((platform) => (
              <Link
                key={`footer-download-${platform.slug}`}
                href={`/download/${platform.slug}`}
                className="site-footer__link"
              >
                {platform.name}
              </Link>
            ))}
          </div>

          <div className="site-footer__col">
            <div className="site-footer__title">Transcribir</div>
            {PLATFORMS.map((platform) => (
              <Link
                key={`footer-transcript-${platform.slug}`}
                href={`/transcript/${platform.slug}`}
                className="site-footer__link"
              >
                {platform.name}
              </Link>
            ))}
          </div>

          <div className="site-footer__col">
            <div className="site-footer__title">Proyecto</div>
            <Link href="/#obtener-programa" className="site-footer__link">
              Obtener programa
            </Link>
            <Link href="/privacidad" className="site-footer__link">
              Privacidad
            </Link>
            <Link href="/creditos" className="site-footer__link">
              Créditos
            </Link>
            {REPO_URL ? (
              <a
                href={REPO_URL}
                className="site-footer__link"
                target="_blank"
                rel="noreferrer"
              >
                Repositorio
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="site-footer__legal">
        Red.ly es una prueba de estudio. Sólo se admite contenido público: no se
        eluden CAPTCHA ni controles de acceso, y no se descarga material con derechos
        de terceros.
      </div>
    </footer>
  );
}
