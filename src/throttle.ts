import { ThrottleError } from "./errors.js";

export interface ThrottleOptions {
  /** Máximo de llamadas permitidas dentro de `interval`. */
  limit: number;
  /** Ventana de tiempo en ms. */
  interval: number;
}

export interface Throttle {
  /** Cupos disponibles en este momento. */
  readonly remaining: number;
  /** Ejecuta `fn` si hay cupo; si no, lanza `ThrottleError` con `retryAfter`. */
  execute<T>(fn: () => T | Promise<T>): Promise<T>;
}

/** Limita cuántas llamadas se hacen en una ventana de tiempo (ventana deslizante). */
export const throttle = ({ limit, interval }: ThrottleOptions): Throttle => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be an integer >= 1, received ${limit}`);
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError(`interval must be a finite number > 0, received ${interval}`);
  }

  const calls: number[] = [];
  const prune = (now: number) => {
    while (calls.length && now - calls[0]! >= interval) calls.shift();
  };

  return {
    get remaining() {
      prune(Date.now());
      return limit - calls.length;
    },
    async execute(fn) {
      const now = Date.now();
      prune(now);
      if (calls.length >= limit) {
        throw new ThrottleError(interval - (now - calls[0]!));
      }
      calls.push(now);
      return fn();
    },
  };
};
