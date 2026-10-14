/**
 * Fachada de fuentes de contenido.
 *
 * Motivo de existir: hasta ahora las rutas hacían `new SavetikSource()` a pelo,
 * de modo que el orquestador (API, CLI) estaba atado a un único proveedor de
 * terceros sin API documentada. Este módulo introduce un contrato mínimo
 * (`ContentSource`) y un registro, de modo que añadir otra plataforma significa
 * implementar el contrato y registrarla, sin tocar las rutas ni el CLI.
 *
 * **Regla de `base.md` §2**: sólo se registra una fuente que esté verificada
 * empíricamente. Las plataformas sin fuente comprobada no entran aquí; siguen
 * existiendo en `lib/platforms.ts` con `ready: false` para la navegación.
 */

import type { TikTokResult } from "./models";
import { PLATFORMS, type Platform } from "./platforms";
import { SavetikSource, type ProfilePage } from "./savetik";

export type { ProfilePage };

/**
 * Contrato mínimo que debe cumplir cualquier fuente.
 *
 * Está deliberadamente centrado en las dos operaciones que la app necesita
 * hoy: resolver un vídeo suelto y devolver **una página** de un perfil. La
 * paginación se hace fuera, invocación a invocación, por los límites de
 * `maxDuration` en serverless.
 */
export interface ContentSource {
  /** Identificador estable, para logs y telemetría. */
  readonly id: string;
  /** Slugs de `lib/platforms.ts` que esta fuente sabe servir. */
  readonly platforms: readonly string[];
  /** Resuelve un vídeo suelto en el modelo canónico. */
  searchVideo(url: string): Promise<TikTokResult>;
  /** Devuelve una sola página de un perfil y el cursor para la siguiente. */
  listProfilePage(
    url: string,
    cursor?: string | null,
    page?: number,
    limit?: number,
  ): Promise<ProfilePage>;
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/**
 * Instancias de las fuentes verificadas, en orden de preferencia.
 *
 * Se crean una sola vez por módulo: compartir el cliente entre invocaciones
 * aprovecha el *warm-up* de la sesión HTTP dentro de la misma instancia de la
 * función serverless. No es un caché de datos, sólo de conexión.
 */
const SOURCES: readonly ContentSource[] = [new SavetikSource()];

/** Devuelve todas las fuentes registradas (orden de preferencia). */
export function allSources(): readonly ContentSource[] {
  return SOURCES;
}

/**
 * Fuente que sirve a una plataforma, o `null` si no hay ninguna verificada.
 * Si varias sirven la misma, se queda con la primera registrada.
 */
export function sourceForPlatform(slug: string | null | undefined): ContentSource | null {
  const key = (slug ?? "").trim().toLowerCase();
  if (!key) return null;
  return SOURCES.find((source) => source.platforms.includes(key)) ?? null;
}

/**
 * Detecta la plataforma de una URL por su host y devuelve la fuente.
 *
 * Devuelve `null` cuando la plataforma no tiene fuente registrada, de modo que
 * la ruta pueda responder 400/501 en lugar de intentar adivinar.
 */
export function sourceForUrl(url: string | null | undefined): ContentSource | null {
  return sourceForPlatform(detectPlatformSlug(url));
}

/**
 * Plataforma a la que pertenece una URL, según `hosts` de `lib/platforms.ts`.
 *
 * Coincide el host exacto o cualquier subdominio (`m.tiktok.com`), que es lo
 * habitual en los enlaces cortos.
 */
export function detectPlatformSlug(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const match = PLATFORMS.find((platform) =>
    platform.hosts.some((candidate) => {
      const wanted = candidate.toLowerCase();
      return host === wanted || host.endsWith(`.${wanted}`);
    }),
  );
  return match ? match.slug : null;
}

/** Plataforma completa a la que pertenece una URL, o `null`. */
export function platformForUrl(url: string | null | undefined): Platform | null {
  const slug = detectPlatformSlug(url);
  if (!slug) return null;
  return PLATFORMS.find((platform) => platform.slug === slug) ?? null;
}

/** Comprueba si una fuente sirve a la plataforma indicada. */
export function sourceSupports(source: ContentSource, slug: string): boolean {
  return source.platforms.includes(slug.trim().toLowerCase());
}
