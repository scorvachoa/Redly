import type { MetadataRoute } from "next";

/**
 * Manifiesto de la PWA, generado por la convención de ficheros de Next.js
 * (`app/manifest.ts` → `/manifest.webmanifest`).
 *
 * Con esto el navegador ofrece «Instalar aplicación» en Android y escritorio.
 * iOS no lee este manifiesto: usa `apple-mobile-web-app-capable` y el
 * `apple-icon.png`, ambos declarados en `app/layout.tsx`.
 *
 * `theme_color` es el acento de marca: colorea la barra del sistema en
 * Android y se muestra en el diálogo de instalación.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Red.ly — Descarga y transcripción de vídeos públicos",
    short_name: "Red.ly",
    description:
      "Analiza una URL, resuelve el archivo en el CDN y lo guarda donde elijas. Sin registro ni cuentas.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "es",
    dir: "ltr",
    background_color: "#f5f5f7",
    theme_color: "#fe2c55",
    categories: ["utilities", "productivity"],
    icons: [
      // `any` para el diálogo de escritorio y Android.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // `maskable`: Android recorta en un círculo del 80 %, el guion va
      // escalado dentro de esa zona segura (lo genera scripts/make-favicon.cjs).
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      // El SVG se ofrece como respaldo para navegadores que lo soporten.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
