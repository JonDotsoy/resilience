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
  /** Milisegundos que se esperarán antes de reejecutar. */
  readonly delay: number;
}

/** Datos para calcular la espera antes de un reintento. */
export interface DelayContext {
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
  /**
   * Milisegundos a esperar entre intentos. Puede ser un número fijo o una
   * función para calcularlo (por ejemplo, backoff exponencial). Por defecto `0`.
   */
  delay?: number | ((context: DelayContext) => number);
  /** Se llama cada vez que la función se va a reejecutar, antes de la espera. */
  onRetry?: (event: RetryEvent) => void | Promise<void>;
  /**
   * Decide si un error se reintenta. Si devuelve `false`, `attempt` rechaza de
   * inmediato con ese error. Por defecto se reintentan todos los errores.
   */
  retryable?: (
    error: unknown,
    context: RetryableContext,
  ) => boolean | Promise<boolean>;
  /**
   * Tiempo máximo en ms para cada intento. Al vencer se aborta `control.signal`
   * y el intento falla con un `DOMException` de nombre `"TimeoutError"`, que
   * cuenta como un fallo más (se puede reintentar).
   */
  timeout?: number;
}

/** Datos que recibe `retryable`. */
export interface RetryableContext {
  /** Número del intento que acaba de fallar. */
  readonly attempt: number;
  /** Total de intentos permitidos. */
  readonly attempts: number;
}

export interface Recilience {
  attempt<T>(fn: (control: Control) => T | Promise<T>): Promise<T>;
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("This operation was aborted", "AbortError");

const timeoutError = (ms: number) =>
  new DOMException(`The attempt timed out after ${ms} ms`, "TimeoutError");

const assertDelay = (ms: number): number => {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`delay must be a finite number >= 0, received ${ms}`);
  }
  return ms;
};

/** Espera `ms` milisegundos; rechaza de inmediato si se aborta el signal. */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    if (ms <= 0) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Crea un ejecutor con reintentos.
 *
 * @example
 * const res = await recilience({ attempts: 3 }).attempt(({ signal }) =>
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
  const { signal: parentSignal, onRetry, retryable, timeout, delay = 0 } = options;
  if (typeof delay === "number") assertDelay(delay);
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new RangeError(
      `options.timeout must be a finite number > 0, received ${timeout}`,
    );
  }

  return {
    async attempt<T>(fn: (control: Control) => T | Promise<T>): Promise<T> {
      let lastError: unknown;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (parentSignal?.aborted) throw abortReason(parentSignal);

        if (attempt > 1) {
          const context = { attempt, attempts, error: lastError };
          const ms = assertDelay(
            typeof delay === "function" ? delay(context) : delay,
          );
          if (onRetry) await onRetry({ ...context, delay: ms });
          await sleep(ms, parentSignal);
          if (parentSignal?.aborted) throw abortReason(parentSignal);
        }

        // Cada intento tiene su propio controller, enlazado al signal externo.
        const controller = new AbortController();
        const onAbort = () => controller.abort(abortReason(parentSignal!));
        parentSignal?.addEventListener("abort", onAbort, { once: true });
        let timer: ReturnType<typeof setTimeout> | undefined;

        try {
          const run = Promise.resolve().then(() =>
            fn({ signal: controller.signal, attempt, attempts, lastError }),
          );
          if (timeout === undefined) return await run;

          // Si vence el timeout, la promesa de `fn` puede rechazar después.
          run.catch(() => {});
          return await Promise.race([
            run,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                const error = timeoutError(timeout);
                controller.abort(error);
                reject(error);
              }, timeout);
            }),
          ]);
        } catch (error) {
          // Si se canceló desde afuera, no se reintenta.
          if (parentSignal?.aborted) throw abortReason(parentSignal);
          if (
            attempt < attempts &&
            retryable &&
            !(await retryable(error, { attempt, attempts }))
          ) {
            throw error;
          }
          lastError = error;
        } finally {
          clearTimeout(timer);
          // No se aborta el controller al terminar: un `fetch` resuelto aún
          // puede estar leyendo el body con ese signal.
          parentSignal?.removeEventListener("abort", onAbort);
        }
      }

      throw lastError;
    },
  };
};

export * from "./backoff.js";

export default recilience;
