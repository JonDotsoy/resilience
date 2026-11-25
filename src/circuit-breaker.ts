import { CircuitOpenError } from "./errors.js";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Fallos seguidos que abren el circuito. Por defecto `5`. */
  failureThreshold?: number;
  /** Ms que el circuito queda abierto antes de probar de nuevo. Por defecto `30_000`. */
  resetTimeout?: number;
  /** Éxitos seguidos en half-open para volver a cerrar. Por defecto `1`. */
  successThreshold?: number;
  /** Decide si un error cuenta como fallo. Por defecto todos cuentan. */
  isFailure?: (error: unknown) => boolean;
  /** Se llama cada vez que cambia el estado. */
  onStateChange?: (state: CircuitState, previous: CircuitState) => void;
}

export interface CircuitBreaker {
  /** Estado actual: `closed` (normal), `open` (rechaza) o `half-open` (probando). */
  readonly state: CircuitState;
  /** Ejecuta `fn` si el circuito lo permite; si está abierto lanza `CircuitOpenError`. */
  execute<T>(fn: () => T | Promise<T>): Promise<T>;
  /** Vuelve a `closed` y limpia los contadores. */
  reset(): void;
}

const positiveInt = (name: string, value: number) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer >= 1, received ${value}`);
  }
};

/**
 * Corta las llamadas a un servicio que está fallando para no saturarlo y
 * fallar rápido. Crea uno por servicio y reutilízalo entre llamadas.
 */
export const circuitBreaker = (
  options: CircuitBreakerOptions = {},
): CircuitBreaker => {
  const {
    failureThreshold = 5,
    resetTimeout = 30_000,
    successThreshold = 1,
    isFailure = () => true,
    onStateChange,
  } = options;
  positiveInt("failureThreshold", failureThreshold);
  positiveInt("successThreshold", successThreshold);
  if (!Number.isFinite(resetTimeout) || resetTimeout < 0) {
    throw new RangeError(`resetTimeout must be a finite number >= 0, received ${resetTimeout}`);
  }

  let state: CircuitState = "closed";
  let failures = 0;
  let successes = 0;
  let openedAt = 0;
  let probing = false;

  const transition = (next: CircuitState) => {
    if (next === state) return;
    const previous = state;
    state = next;
    failures = 0;
    successes = 0;
    probing = false;
    if (next === "open") openedAt = Date.now();
    onStateChange?.(next, previous);
  };

  const currentState = (): CircuitState => {
    if (state === "open" && Date.now() - openedAt >= resetTimeout) {
      transition("half-open");
    }
    return state;
  };

  return {
    get state() {
      return currentState();
    },
    reset() {
      transition("closed");
    },
    async execute<T>(fn: () => T | Promise<T>): Promise<T> {
      const s = currentState();
      if (s === "open" || (s === "half-open" && probing)) {
        throw new CircuitOpenError();
      }
      if (s === "half-open") probing = true;

      try {
        const result = await fn();
        if (state === "half-open") {
          probing = false;
          if (++successes >= successThreshold) transition("closed");
        } else {
          failures = 0;
        }
        return result;
      } catch (error) {
        if (!isFailure(error)) {
          if (state === "half-open") probing = false;
          throw error;
        }
        if (state === "half-open") transition("open");
        else if (state === "closed" && ++failures >= failureThreshold) transition("open");
        throw error;
      }
    },
  };
};
