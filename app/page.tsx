import type { Metadata } from "next";
import Link from "next/link";

import InstallApp from "@/components/InstallApp";
import PlatformIcon from "@/components/PlatformIcon";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import {
  Bolt,
  Download,
  FolderOpen,
  FolderTree,
  LayerGroup,
  Link as LinkIcon,
  ListUl,
  Lock,
  RotateRight,
  ShieldHalved,
  Terminal,
  Video,
} from "@/components/icons";
import { PLATFORMS, isReady, type PlatformKind } from "@/lib/platforms";
import { DESKTOP_DOWNLOAD_URL, REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Red.ly — Descarga y transcripción de vídeos públicos",
  description:
    "Cliente web y CLI en TypeScript para descargar y transcribir vídeos públicos de TikTok, YouTube, Facebook e Instagram.",
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
    text: "Un manifiesto recuerda lo ya bajado. Si se corta, vuelves a lanzar y continúa donde estaba.",
  },
  {
    icon: FolderOpen,
    title: "Carpeta por perfil",
    text: "Cada perfil se guarda en su propia subcarpeta. En el navegador puedes elegir el destino.",
  },
  {
    icon: Terminal,
    title: "También en terminal",
    text: "Mismo núcleo en la CLI: lotes, pausas, reintentos y salida limpia para usar en scripts.",
  },
  {
    icon: ShieldHalved,
    title: "Sólo contenido público",
    text: "No se eluden CAPTCHA ni controles de acceso, y el navegador nunca habla con TikTok.",
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
          <div className="hero__badge">
            <span className="hero__badge-dot" />
            TikTok disponible · resto pronto
          </div>
          <h1 className="hero__title">
            Descarga y transcribe
            <br />
            vídeos <span>públicos</span>
          </h1>
          <p className="hero__text">
            Red.ly analiza una URL, resuelve el archivo en el CDN y te lo guarda donde elijas.
            Funciona en el navegador y en la terminal, con historial para no repetir descargas.
          </p>
          <div className="hero__actions">
            <div className="hero__actions-main">
              <Link href="/download/tiktok" className="btn btn--primary btn--lg">
                Descargar de TikTok
              </Link>
              <a href="#plataformas" className="btn btn--ghost btn--lg">
                Ver plataformas
              </a>
            </div>
            <a href="#obtener-programa" className="btn btn--ghost btn--lg hero__actions-side">
              Obtener programa
            </a>
          </div>
          <div className="hero__stats">
            <span>
              <b>{available.length}</b> plataforma activa
            </span>
            <span className="hero__stats-sep" />
            <span>
              <b>0</b> registros
            </span>
            <span className="hero__stats-sep" />
            <span>
              <b>CLI</b> incluida
            </span>
          </div>
        </section>

        <section className="landing-section" id="plataformas">
          <div className="section-head">
            <div>
              <div className="section-title">Descargar</div>
              <p className="landing-section__lead">
                Pega la URL de un vídeo o de un perfil completo. En TikTok puedes
                bajar un perfil entero con reanudación y carpeta por perfil.
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
                La web funciona sin instalar nada. Si prefieres la terminal, o un
                programa propio para Windows, esto es lo que hay.
              </p>
            </div>
          </div>

          <div className="program-grid">
            <article className="program-card program-card--ready">
              <header className="program-card__head">
                <span className="program-card__icon" aria-hidden="true">
                  <Terminal size={18} focusable="false" />
                </span>
                <div className="program-card__id">
                  <div className="program-card__name">CLI de Red.ly</div>
                  <div className="program-card__meta">Node.js · terminal</div>
                </div>
                <span className="pill pill--ready">Disponible</span>
              </header>

              <p className="program-card__text">
                El mismo núcleo que la web, ejecutado desde la terminal. Es la opción
                para lotes largos y para encadenar descargas en un script.
              </p>

              <ul className="program-list">
                <li>
                  <LayerGroup size={15} aria-hidden="true" focusable="false" />
                  Un perfil entero en una sola orden, paginando el listado.
                </li>
                <li>
                  <RotateRight size={15} aria-hidden="true" focusable="false" />
                  Reanudación: si se corta, vuelves a lanzar y continúa donde estaba.
                </li>
                <li>
                  <FolderTree size={15} aria-hidden="true" focusable="false" />
                  Carpeta propia por perfil dentro del directorio de salida.
                </li>
                <li>
                  <ListUl size={15} aria-hidden="true" focusable="false" />
                  Pausas y reintentos configurables para no saturar el origen.
                </li>
                <li>
                  <Bolt size={15} aria-hidden="true" focusable="false" />
                  Salida limpia y legible, pensada para leerla o registrarla.
                </li>
              </ul>

              <pre className="program-code">
                <code>npm install{"\n"}npm run cli -- --help</code>
              </pre>

              {REPO_URL ? (
                <a
                  href={REPO_URL}
                  className="btn btn--primary"
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver el código
                </a>
              ) : null}
            </article>

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

            <article className="program-card program-card--ready program-card--install">
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
          TikTok ni con los servicios de descarga. Las URLs temporales caducan en
          ~1 hora y nunca se guardan.
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
