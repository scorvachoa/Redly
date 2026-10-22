import Link from "next/link";

import { TELEGRAM_BOT_USERNAME } from "@/lib/config";

/**
 * Pie compartido por todas las rutas: la marca, el aviso legal y —si el bot
 * tiene username configurado— el enlace a Telegram.
 */
export default function SiteFooter() {
  const botUsername = TELEGRAM_BOT_USERNAME.replace(/^@/, "");
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
        {botUsername ? (
          <p className="site-footer__text">
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noreferrer"
              className="site-footer__link"
            >
              Bot de Telegram
            </a>
          </p>
        ) : null}
      </div>
    </footer>
  );
}
