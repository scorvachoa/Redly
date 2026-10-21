import type { Metadata } from "next";

import HomeDownloader from "@/components/HomeDownloader";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Red.ly — Descarga fotos y vídeos públicos",
  description:
    "Cliente web en TypeScript para descargar fotos y vídeos públicos de TikTok, YouTube, Facebook, Instagram, X y Threads.",
};

export default function WelcomePage() {
  return (
    <div className="shell">
      <SiteHeader />

      <main className="main">
        <section className="hero">
          <div className="hero__glow" aria-hidden="true" />
          <h1 className="hero__title">
            Descarga fotos y vídeos <span>públicos</span>
          </h1>

          <HomeDownloader />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
