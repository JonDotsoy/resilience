import {
  exponentialBackoff,
  fibonacciBackoff,
  fixedBackoff,
  linearBackoff,
} from "./backoff.js";
import { circuitBreaker } from "./circuit-breaker.js";
import { bulkhead } from "./bulkhead.js";
import { throttle } from "./throttle.js";
import { cache } from "./cache.js";
import { dedupe } from "./dedupe.js";
import {
  BulkheadRejectedError,
  CircuitOpenError,
  ThrottleError,
} from "./errors.js";

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

export interface ResilienceOptions<F = never> extends LifecycleHooks<F> {
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
  /**
   * Qué hace `attempt` cuando se aborta `signal` o vence `timeout`:
   * - `true` (por defecto): aborta `control.signal` pero espera a la tarea, y
   *   entrega lo que la tarea devuelva o lance.
   * - `false`: rechaza en ese momento con el motivo del abort (`TimeoutError`
   *   para `timeout` y `AbortSignal.timeout()`), aunque la tarea siga
   *   corriendo.
   */
  waitForTask?: boolean;
  /**
   * Se llama cuando la ejecución falla definitivamente (se agotaron los
   * intentos o `retryable` devolvió `false`). Lo que devuelva pasa a ser el
   * resultado de `attempt`; si lanza un error, `attempt` rechaza con ese error.
   * No se llama cuando se aborta `signal`.
   */
  fallback?: (lastError: unknown, context: FallbackContext) => F | Promise<F>;
}

/** Contexto común que reciben los hooks del ciclo de vida. */
export interface LifecycleContext {
  /** Intento actual (o el último ejecutado). `0` si aún no empieza. */
  readonly attempt: number;
  /** Total de intentos permitidos. */
  readonly attempts: number;
}

/** Datos que recibe `onAttempt` antes de ejecutar cada intento. */
export interface AttemptEvent extends LifecycleContext {
  /** Error del intento anterior, si existe. */
  readonly lastError?: unknown;
}

/** Datos que recibe `onError` cuando falla un intento. */
export interface ErrorContext extends LifecycleContext {
  /** `true` si se va a reintentar después de este error. */
  readonly willRetry: boolean;
}

/** Datos que recibe `onTimeout` cuando vence el timeout de un intento. */
export interface TimeoutEvent extends LifecycleContext {
  /** Timeout configurado en ms. */
  readonly timeout: number;
}

/** Resultado final que recibe `onSettled`. */
export type SettledEvent<T = unknown, F = unknown> = LifecycleContext &
  (
    | { readonly status: "success"; readonly value: T }
    | { readonly status: "fallback"; readonly error: unknown; readonly value: F }
    | { readonly status: "failure"; readonly error: unknown }
    | { readonly status: "aborted"; readonly error: unknown }
  );

type Hook<A extends unknown[]> = (...args: A) => void | Promise<void>;

/**
 * Hooks del ciclo de vida, en orden:
 * `onStart` → (`onAttempt` → `onTimeout`? → `onError`? → `onRetry`?)×N →
 * `onSuccess` | `onFailure` | `onAbort` → `onSettled`.
 *
 * Todos se esperan si devuelven una promesa. Si un hook lanza, `attempt`
 * rechaza con ese error.
 */
export interface LifecycleHooks<F = never> {
  /** Antes del primer intento. */
  onStart?: Hook<[context: LifecycleContext]>;
  /** Antes de ejecutar cada intento (incluido el primero). */
  onAttempt?: Hook<[event: AttemptEvent]>;
  /** Cuando vence el `timeout` de un intento (antes de `onError`). */
  onTimeout?: Hook<[event: TimeoutEvent]>;
  /** Cada vez que un intento falla. */
  onError?: Hook<[error: unknown, context: ErrorContext]>;
  /** Cuando un intento termina bien. */
  onSuccess?: Hook<[value: unknown, context: LifecycleContext]>;
  /** Cuando la ejecución falla definitivamente (antes de `fallback`). */
  onFailure?: Hook<[error: unknown, context: LifecycleContext]>;
  /** Cuando se aborta `signal`. */
  onAbort?: Hook<[reason: unknown, context: LifecycleContext]>;
  /** Siempre al final, con el resultado. */
  onSettled?: Hook<[event: SettledEvent<unknown, F>]>;
}

/** Datos que recibe `fallback`. */
export interface FallbackContext {
  /** Intentos que se alcanzaron a ejecutar. */
  readonly attempt: number;
  /** Total de intentos permitidos. */
  readonly attempts: number;
}

/** Datos que recibe `retryable`. */
export interface RetryableContext {
  /** Número del intento que acaba de fallar. */
  readonly attempt: number;
  /** Total de intentos permitidos. */
  readonly attempts: number;
}

export interface Resilience<F = never> {
  attempt<T>(fn: (control: Control) => T | Promise<T>): Promise<T | F>;
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
 * const res = await resilience({ attempts: 3 }).attempt(({ signal }) =>
 *   fetch("https://example.com", { signal }),
 * );
 */
const createResilience = <F = never>(
  options: ResilienceOptions<F> = {},
): Resilience<F> => {
  const attempts = options.attempts ?? 1;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(
      `options.attempts must be an integer >= 1, received ${attempts}`,
    );
  }
  const {
    signal: parentSignal,
    onRetry,
    retryable,
    timeout,
    fallback,
    delay = 0,
    waitForTask = true,
    onStart,
    onAttempt,
    onTimeout,
    onError,
    onSuccess,
    onFailure,
    onAbort: onAbortHook,
    onSettled,
  } = options;
  if (typeof delay === "number") assertDelay(delay);
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new RangeError(
      `options.timeout must be a finite number > 0, received ${timeout}`,
    );
  }

  const run = async <T>(
    fn: (control: Control) => T | Promise<T>,
    progress: { attempt: number },
  ): Promise<T> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      progress.attempt = attempt;
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
      let timedOut = false;

      try {
        await onAttempt?.({ attempt, attempts, lastError });
        const run = Promise.resolve().then(() =>
          fn({ signal: controller.signal, attempt, attempts, lastError }),
        );
        if (timeout !== undefined) {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort(timeoutError(timeout));
          }, timeout);
        }

        // La tarea decide cuándo termina: se devuelve lo que ella devuelva.
        if (waitForTask) return await run;

        // Si se aborta (signal o timeout) se rechaza en ese momento; la
        // promesa de la tarea puede rechazar después.
        run.catch(() => {});
        return await Promise.race([
          run,
          new Promise<never>((_, reject) => {
            const reject_ = () => reject(controller.signal.reason);
            if (controller.signal.aborted) return reject_();
            controller.signal.addEventListener("abort", reject_, { once: true });
          }),
        ]);
      } catch (error) {
        // Si se canceló desde afuera, no se reintenta.
        if (parentSignal?.aborted) {
          throw waitForTask ? error : abortReason(parentSignal);
        }
        if (timedOut) await onTimeout?.({ attempt, attempts, timeout: timeout! });
        const willRetry =
          attempt < attempts &&
          (!retryable || (await retryable(error, { attempt, attempts })));
        await onError?.(error, { attempt, attempts, willRetry });
        if (!willRetry) throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
        // No se aborta el controller al terminar: un `fetch` resuelto aún
        // puede estar leyendo el body con ese signal.
        parentSignal?.removeEventListener("abort", onAbort);
      }
    }

    throw lastError;
  };

  return {
    async attempt<T>(fn: (control: Control) => T | Promise<T>): Promise<T | F> {
      const progress = { attempt: 0 };
      const context = (): LifecycleContext => ({
        attempt: progress.attempt,
        attempts,
      });

      await onStart?.(context());

      let value: T;
      try {
        value = await run(fn, progress);
      } catch (error) {
        // Cancelar no es un fallo: no se usa el fallback.
        if (parentSignal?.aborted) {
          await onAbortHook?.(error, context());
          await onSettled?.({ status: "aborted", error, ...context() });
          throw error;
        }
        await onFailure?.(error, context());
        if (!fallback) {
          await onSettled?.({ status: "failure", error, ...context() });
          throw error;
        }
        const recovered = await fallback(error, context());
        await onSettled?.({
          status: "fallback",
          error,
          value: recovered,
          ...context(),
        });
        return recovered;
      }

      await onSuccess?.(value, context());
      await onSettled?.({ status: "success", value, ...context() });
      return value;
    },
  };
};

/**
 * Crea un ejecutor con reintentos. Las utilidades también están disponibles
 * como propiedades, por ejemplo `resilience.exponentialBackoff(200)`.
 *
 * @example
 * const res = await resilience({
 *   attempts: 3,
 *   delay: resilience.exponentialBackoff(200),
 * }).attempt(({ signal }) => fetch("https://example.com", { signal }));
 */
export const resilience = Object.assign(createResilience, {
  fixedBackoff,
  linearBackoff,
  exponentialBackoff,
  fibonacciBackoff,
  circuitBreaker,
  bulkhead,
  throttle,
  cache,
  dedupe,
  CircuitOpenError,
  BulkheadRejectedError,
  ThrottleError,
});

export * from "./backoff.js";
export * from "./errors.js";
export * from "./circuit-breaker.js";
export * from "./bulkhead.js";
export * from "./throttle.js";
export * from "./cache.js";
export * from "./dedupe.js";

export default resilience;
