/**
 * Información que recibe la función en cada intento.
 */
export interface Control {
  /** Signal del intento actual. Pásalo a `fetch` u otras APIs cancelables. */
  readonly signal: AbortSignal;
  /** Número del intento actual, empezando en 1. */
  readonly attempt: number;
  /** Total de intentos permitidos. */
  readonly attempts: number;
  /** Error del intento anterior, si existe. */
  readonly lastError?: unknown;
}

/**
 * Información que recibe `onRetry` antes de reejecutar la función.
 */
export interface RetryEvent {
  /** Número del intento que está por ejecutarse (2, 3, ...). */
  readonly attempt: number;
  /** Total de intentos permitidos. */
  readonly attempts: number;
  /** Error que provocó el reintento. */
  readonly error: unknown;
}

export interface RecilienceOptions {
  /** Número de intentos antes de rechazar. Por defecto `1`. */
  attempts?: number;
  /** Signal para cancelar la ejecución y los reintentos pendientes. */
  signal?: AbortSignal;
  /** Se llama cada vez que la función se va a reejecutar. */
  onRetry?: (event: RetryEvent) => void | Promise<void>;
}

export interface Recilience {
  run<T>(fn: (control: Control) => T | Promise<T>): Promise<T>;
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("This operation was aborted", "AbortError");

/**
 * Crea un ejecutor con reintentos.
 *
 * @example
 * const res = await recilience({ attempts: 3 }).run(({ signal }) =>
 *   fetch("https://example.com", { signal }),
 * );
 */
export const recilience = (options: RecilienceOptions = {}): Recilience => {
  const attempts = options.attempts ?? 1;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(
      `options.attempts must be an integer >= 1, received ${attempts}`,
    );
  }
  const { signal: parentSignal, onRetry } = options;

  return {
    async run<T>(fn: (control: Control) => T | Promise<T>): Promise<T> {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (parentSignal?.aborted) throw abortReason(parentSignal);

        if (attempt > 1 && onRetry) {
          await onRetry({ attempt, attempts, error: lastError });
          if (parentSignal?.aborted) throw abortReason(parentSignal);
        }

        // Cada intento tiene su propio controller, enlazado al signal externo.
        const controller = new AbortController();
        const onAbort = () => controller.abort(abortReason(parentSignal!));
        parentSignal?.addEventListener("abort", onAbort, { once: true });

        try {
          return await fn({
            signal: controller.signal,
            attempt,
            attempts,
            lastError,
          });
        } catch (error) {
          // Si se canceló desde afuera, no se reintenta.
          if (parentSignal?.aborted) throw abortReason(parentSignal);
          lastError = error;
        } finally {
          // No se aborta el controller al terminar: un `fetch` resuelto aún
          // puede estar leyendo el body con ese signal.
          parentSignal?.removeEventListener("abort", onAbort);
        }
      }

      throw lastError;
    },
  };
};

export default recilience;
