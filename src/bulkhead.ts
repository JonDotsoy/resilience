import { BulkheadRejectedError } from "./errors.js";

export interface BulkheadOptions {
  /** Máximo de ejecuciones en paralelo. */
  maxConcurrent: number;
  /** Máximo de llamadas esperando turno. Por defecto `0` (sin cola). */
  maxQueue?: number;
}

export interface BulkheadExecuteOptions {
  /** Cancela la espera en la cola. */
  signal?: AbortSignal;
}

export interface Bulkhead {
  /** Ejecuciones en curso. */
  readonly running: number;
  /** Llamadas esperando en la cola. */
  readonly queued: number;
  /**
   * Ejecuta `fn` cuando haya cupo. Si no hay cupo ni espacio en la cola,
   * lanza `BulkheadRejectedError`.
   */
  execute<T>(fn: () => T | Promise<T>, options?: BulkheadExecuteOptions): Promise<T>;
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("This operation was aborted", "AbortError");

/** Limita cuántas llamadas se ejecutan a la vez. */
export const bulkhead = ({ maxConcurrent, maxQueue = 0 }: BulkheadOptions): Bulkhead => {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new RangeError(`maxConcurrent must be an integer >= 1, received ${maxConcurrent}`);
  }
  if (!Number.isInteger(maxQueue) || maxQueue < 0) {
    throw new RangeError(`maxQueue must be an integer >= 0, received ${maxQueue}`);
  }

  let running = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    running--;
    queue.shift()?.();
  };

  const acquire = (signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (running < maxConcurrent) {
      running++;
      return Promise.resolve();
    }
    if (queue.length >= maxQueue) return Promise.reject(new BulkheadRejectedError());

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const i = queue.indexOf(next);
        if (i !== -1) queue.splice(i, 1);
        reject(abortReason(signal!));
      };
      const next = () => {
        signal?.removeEventListener("abort", onAbort);
        running++;
        resolve();
      };
      queue.push(next);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  return {
    get running() {
      return running;
    },
    get queued() {
      return queue.length;
    },
    async execute(fn, options = {}) {
      await acquire(options.signal);
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
};
