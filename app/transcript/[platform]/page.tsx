import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ComingSoon from "@/components/ComingSoon";
import { PLATFORMS, getPlatform } from "@/lib/platforms";

/**
 * `/transcript/<plataforma>`
 *
 * Ninguna plataforma tiene transcripción implementada: no hay ninguna fuente
 * comprobada de subtítulos, así que todas muestran «Próximamente».
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
    title: `Transcribir de ${platform.name} — Red.ly`,
    description: `Transcripción de ${platform.name} en Red.ly.`,
  };
}

export default async function TranscriptPage({ params }: PageProps) {
  const { platform: slug } = await params;
  const platform = getPlatform(slug);
  if (!platform) notFound();

  return <ComingSoon platform={platform} kind="transcript" />;
}
