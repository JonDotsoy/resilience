export interface Dedupe {
  /** Llamadas en curso. */
  readonly pending: number;
  /**
   * Si ya hay una llamada en curso con la misma `key`, devuelve su promesa en
   * vez de ejecutar `fn` otra vez.
   */
  execute<T>(key: string, fn: () => T | Promise<T>): Promise<T>;
}

/** Evita ejecutar en paralelo la misma llamada más de una vez. */
export const dedupe = (): Dedupe => {
  const inFlight = new Map<string, Promise<unknown>>();
  return {
    get pending() {
      return inFlight.size;
    },
    execute<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
      const current = inFlight.get(key);
      if (current) return current as Promise<T>;
      const value = Promise.resolve()
        .then(fn)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, value);
      return value;
    },
  };
};
