import type { Metadata } from "next";
import Link from "next/link";

import HomeSearch from "@/components/HomeSearch";
import InstallApp from "@/components/InstallApp";
import PlatformIcon from "@/components/PlatformIcon";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import {
  Bolt,
  Download,
  FolderOpen,
  LayerGroup,
  Link as LinkIcon,
  ListUl,
  Lock,
  RotateRight,
  ShieldHalved,
  Video,
} from "@/components/icons";
import { PLATFORMS, isReady, type PlatformKind } from "@/lib/platforms";
import { DESKTOP_DOWNLOAD_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Red.ly — Descarga y transcripción de vídeos públicos",
  description:
    "Cliente web en TypeScript para descargar y transcribir vídeos públicos de TikTok, YouTube, Facebook e Instagram.",
};

const FEATURES = [
  {
    icon: LayerGroup,
    title: "Un vídeo o un perfil entero",
    text: "Pega la URL de un vídeo o de un perfil y Red.ly pagina el listado hasta reunir todo lo pendiente.",
  },
  {
    icon: RotateRight,
    title: "Reanudación real",
    text: "El historial recuerda lo ya bajado: si se corta, vuelves a lanzar y continúa donde estaba.",
  },
  {
    icon: FolderOpen,
    title: "Carpeta por perfil",
    text: "Cada perfil se guarda en su propia subcarpeta. En el navegador puedes elegir el destino.",
  },
  {
    icon: ShieldHalved,
    title: "Sólo contenido público",
    text: "No se eluden CAPTCHA ni controles de acceso, y el navegador nunca habla directamente con la red social.",
  },
  {
    icon: Lock,
    title: "Sin registro ni cuentas",
    text: "No hay base de datos ni usuarios. Las URLs temporales caducan en ~1 hora y nunca se guardan.",
  },
] as const;

const STEPS = [
  { icon: LinkIcon, title: "Pega la URL", text: "De un vídeo o de un perfil público." },
  { icon: ListUl, title: "Analiza y elige", text: "Opciones de calidad o los vídeos del lote." },
  { icon: Bolt, title: "Se guarda", text: "En streaming, con progreso y carpeta propia." },
] as const;

function PlatformGrid({ kind }: { kind: PlatformKind }) {
  return (
    <div className="platform-grid">
      {PLATFORMS.map((platform) => {
        const ready = isReady(platform, kind);
        return (
          <Link
            key={`${kind}-${platform.slug}`}
            href={`/${kind}/${platform.slug}`}
            className={`platform-card${ready ? " platform-card--ready" : ""}`}
            style={{ "--tile": platform.accent } as React.CSSProperties}
          >
            <span className="platform-card__mono" aria-hidden="true">
              <PlatformIcon slug={platform.slug} size={19} />
            </span>
            <span className="platform-card__body">
              <span className="platform-card__name">{platform.name}</span>
              <span className="platform-card__blurb">
                {kind === "transcript" ? "Transcripción del vídeo" : platform.blurb}
              </span>
            </span>
            <span className={`pill${ready ? " pill--ready" : ""}`}>
              {ready ? "Disponible" : "Próximamente"}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default function WelcomePage() {
  const available = PLATFORMS.filter((platform) => platform.ready);

  return (
    <div className="shell">
      <SiteHeader />

      <main className="main">
        <section className="hero">
          <div className="hero__glow" aria-hidden="true" />
          <h1 className="hero__title">
            Descarga y transcribe
            <br />
            vídeos <span>públicos</span>
          </h1>
          <p className="hero__text">
            Red.ly analiza una URL, resuelve el archivo en el CDN y te lo guarda donde elijas.
            Funciona en el navegador, con historial local para no repetir descargas.
          </p>

          <HomeSearch />

          <div className="hero__actions">
            <div className="hero__actions-main">
              <a href="#obtener-programa" className="btn btn--ghost btn--sm">
                Obtener programa
              </a>
              <a href="#plataformas" className="btn btn--ghost btn--sm">
                Ver plataformas
              </a>
            </div>
          </div>
          <div className="hero__stats">
            <span>
              <b>{available.length}</b>{" "}
              {available.length === 1 ? "plataforma activa" : "plataformas activas"}
            </span>
            <span className="hero__stats-sep" />
            <span>
              <b>0</b> registros
            </span>
            <span className="hero__stats-sep" />
            <span>
              <b>PWA</b> instalable
            </span>
          </div>
        </section>

        <section className="landing-section" id="plataformas">
          <div className="section-head">
            <div>
              <div className="section-title">Descargar</div>
              <p className="landing-section__lead">
                Pega la URL de un vídeo o de un perfil completo. En TikTok puedes
                bajar un perfil entero con reanudación y carpeta por perfil; en
                YouTube, vídeos sueltos y Shorts.
              </p>
            </div>
            <span className="pill pill--ready">
              {available.length} de {PLATFORMS.length}
            </span>
          </div>
          <PlatformGrid kind="download" />
        </section>

        <section className="landing-section">
          <div className="section-head">
            <div>
              <div className="section-title">Transcribir</div>
              <p className="landing-section__lead">
                Obtener el texto del vídeo. Todavía no hay ninguna fuente
                comprobada de subtítulos, así que esta sección existe pero no
                hace nada.
              </p>
            </div>
            <span className="pill">Próximamente</span>
          </div>
          <PlatformGrid kind="transcript" />
        </section>

        <section className="landing-section">
          <div className="section-title">Por qué Red.ly</div>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <div className="feature" key={feature.title}>
                <span className="feature__icon">
                  <feature.icon size={17} aria-hidden="true" focusable="false" />
                </span>
                <div>
                  <div className="feature__title">{feature.title}</div>
                  <div className="feature__text">{feature.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="section-title">Cómo funciona</div>
          <div className="steps">
            {STEPS.map((step, index) => (
              <div className="step" key={step.title}>
                <span className="step__num">{index + 1}</span>
                <span className="step__icon">
                  <step.icon size={16} aria-hidden="true" focusable="false" />
                </span>
                <div>
                  <div className="step__title">{step.title}</div>
                  <div className="step__text">{step.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section" id="obtener-programa">
          <div className="section-head">
            <div>
              <div className="section-title">Obtener programa</div>
              <p className="landing-section__lead">
                La web funciona sin instalar nada. Si prefieres un programa
                propio para Windows, esto es lo que hay.
              </p>
            </div>
          </div>

          <div className="program-grid">

            <article className="program-card program-card--ready">
              <header className="program-card__head">
                <span className="program-card__icon" aria-hidden="true">
                  <Video size={18} focusable="false" />
                </span>
                <div className="program-card__id">
                  <div className="program-card__name">App de escritorio</div>
                  <div className="program-card__meta">Windows · sin Python ni Node.js</div>
                </div>
                <span className="pill pill--ready">Disponible</span>
              </header>

              <p className="program-card__text">
                El mismo trabajo fuera del navegador: un único ejecutable que
                analiza un vídeo o un perfil completo y lo descarga en lote, con
                la cola corriendo en segundo plano.
              </p>

              <ul className="program-list">
                <li>
                  <FolderOpen size={15} aria-hidden="true" focusable="false" />
                  Carpeta de destino elegida con el diálogo del sistema.
                </li>
                <li>
                  <ListUl size={15} aria-hidden="true" focusable="false" />
                  Perfil completo: selección con casillas y descarga en lote.
                </li>
                <li>
                  <RotateRight size={15} aria-hidden="true" focusable="false" />
                  Reanudación con historial si se corta o se cierra el programa.
                </li>
                <li>
                  <LayerGroup size={15} aria-hidden="true" focusable="false" />
                  La ventana nunca se bloquea: todo corre en hilos secundarios.
                </li>
              </ul>

              <a href={DESKTOP_DOWNLOAD_URL} className="btn btn--primary">
                <Download size={16} focusable="false" />
                Descargar para Windows
              </a>

              <p className="program-card__note mt-4">
                Un archivo único, sin instalador. Windows puede avisar la primera
                vez porque no está firmado: pulsa «Más información» y luego
                «Ejecutar de todas formas».
              </p>
            </article>

            <article className="program-card program-card--ready">
              <header className="program-card__head">
                <span className="program-card__icon" aria-hidden="true">
                  <Download size={18} focusable="false" />
                </span>
                <div className="program-card__id">
                  <div className="program-card__name">Instalar en el móvil</div>
                  <div className="program-card__meta">Navegador · sin tienda de apps</div>
                </div>
                <span className="pill pill--ready">Disponible</span>
              </header>

              <p className="program-card__text">
                Red.ly es una aplicación web instalable: se añade a la pantalla de inicio y se
                abre en su propia ventana, sin barra de navegador. No hay nada que descargar de
                una tienda ni que registrarse.
              </p>

              <InstallApp />
            </article>
          </div>
        </section>

        <div className="hint">
          El servidor hace de proxy: el navegador nunca habla directamente con
          la red social ni con los servicios de descarga. Las URLs temporales
          caducan en poco tiempo y nunca se guardan.
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
