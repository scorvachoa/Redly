import Link from "next/link";

import PlatformIcon from "@/components/PlatformIcon";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import type { Platform, PlatformKind } from "@/lib/platforms";

/**
 * Estado «Próximamente» de una plataforma.
 *
 * No se muestra ningún formulario de descarga ni transcripción porque **no hay
 * un origen comprobado** para esa plataforma: `base.md` §2 prohíbe inventar
 * endpoints, y sólo TikTok está verificado empíricamente. Decir «próximamente»
 * es preferible a mostrar un botón que no puede funcionar.
 */
export default function ComingSoon({
  platform,
  kind,
}: {
  platform: Platform;
  kind: PlatformKind;
}) {
  const isTranscript = kind === "transcript";
  const title = isTranscript
    ? `Transcribir de ${platform.name}`
    : `Descargar de ${platform.name}`;

  return (
    <div className="shell">
      <SiteHeader />

      <main className="main">
        <div className="platform-head">
          <span
            className="platform-head__mono"
            style={{ "--tile": platform.accent } as React.CSSProperties}
          >
            <PlatformIcon slug={platform.slug} size={22} />
          </span>
          <div>
            <h1 className="platform-head__title">{title}</h1>
            <div className="platform-head__hosts">{platform.hosts.join(" · ")}</div>
          </div>
        </div>

        <div className="card soon">
          <div className="soon__badge">Próximamente</div>

          {isTranscript ? (
            <>
              <h2 className="soon__title">Todavía no hay transcripciones</h2>
              <p className="soon__text">
                Red.ly no tiene ninguna fuente comprobada de subtítulos ni
                transcripciones, ni para {platform.name} ni para el resto de
                plataformas. La página original se sirve tras controles de acceso
                y no se intenta eludir, así que no prometemos algo que no podemos
                hacer de forma fiable.
              </p>
              <p className="soon__text">
                Cuando haya un origen verificado, esta ruta empezará a devolver el
                texto del vídeo. De momento no hay nada que probar aquí.
              </p>
            </>
          ) : (
            <>
              <h2 className="soon__title">La descarga de {platform.name} aún no está</h2>
              <p className="soon__text">
                Red.ly funciona con orígenes verificados uno a uno. Hoy sólo está
                comprobado <b>TikTok</b>; para {platform.name} no existe ningún
                servicio configurado, y no se muestra un botón que no podría
                funcionar.
              </p>
              <p className="soon__text">
                El descargador de TikTok sí está completo: un vídeo suelto, un
                perfil entero, reanudación y carpeta por perfil.
              </p>
            </>
          )}

          <div className="soon__actions">
            <Link href="/download/tiktok" className="btn btn--primary">
              Ir al descargador de TikTok
            </Link>
            <Link href="/" className="btn btn--ghost">
              Ver todas las plataformas
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
