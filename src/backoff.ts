import type { DelayContext } from "./index.js";

/**
 * Jitter para repartir los reintentos en el tiempo:
 * - `"full"`: un valor al azar entre 0 y el delay calculado.
 * - `"equal"`: la mitad del delay más un valor al azar hasta la otra mitad.
 */
export type Jitter = "full" | "equal";

export interface BackoffOptions {
  /** Delay máximo en ms. Por defecto sin límite. */
  maxDelay?: number;
  /** Aplica jitter al delay calculado. Por defecto sin jitter. */
  jitter?: Jitter;
}

export interface ExponentialBackoffOptions extends BackoffOptions {
  /** Multiplicador entre un reintento y el siguiente. Por defecto `2`. */
  factor?: number;
}

/** Función compatible con la opción `delay`. */
export type DelayFn = (context: DelayContext) => number;

const make =
  (
    compute: (retry: number) => number,
    { maxDelay = Infinity, jitter }: BackoffOptions,
  ): DelayFn =>
  ({ attempt }) => {
    // `attempt` del contexto empieza en 2; `retry` empieza en 1.
    const base = Math.min(compute(attempt - 1), maxDelay);
    if (jitter === "full") return Math.random() * base;
    if (jitter === "equal") return base / 2 + Math.random() * (base / 2);
    return base;
  };

/** Siempre el mismo delay: `ms`, `ms`, `ms`, ... */
export const fixedBackoff = (ms: number, options: BackoffOptions = {}): DelayFn =>
  make(() => ms, options);

/** Crece de forma lineal: `ms`, `2ms`, `3ms`, ... */
export const linearBackoff = (ms: number, options: BackoffOptions = {}): DelayFn =>
  make((retry) => ms * retry, options);

/** Crece de forma exponencial: `ms`, `ms·factor`, `ms·factor²`, ... */
export const exponentialBackoff = (
  ms: number,
  { factor = 2, ...options }: ExponentialBackoffOptions = {},
): DelayFn => make((retry) => ms * factor ** (retry - 1), options);

/** Sigue la serie de Fibonacci: `ms`, `ms`, `2ms`, `3ms`, `5ms`, ... */
export const fibonacciBackoff = (ms: number, options: BackoffOptions = {}): DelayFn =>
  make((retry) => {
    let [a, b] = [1, 1];
    for (let i = 1; i < retry; i++) [a, b] = [b, a + b];
    return ms * a;
  }, options);
