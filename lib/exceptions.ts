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
export class RequestError extends RedlyError {}

/** Error durante la resolución o descarga de un archivo. */
export class DownloadError extends RedlyError {}

/** El servicio respondió, pero el contenido solicitado no está disponible. */
export class UnavailableError extends RedlyError {}
