import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import {
  BulkheadRejectedError,
  CircuitOpenError,
  ThrottleError,
  bulkhead,
  cache,
  circuitBreaker,
  dedupe,
  fallback,
  resilience,
  throttle,
} from "./index.js";

const fail = (msg = "boom") => () => {
  throw new Error(msg);
};

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => setSystemTime());

describe("fallback", () => {
  test("devuelve el resultado si no falla", async () => {
    expect(await fallback(() => 1, () => 2)).toBe(1);
  });

  test("usa el handler con el error si falla", async () => {
    const handler = mock((e: unknown) => (e as Error).message);
    expect(await fallback(fail("x"), handler)).toBe("x");
  });

  test("se combina con resilience", async () => {
    const fn = mock(fail());
    const result = await fallback(
      () => resilience({ attempts: 3 }).attempt(fn),
      () => "default",
    );
    expect(result).toBe("default");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("circuitBreaker", () => {
  test("se abre tras failureThreshold fallos seguidos y rechaza rápido", async () => {
    const onStateChange = mock(() => {});
    const breaker = circuitBreaker({ failureThreshold: 2, onStateChange });
    await expect(breaker.execute(fail())).rejects.toThrow("boom");
    expect(breaker.state).toBe("closed");
    await expect(breaker.execute(fail())).rejects.toThrow("boom");
    expect(breaker.state).toBe("open");
    expect(onStateChange).toHaveBeenCalledWith("open", "closed");

    const fn = mock(() => 1);
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  test("un éxito reinicia el contador de fallos", async () => {
    const breaker = circuitBreaker({ failureThreshold: 2 });
    await expect(breaker.execute(fail())).rejects.toThrow();
    await breaker.execute(() => 1);
    await expect(breaker.execute(fail())).rejects.toThrow();
    expect(breaker.state).toBe("closed");
  });

  test("pasa a half-open tras resetTimeout y se cierra con un éxito", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const breaker = circuitBreaker({ failureThreshold: 1, resetTimeout: 1_000 });
    await expect(breaker.execute(fail())).rejects.toThrow();
    expect(breaker.state).toBe("open");
    setSystemTime(new Date("2026-01-01T00:00:01Z"));
    expect(breaker.state).toBe("half-open");
    expect(await breaker.execute(() => "ok")).toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  test("en half-open un fallo vuelve a abrir", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const breaker = circuitBreaker({ failureThreshold: 1, resetTimeout: 1_000 });
    await expect(breaker.execute(fail())).rejects.toThrow();
    setSystemTime(new Date("2026-01-01T00:00:01Z"));
    await expect(breaker.execute(fail())).rejects.toThrow("boom");
    expect(breaker.state).toBe("open");
  });

  test("en half-open solo deja pasar una prueba a la vez", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const breaker = circuitBreaker({ failureThreshold: 1, resetTimeout: 1_000 });
    await expect(breaker.execute(fail())).rejects.toThrow();
    setSystemTime(new Date("2026-01-01T00:00:01Z"));
    const d = deferred<string>();
    const probe = breaker.execute(() => d.promise);
    await expect(breaker.execute(() => "otra")).rejects.toBeInstanceOf(CircuitOpenError);
    d.resolve("ok");
    expect(await probe).toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  test("isFailure permite ignorar errores", async () => {
    const breaker = circuitBreaker({
      failureThreshold: 1,
      isFailure: (e) => (e as Error).message !== "404",
    });
    await expect(breaker.execute(fail("404"))).rejects.toThrow("404");
    expect(breaker.state).toBe("closed");
  });

  test("reset vuelve a closed", async () => {
    const breaker = circuitBreaker({ failureThreshold: 1 });
    await expect(breaker.execute(fail())).rejects.toThrow();
    breaker.reset();
    expect(breaker.state).toBe("closed");
  });
});

describe("bulkhead", () => {
  test("limita la concurrencia y rechaza sin cola", async () => {
    const b = bulkhead({ maxConcurrent: 1 });
    const d = deferred();
    const first = b.execute(() => d.promise);
    expect(b.running).toBe(1);
    await expect(b.execute(() => 1)).rejects.toBeInstanceOf(BulkheadRejectedError);
    d.resolve();
    await first;
    expect(b.running).toBe(0);
    expect(await b.execute(() => 2)).toBe(2);
  });

  test("encola hasta maxQueue y ejecuta en orden", async () => {
    const b = bulkhead({ maxConcurrent: 1, maxQueue: 2 });
    const order: number[] = [];
    const d = deferred();
    const p1 = b.execute(async () => {
      await d.promise;
      order.push(1);
    });
    const p2 = b.execute(() => void order.push(2));
    const p3 = b.execute(() => void order.push(3));
    expect(b.queued).toBe(2);
    await expect(b.execute(() => 4)).rejects.toBeInstanceOf(BulkheadRejectedError);
    d.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  test("libera el cupo aunque la función falle", async () => {
    const b = bulkhead({ maxConcurrent: 1 });
    await expect(b.execute(fail())).rejects.toThrow();
    expect(b.running).toBe(0);
  });

  test("abortar saca la llamada de la cola", async () => {
    const b = bulkhead({ maxConcurrent: 1, maxQueue: 1 });
    const d = deferred();
    const first = b.execute(() => d.promise);
    const ac = new AbortController();
    const fn = mock(() => 1);
    const queued = b.execute(fn, { signal: ac.signal });
    ac.abort(new Error("cancelado"));
    await expect(queued).rejects.toThrow("cancelado");
    expect(b.queued).toBe(0);
    d.resolve();
    await first;
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("throttle", () => {
  test("permite limit llamadas por interval", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const t = throttle({ limit: 2, interval: 1_000 });
    await t.execute(() => 1);
    setSystemTime(new Date("2026-01-01T00:00:00.400Z"));
    await t.execute(() => 2);
    expect(t.remaining).toBe(0);
    const error = await t.execute(() => 3).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ThrottleError);
    expect((error as ThrottleError).retryAfter).toBe(600);

    setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    expect(t.remaining).toBe(1);
    expect(await t.execute(() => 4)).toBe(4);
  });
});

describe("cache", () => {
  test("guarda el valor durante ttl", async () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const c = cache({ ttl: 1_000 });
    const fn = mock(() => Math.random());
    const a = await c.execute("k", fn);
    expect(await c.execute("k", fn)).toBe(a);
    expect(fn).toHaveBeenCalledTimes(1);

    setSystemTime(new Date("2026-01-01T00:00:01Z"));
    expect(await c.execute("k", fn)).not.toBe(a);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("no guarda errores", async () => {
    const c = cache({ ttl: 1_000 });
    await expect(c.execute("k", fail())).rejects.toThrow();
    expect(await c.execute("k", () => 1)).toBe(1);
  });

  test("maxSize elimina la entrada más antigua", async () => {
    const c = cache({ ttl: 10_000, maxSize: 2 });
    await c.execute("a", () => 1);
    await c.execute("b", () => 2);
    await c.execute("c", () => 3);
    expect(c.size).toBe(2);
    const fn = mock(() => 10);
    expect(await c.execute("a", fn)).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("delete y clear", async () => {
    const c = cache({ ttl: 10_000 });
    await c.execute("a", () => 1);
    await c.execute("b", () => 2);
    expect(c.delete("a")).toBe(true);
    expect(c.size).toBe(1);
    c.clear();
    expect(c.size).toBe(0);
  });
});

describe("dedupe", () => {
  test("comparte la llamada en curso con la misma key", async () => {
    const dd = dedupe();
    const d = deferred<number>();
    const fn = mock(() => d.promise);
    const p1 = dd.execute("k", fn);
    const p2 = dd.execute("k", fn);
    expect(dd.pending).toBe(1);
    d.resolve(7);
    expect(await Promise.all([p1, p2])).toEqual([7, 7]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(dd.pending).toBe(0);
  });

  test("keys distintas se ejecutan por separado y tras terminar se vuelve a ejecutar", async () => {
    const dd = dedupe();
    const fn = mock(() => 1);
    await Promise.all([dd.execute("a", fn), dd.execute("b", fn)]);
    await dd.execute("a", fn);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("libera la key si falla", async () => {
    const dd = dedupe();
    await expect(dd.execute("k", fail())).rejects.toThrow();
    expect(dd.pending).toBe(0);
  });
});

describe("composición", () => {
  test("breaker + resilience + bulkhead", async () => {
    const breaker = circuitBreaker({ failureThreshold: 1 });
    const pool = bulkhead({ maxConcurrent: 2 });
    const fn = mock(fail());
    const call = () =>
      breaker.execute(() =>
        resilience({ attempts: 2 }).attempt(() => pool.execute(fn)),
      );
    await expect(call()).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(call()).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
