import Link from "next/link";

/**
 * Pie compartido por todas las rutas: sólo la marca y el aviso legal.
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <Link href="/" className="brand__name">
          Red<span>.ly</span>
        </Link>
        <p className="site-footer__text">
          Red.ly es una prueba de estudio. Sólo se admite contenido público: no
          se eluden CAPTCHA ni controles de acceso, y no se descarga material
          con derechos de terceros.
        </p>
      </div>
    </footer>
  );
}
