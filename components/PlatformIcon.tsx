import type { ReactElement } from "react";

import {
  FacebookF,
  Instagram,
  Threads,
  Tiktok,
  XTwitter,
  Youtube,
  type IconProps,
} from "./icons";

/** Icono de marca por plataforma (Font Awesome 6, paths incrustados). */
const ICONS: Record<string, (props: IconProps) => ReactElement> = {
  tiktok: Tiktok,
  youtube: Youtube,
  facebook: FacebookF,
  instagram: Instagram,
  twitter: XTwitter,
  threads: Threads,
};

export default function PlatformIcon({
  slug,
  size = 20,
}: {
  slug: string;
  size?: number;
}) {
  const Icon = ICONS[slug];
  if (!Icon) return null;
  return <Icon size={size} aria-hidden="true" focusable="false" />;
}
