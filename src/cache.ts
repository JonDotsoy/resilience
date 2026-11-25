export interface CacheOptions {
  /** Tiempo de vida de cada entrada en ms. */
  ttl: number;
  /** Máximo de entradas; al superarlo se elimina la más antigua. Por defecto sin límite. */
  maxSize?: number;
}

export interface Cache {
  /** Entradas guardadas. */
  readonly size: number;
  /**
   * Devuelve el valor guardado para `key` si no expiró; si no, ejecuta `fn` y
   * lo guarda. Los errores no se guardan. Llamadas simultáneas con la misma
   * `key` comparten la misma ejecución.
   */
  execute<T>(key: string, fn: () => T | Promise<T>): Promise<T>;
  /** Elimina una entrada. */
  delete(key: string): boolean;
  /** Elimina todas las entradas. */
  clear(): void;
}

/** Guarda en memoria el resultado de una llamada por un tiempo. */
export const cache = ({ ttl, maxSize = Infinity }: CacheOptions): Cache => {
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new RangeError(`ttl must be a finite number > 0, received ${ttl}`);
  }
  if (maxSize !== Infinity && (!Number.isInteger(maxSize) || maxSize < 1)) {
    throw new RangeError(`maxSize must be an integer >= 1, received ${maxSize}`);
  }

  const store = new Map<string, { value: Promise<unknown>; expiresAt: number }>();

  return {
    get size() {
      return store.size;
    },
    delete: (key) => store.delete(key),
    clear: () => store.clear(),
    execute<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
      const hit = store.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value as Promise<T>;
      if (hit) store.delete(key);

      const value = Promise.resolve().then(fn);
      const entry = { value, expiresAt: Date.now() + ttl };
      store.set(key, entry);
      if (store.size > maxSize) store.delete(store.keys().next().value!);

      value.then(
        () => {
          // El ttl corre desde que llega el valor.
          if (store.get(key) === entry) entry.expiresAt = Date.now() + ttl;
        },
        () => {
          if (store.get(key) === entry) store.delete(key);
        },
      );
      return value;
    },
  };
};
