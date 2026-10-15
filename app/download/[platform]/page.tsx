import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ComingSoon from "@/components/ComingSoon";
import Downloader from "@/components/Downloader";
import { PLATFORMS, getPlatform } from "@/lib/platforms";

/**
 * `/download/<plataforma>`
 *
 * Sólo TikTok tiene implementación real. El resto muestra «Próximamente» en
 * lugar de un formulario que no podría funcionar.
 */

interface PageProps {
  params: Promise<{ platform: string }>;
}

export function generateStaticParams() {
  return PLATFORMS.map((platform) => ({ platform: platform.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform: slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) return { title: "Red.ly" };
  return {
    title: `Descargar de ${platform.name} — Red.ly`,
    description: platform.blurb,
  };
}

export default async function DownloadPage({ params }: PageProps) {
  const { platform: slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) notFound();

  if (!platform.ready) return <ComingSoon platform={platform} kind="download" />;

  return <Downloader platform={platform} />;
}
