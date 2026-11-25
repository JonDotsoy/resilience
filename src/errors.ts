/** Se lanza cuando el circuit breaker está abierto y rechaza la llamada. */
export class CircuitOpenError extends Error {
  override name = "CircuitOpenError";
  constructor(message = "Circuit breaker is open") {
    super(message);
  }
}

/** Se lanza cuando el bulkhead no tiene cupo ni espacio en la cola. */
export class BulkheadRejectedError extends Error {
  override name = "BulkheadRejectedError";
  constructor(message = "Bulkhead capacity exceeded") {
    super(message);
  }
}

/** Se lanza cuando se supera el límite de llamadas del throttle. */
export class ThrottleError extends Error {
  override name = "ThrottleError";
  constructor(
    /** Milisegundos hasta que se libera un cupo. */
    readonly retryAfter: number,
    message = `Rate limit exceeded, retry after ${retryAfter} ms`,
  ) {
    super(message);
  }
}
