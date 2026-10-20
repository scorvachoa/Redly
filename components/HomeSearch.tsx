"use client";

/**
 * Buscador general de la portada.
 *
 * Un solo campo para todas las redes: mientras se escribe, la entrada se
 * clasifica con `lib/urlrules.ts` (las mismas reglas que usan la API y el
 * descargador) y un chip bajo el campo dice qué red y qué tipo de contenido
 * se ha detectado. Al enviar se navega a `/download/<slug>?url=<normalizada>`,
 * donde `Downloader` recoge el parámetro, rellena su propio campo y lanza el
 * análisis: la portada no analiza nada por sí misma, sólo elige destino, así
 * que no se duplica ningún flujo.
 *
 * El fallo de envío (entrada vacía, URL desconocida, perfil sin listado…) se
 * cuenta aquí; una vez en la página de la plataforma siguen mandando los
 * mensajes del descargador.
 */

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import PlatformIcon from "@/components/PlatformIcon";
import { CircleCheck, CircleInfo, TriangleExclamation } from "@/components/icons";
import { getPlatform } from "@/lib/platforms";
import { classifyInput, resolveSearchInput, type UrlKind } from "@/lib/urlrules";

/** Host con al menos un punto, con o sin esquema (`tiktok.com/x`, `https://…`). */
const HOST_SHAPED_RE = /^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:[/?#]\S*)?$/i;

/**
 * ¿Parece ya una URL aunque ninguna regla la reconozca?
 *
 * Sin esto, el chip «URL no reconocida» saldría con la primera tecla
 * (`h`, `ht`…); sólo avisa cuando la entrada tiene forma de dominio.
 */
function looksLikeUrl(value: string): boolean {
  return !value.includes(" ") && HOST_SHAPED_RE.test(value);
}

/** Etiqueta corta del chip para cada tipo de contenido reconocido. */
function kindLabel(slug: string, kind: UrlKind, profilesReady: boolean): string {
  if (kind === "video") return "Vídeo";
  if (kind === "unsupported") return "No es un vídeo concreto";
  if (!profilesReady) return "Perfil · sin listado";
  return slug === "youtube" ? "Canal o lista" : "Perfil completo";
}

type Detection =
  | { tone: "idle" }
  | { tone: "unknown" }
  | {
      tone: "ok" | "warn";
      slug: string;
      name: string;
      accent: string;
      label: string;
    };

/**
 * Estado visual del chip para el texto actual.
 *
 * El tono sale de `resolveSearchInput` (misma decisión que al enviar) y el
 * nombre/etiqueta de `classifyInput`, que devuelve el destino aunque no se
 * pueda navegar: así el chip sigue explicando *qué* se ha detectado cuando la
 * entrada todavía no es utilizable.
 */
function detect(value: string): Detection {
  const raw = value.trim();
  if (!raw) return { tone: "idle" };

  const classified = classifyInput(raw);
  if (!classified) return looksLikeUrl(raw) ? { tone: "unknown" } : { tone: "idle" };

  const platform = getPlatform(classified.slug);
  const resolution = resolveSearchInput(raw);
  return {
    tone: resolution.ok ? "ok" : "warn",
    slug: classified.slug,
    name: platform?.name ?? classified.slug,
    accent: platform?.accent ?? "var(--accent)",
    label: kindLabel(classified.slug, classified.kind, platform?.profilesReady === true),
  };
}

export default function HomeSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const detection = detect(value);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resolution = resolveSearchInput(value);
    if (!resolution.ok) {
      setError(resolution.error);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    router.push(`/download/${resolution.slug}?url=${encodeURIComponent(resolution.url)}`);
  }

  return (
    <form className="hero__search" onSubmit={submit} noValidate>
      <label className="label" htmlFor="home-search-url">
        Pega cualquier enlace
      </label>

      <div className="url-row">
        <input
          id="home-search-url"
          ref={inputRef}
          className="input"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="URL de un vídeo o de un perfil · o @usuario de TikTok"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn btn--primary">
          Analizar
        </button>
      </div>

      <p className={`hero__detect hero__detect--${detection.tone}`} role="status" aria-live="polite">
        {detection.tone === "idle" ? null : detection.tone === "unknown" ? (
          <>
            <span className="hero__detect-icon hero__detect-icon--error" aria-hidden="true">
              <TriangleExclamation size={11} focusable="false" />
            </span>
            <span>URL no reconocida</span>
          </>
        ) : (
          <>
            <span
              className="hero__detect-icon"
              style={{ "--tile": detection.accent } as React.CSSProperties}
              aria-hidden="true"
            >
              <PlatformIcon slug={detection.slug} size={11} />
            </span>
            <span>
              <b>{detection.name}</b> · {detection.label}
            </span>
            {detection.tone === "ok" ? (
              <span className="hero__detect-check" aria-hidden="true">
                <CircleCheck size={13} focusable="false" />
              </span>
            ) : (
              <span className="hero__detect-check hero__detect-check--warn" aria-hidden="true">
                <CircleInfo size={13} focusable="false" />
              </span>
            )}
          </>
        )}
      </p>

      {error ? (
        <p className="status status--error" role="alert">
          <span className="status__icon" aria-hidden="true">
            <TriangleExclamation size={14} focusable="false" />
          </span>
          <span>{error}</span>
        </p>
      ) : null}
    </form>
  );
}
