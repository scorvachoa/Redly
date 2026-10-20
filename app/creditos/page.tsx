import type { Metadata } from "next";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Créditos — Red.ly",
  description:
    "De qué está hecho Red.ly: tecnologías, iconos y licencias, dónde se despliega y de dónde sale el flujo de descarga.",
};

const STACK: Array<{ name: string; what: string }> = [
  {
    name: "Next.js y React",
    what: "Interfaz, API serverless y render estático de la portada y de las páginas de documento.",
  },
  {
    name: "TypeScript",
    what: "Todo el código, de la interfaz a la API.",
  },
  {
    name: "Tailwind CSS",
    what: "Estilos con @apply sobre clases semánticas; sin tailwind.config.js.",
  },
  {
    name: "Cheerio",
    what: "Lectura del HTML devuelto por los servicios de origen.",
  },
  {
    name: "Vitest",
    what: "Suite de tests, ejecutable sin conexión a Internet.",
  },
];

export default function CreditsPage() {
  return (
    <div className="shell">
      <SiteHeader />

      <main className="main doc">
        <h1 className="doc__title">Créditos</h1>
        <p className="doc__lead">
          Red.ly es un proyecto de estudio y sin ánimo de lucro. Esto es de qué está
          hecho, qué licencias lleva encima y a quién hay que agradecer algo.
        </p>

        <h2>Origen del proyecto</h2>
        <p>
          La web es el port a TypeScript de un prototipo escrito en Python
          que implementaba el mismo flujo HTTP. De ahí salen las decisiones que hoy
          estructuran el proyecto: paginación por cursor, historial local de
          descargas y una lista de fuentes comprobadas empíricamente antes de
          usarlas.
        </p>

        <h2>Tecnologías</h2>
        <ul>
          {STACK.map((item) => (
            <li key={item.name}>
              <b>{item.name}.</b> {item.what}
            </li>
          ))}
        </ul>

        <h2>Iconos</h2>
        <p>
          Los iconos de la interfaz son paths de <b>Font Awesome 6 Free</b> y están
          licenciados bajo{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            Creative Commons CC BY 4.0
          </a>
          . Se han incrustado como SVG en <code>components/icons.tsx</code> para no
          arrastrar dependencias al build, sin alterar su forma. La autoría de los
          iconos es de{" "}
          <a href="https://fontawesome.com/" target="_blank" rel="noreferrer">
            Font Awesome
          </a>
          .
        </p>

        <h2>Despliegue</h2>
        <p>
          La versión en línea se sirve en{" "}
          <a href="https://red-ly.vercel.app/" target="_blank" rel="noreferrer">
            red-ly.vercel.app
          </a>
          , con Next.js sobre funciones serverless. En el navegador se puede
          instalar como aplicación (PWA), sin pasar por ninguna tienda.
        </p>

        <h2>Servicios de terceros</h2>
        <p>
          Red.ly no analiza el vídeo en casa: el HTML de los vídeos y de los
          perfiles lo devuelven siete servicios de terceros, a los que sólo se
          les envían peticiones HTTP normales sobre URLs públicas.
        </p>
        <ul>
          <li>
            <b>
              <a href="https://tikvid.io/" target="_blank" rel="noreferrer">
                TikVid
              </a>
              .</b>{" "}
            Resuelve vídeos sueltos. Es el segundo intento cuando SavTikPro no
            devuelve nada.
          </li>
          <li>
            <b>
              <a href="https://savetikpro.com/" target="_blank" rel="noreferrer">
                SavTikPro
              </a>
              .</b>{" "}
            Fuente principal de TikTok: listado paginado de perfiles y primera
            opción para vídeos sueltos. Es de la misma familia de producto que
            TikVid.
          </li>
          <li>
            <b>
              <a href="https://www.snapyt.app/" target="_blank" rel="noreferrer">
                SnapYT
              </a>
              .</b>{" "}
            Fuente de YouTube: devuelve las opciones de descarga del vídeo
            (vídeos sueltos y Shorts).
          </li>
          <li>
            <b>
              <a href="https://fsave.net/" target="_blank" rel="noreferrer">
                FSave
              </a>
              .</b>{" "}
            Fuente de Facebook: resuelve vídeos y Reels sueltos y devuelve las
            opciones de descarga.
          </li>
          <li>
            <b>
              <a href="https://igexport.com/" target="_blank" rel="noreferrer">
                IGExport
              </a>
              .</b>{" "}
            Fuente principal de Instagram: resuelve reels y publicaciones
            sueltas y devuelve el archivo directo del CDN de Instagram.
          </li>
          <li>
            <b>
              <a href="https://loveinsta.com/" target="_blank" rel="noreferrer">
                LoveInsta
              </a>
              .</b>{" "}
            Reserva de Instagram: entra cuando IGExport no devuelve nada y
            resuelve la publicación con un único envío.
          </li>
          <li>
            <b>
              <a href="https://ilovex.com/es" target="_blank" rel="noreferrer">
                iLoveX
              </a>
              .</b>{" "}
            Fuente de X (Twitter): resuelve tweets sueltos con un único envío y
            devuelve los vídeos en una sola calidad.
          </li>
          <li>
            <b>
              <a href="https://savethreads.com/es" target="_blank" rel="noreferrer">
                SaveThreads
              </a>
              .</b>{" "}
            Fuente de Threads: resuelve publicaciones sueltas con un único envío
            y devuelve los vídeos en una sola calidad.
          </li>
        </ul>
        <p>
          <b>Red.ly no es una API oficial</b> de TikVid, SavTikPro, SnapYT,
          FSave, IGExport, LoveInsta, iLoveX ni SaveThreads, ni de las
          plataformas de vídeo.
          Sus
          endpoints y su HTML no están documentados, pueden cambiar en cualquier
          momento y estos servicios no patrocinan ni respaldan este proyecto.
          Los enlaces se citan únicamente para identificar de dónde sale el
          contenido.
        </p>

        <h2>Contenido y derechos</h2>
        <p>
          Los vídeos pertenecen a sus autores y a las plataformas donde se
          publican. Red.ly sólo admite contenido público: no elude CAPTCHA, ni
          muros de pago, ni controles de acceso, ni restricciones de edad. Usar la
          herramienta de forma lícita es responsabilidad de quien la usa.
        </p>

        <h2>Sin afiliación</h2>
        <p>
          Red.ly no está afiliado, patrocinado ni respaldado por TikTok ni por
          ninguna de las plataformas que nombra. Las marcas citadas pertenecen a sus
          respectivos titulares.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
