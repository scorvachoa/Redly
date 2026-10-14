import type { Metadata } from "next";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { HISTORY_STORAGE_KEY } from "@/lib/history";

export const metadata: Metadata = {
  title: "Privacidad — Red.ly",
  description:
    "Qué datos recoge Red.ly (y cuáles no): sin registro, sin cookies propias, sin base de datos y sin guardar URLs ni tokens.",
};

const STORAGE_ROWS: Array<{ key: string; what: string }> = [
  {
    key: "redly-theme",
    what: "El tema claro u oscuro que elegiste. Un solo valor de texto.",
  },
  {
    key: HISTORY_STORAGE_KEY,
    what: "Tu historial de descargas locales: id del vídeo, estado, nombre de archivo, bytes, título y marca de tiempo.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="shell">
      <SiteHeader />

      <main className="main doc">
        <h1 className="doc__title">Privacidad</h1>
        <p className="doc__lead">
          Red.ly no tiene base de datos, ni usuarios, ni cuentas. Esto es exactamente lo
          que guarda y lo que no.
        </p>

        <h2>Lo que no recogemos</h2>
        <ul>
          <li>
            <b>Sin registro.</b> No hay formulario de alta, ni correo, ni contraseña.
          </li>
          <li>
            <b>Sin base de datos.</b> El servidor no persiste nada entre peticiones: cada
            llamada se procesa y se olvida.
          </li>
          <li>
            <b>Sin cookies propias.</b> La aplicación no instala cookies de seguimiento
            ni de analítica.
          </li>
          <li>
            <b>Sin cuentas de terceros.</b> No hay «entrar con Google» ni SDK de redes
            sociales.
          </li>
        </ul>

        <h2>Lo que se guarda en tu navegador</h2>
        <p>
          Sólo dos claves en <code>localStorage</code>, ambas en tu equipo. Puedes borrarlas
          cuando quieras desde las herramientas del navegador y la aplicación sigue
          funcionando (perderás el tema elegido y el historial).
        </p>
        <div className="doc__table">
          {STORAGE_ROWS.map((row) => (
            <div className="doc__row" key={row.key}>
              <code className="doc__key">{row.key}</code>
              <span className="doc__val">{row.what}</span>
            </div>
          ))}
        </div>
        <p>
          El historial guarda <b>sólo el id del vídeo</b>, nunca la URL de la que vino.
          Su función es evitar repetir descargas; puedes vaciarlo con el botón
          «Borrar historial» del descargador.
        </p>

        <h2>URLs y tokens</h2>
        <p>
          Cuando pegas una URL, el servidor la usa para pedir el archivo y te devuelve el
          stream. Las direcciones temporales del CDN caducan en aproximadamente una hora y{" "}
          <b>no se escriben en ningún sitio</b>: ni en el navegador ni en el servidor.
        </p>

        <h2>Qué ve el servidor</h2>
        <p>
          El servidor hace de proxy: tu navegador nunca habla directamente con TikTok ni
          con los servicios de descarga. Esto evita exponer esas peticiones a tu conexión,
          pero significa que <b>la URL que pegas sí pasa por el servidor</b> mientras se
          procesa. No se registra en un almacén persistente.
        </p>

        <h2>La CLI</h2>
        <p>
          La versión de terminal funciona igual: escribe un <code>manifest.json</code> en
          la carpeta de salida para reanudar lotes, y ese archivo tampoco contiene URLs ni
          tokens, sólo ids, rutas y estados. Es tuyo y lo puedes borrar.
        </p>

        <h2>Servicios de terceros</h2>
        <p>
          El contenido sale de servicios de terceros a los que Red.ly hace peticiones.
          Ellos tienen sus propias políticas de privacidad y sus propios registros de
          acceso. Red.ly no controla ni modera lo que esos servicios guardan.
        </p>

        <h2>Contenido y derechos</h2>
        <p>
          Red.ly sólo admite contenido público. No elude CAPTCHA, ni muros de pago, ni
          controles de acceso, ni restricciones de edad. Descargar material protegido
          puede infringir los derechos de su autor y los términos de la plataforma de
          origen; la responsabilidad de usar la herramienta de forma lícita es del
          usuario.
        </p>

        <h2>Cambios</h2>
        <p>
          Al no haber cuenta ni base de datos, no hay nada que notificarte
          individualmente. Si esta página cambia, cambia aquí.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
