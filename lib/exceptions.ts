/**
 * Jerarquía de excepciones de Red.ly.
 *
 * Port de `app/exceptions.py`. Todas heredan de `RedlyError` para poder
 * capturar el fallo completo con un único `catch`.
 */

export class RedlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Error de red o de respuesta HTTP/JSON inesperada. */
export class RequestError extends RedlyError {
  /**
   * ¿Tiene sentido reintentar? El managed challenge de Cloudflare no se
   * resuelve con reintentos, así que la fuente que lo detecta lo marca como
   * final para no esperar el backoff en balde.
   */
  readonly retryable: boolean;

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message);
    this.retryable = options?.retryable ?? true;
  }
}

/** Error durante la resolución o descarga de un archivo. */
export class DownloadError extends RedlyError {}

/** El servicio respondió, pero el contenido solicitado no está disponible. */
export class UnavailableError extends RedlyError {}
