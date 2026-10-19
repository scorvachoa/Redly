---
name: integrar-servicio
description: Proceso automático cuando el usuario pega un link de servicio externo de descarga o transcripción de video (p. ej. "te paso este servicio", "analiza este link", "¿es factible integrar X?"). Analiza el servicio, emite veredicto de factibilidad y, si es factible, hace el plan e implementación completa en Red.ly siguiendo las convenciones del repo; si no es factible, solo informa y no toca código. Usar SOLO para integrar nuevas fuentes/servicios en Red.ly, no para tareas generales del código.
---

# Integrar un servicio externo en Red.ly

Proceso reproducido del que se usó para SnapYT (YouTube) y SavTikPro/TikVid (TikTok).
Cuando el usuario pegue un link de servicio de descarga o transcripción de video,
ejecutar estas fases en orden. **No implementar nada si el veredicto de la Fase 1
no es `factible`.**

## Fase 1 — Análisis y factibilidad (sin tocar código)

1. **Identificar el servicio**: URL que dio el usuario, qué ofrece (descarga,
   transcripción, ambos), plataformas que soporta.
2. **Inspeccionar con `webfetch`**: home del servicio + páginas de ejemplo.
   Buscar: endpoints de API (`/api/...`, `admin-ajax.php?action=...`,
   `/wp-json/...`), formularios con inputs ocultos (nonce, token, preview_id),
   selectores de formato (`#fmt-select`, `data-*`), llamadas `fetch(`/`POST`
   en los scripts inline del HTML.
3. **Verificación empírica obligatoria** (scripts `.cjs` en
   `C:\Users\USUARIO\AppData\Local\Temp\opencode`, nunca en el repo;
   borrarlos al terminar): reproducir el flujo completo desde Node
   (`fetch` nativo) — nonce → resolución → descarga/estado. Comprobar:
   - ¿Funciona sin navegador ni claves de API? (cabeceras realistas si hace falta)
   - ¿WAF (Cloudflare) bloquea? → probar 1–2 veces con User-Agent/headers del
     navegador; si persiste, es bloqueo → `no factible`.
   - ¿Tokens/nonces caducan rápido? ¿Rate limit agresivo? Documentar.
   - Para descarga: ¿devuelve URL directa con `Content-Disposition: attachment`
     y host estable? ¿Soporta Range/206?
4. **Encaje con la arquitectura actual**: leer `lib/sources.ts`,
   `lib/config.ts` (allowlist `ALLOWED_*_HOSTS`), `lib/exceptions.ts`,
   `lib/models.ts` (`MediaItem`, `DownloadOption`, `TranscriptResult`),
   `app/api/search/route.ts` / `app/api/profile/route.ts`. ¿Encaja el flujo
   en el contrato existente o exige endpoint nuevo?
5. **Veredicto** — responder exactamente uno:
   - `factible`: flujo verificado empíricamente sin claves, sin bloqueo de
     WAF y encaja en el modelo → pasar a Fase 2.
   - `factible con limitaciones`: factible pero con caveats (sólo calidades
     bajas, caducidad corta de tokens, sin perfiles, sólo una plataforma…)
     → pasar a Fase 2 dejando las limitaciones claras en el plan.
   - `no factible`: WAF que exige navegador, claves obligatorias, flujos
     no reproducibles o fuera de alcance → **parar aquí**. Entregar solo el
     informe (qué probaste, por qué falló, alternativas posibles). No crear
     ni modificar ficheros.

## Fase 2 — Plan

Antes de escribir código, entregar un plan corto con:

- **Ficheros a crear**: `lib/<fuente>.ts`, `tests/<fuente>.test.ts`,
  `tests/fixtures/<fuente>_<pagina>.html` (si parsea HTML).
- **Ficheros a modificar**: `lib/config.ts` (URLs, headers, allowlist),
  `lib/sources.ts` (registro), `lib/platforms.ts`/`lib/models.ts` si aplica,
  `scripts/api-smoke.ts`, `README.md`, `.env.example`.
- **Contrato de datos**: qué devuelve cada paso del flujo y cómo se mapea a
  `MediaItem`/`DownloadOption`/`TranscriptResult`.
- **Estrategia de tests**: fetch encolado (stub de `globalThis.fetch` que
  devuelve respuestas en orden), fixture saneado (sustituir pids/nonces/urls
  reales por `TEST...`), asserts de regresión del flujo.
- **Verificación**: `npm run typecheck && npm test && npm run build &&
  npm run smoke` (el smoke necesita red real; sólo en el último paso).

Si el alcance es grande, delegar en paralelo con subagentes `general`
(documentación README, tests independientes) — nunca dos agentes editando
el mismo fichero.

## Fase 3 — Implementación

Convenciones del repo (no negociables):

- **Sólo fuentes verificadas empíricamente**; nada de claves, tokens ni
  endpoints especulativos. Comentarios y docs en español.
- Fuente nueva = `lib/<fuente>.ts` que implementa el mismo patrón que
  `lib/snapyt.ts`/`lib/savetik.ts`: `searchVideo`, `fetchProfile`,
  `fetchTranscript` según aplique; errores con `UnavailableError`/
  `RequestError({ retryable })`; reintentos con backoff y
  `pause()` (los tests fijan `RETRY_BACKOFF_SECONDS=0`).
- Allowlist en `lib/config.ts` con el host **exacto** del stream; toda URL
  de descarga pasa por `/api/download` (rate limit + allowlist + streaming).
- Registro en `lib/sources.ts` (`["tiktok", "snapyt", ...]`). Plataformas
  nuevas: `lib/platforms.ts` + páginas `app/download/[platform]` y
  `app/transcript/[platform]` (revisar cómo están hechas las existentes).
- Tests en Vitest **sin red**: stub de fetch encolado, fixtures HTML
  saneados, cubrir happy path y errores. No usar `npm run lint`
  (interactivo, sin config de ESLint).
- Orden de verificación final:
  1. `npm run typecheck && npm test`
  2. `npm run build`
  3. `npm run smoke` (red real; añadir paso en `scripts/api-smoke.ts`)
  4. README: sección de la fuente, tabla de API si hay ruta nueva,
     árbol de arquitectura, recuento de tests actualizado.
- No hacer `git commit` salvo que el usuario lo pida. Limpiar scripts
  temporales al terminar.

## Errores típicos ya vistos

- `.includes("audio")` clasifica `video+audio` como audio → comparar kinds
  exactos (`video-only`, `audio-only`).
- `sort` de opciones: resolución descendente por altura extraída de la
  etiqueta (`1080p`), orden estable para empates.
- Formularios/acciones que caducan: resolver credenciales frescas en cada
  llamada server-side (stateless), no cachear nonces.
- El smoke test debe ejercitar el flujo real completo (búsqueda → endpoint
  nuevo → stream con bytes) no solo la respuesta JSON.
