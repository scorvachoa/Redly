import type { Metadata, Viewport } from "next";

import ServiceWorkerRegistration from "@/components/ServiceWorker";

import "./globals.css";

export const metadata: Metadata = {
  title: "Red.ly — Descarga y transcripción de vídeos públicos",
  description:
    "Cliente web en TypeScript para descargar y transcribir vídeos públicos. TikTok, YouTube, Facebook e Instagram disponibles; el resto de plataformas, próximamente.",
  applicationName: "Red.ly",
  appleWebApp: {
    capable: true,
    // `black` = texto blanco en la barra: legible sobre el fondo oscuro de la
    // app instalada (`default` dejaría texto negro sobre negro).
    statusBarStyle: "black",
    title: "Red.ly",
  },
  other: {
    // Next emite `mobile-web-app-capable`, pero Safari en iOS sólo lee éste:
    // sin él, «Añadir a pantalla de inicio» abriría la app en la pestaña.
    "apple-mobile-web-app-capable": "yes",
  },
};

/**
 * `theme_color` colorea la barra del sistema en Android y el título en la
 * pantalla de inicio. Es el mismo que declara `app/manifest.ts`: el fondo
 * oscuro de la app, para que la barra se funda con la interfaz.
 */
export const viewport: Viewport = {
  themeColor: "#0f0f12",
  width: "device-width",
  initialScale: 1,
};

/**
 * Aplica el tema guardado antes del primer pintado para evitar el destello
 * blanco. Debe ser idéntico a la clave que usa `components/ThemeToggle`.
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("redly-theme");if(t!=="dark"&&t!=="light"){t=(typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
