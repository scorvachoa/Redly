import Link from "next/link";

import PlatformIcon from "@/components/PlatformIcon";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { PLATFORMS } from "@/lib/platforms";

export default function NotFound() {
  return (
    <div className="shell">
      <SiteHeader />

      <main className="main">
        <div className="card soon">
          <div className="soon__badge">404</div>
          <h1 className="soon__title">Esa plataforma no existe</h1>
          <p className="soon__text">
            La ruta no coincide con ninguna plataforma de Red.ly. Estas son las
            disponibles hoy:
          </p>

          <div className="platform-grid platform-grid--compact">
            {PLATFORMS.map((platform) => (
              <Link
                key={platform.slug}
                href={`/download/${platform.slug}`}
                className={`platform-card${platform.ready ? " platform-card--ready" : ""}`}
                style={{ "--tile": platform.accent } as React.CSSProperties}
              >
                <span className="platform-card__mono" aria-hidden="true">
                  <PlatformIcon slug={platform.slug} size={18} />
                </span>
                <span className="platform-card__body">
                  <span className="platform-card__name">{platform.name}</span>
                </span>
                {platform.ready ? (
                  <span className="pill pill--ready">Disponible</span>
                ) : (
                  <span className="pill">Próximamente</span>
                )}
              </Link>
            ))}
          </div>

          <div className="soon__actions">
            <Link href="/" className="btn btn--primary">
              Volver a la portada
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
