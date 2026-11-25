import { describe, expect, mock, test } from "bun:test";
import { exponentialBackoff, resilience, type RetryEvent } from "./index.js";

describe("resilience", () => {
  test("devuelve el valor de la función", async () => {
    expect(await resilience().attempt(() => 42)).toBe(42);
    expect(await resilience().attempt(async () => "ok")).toBe("ok");
  });

  test("por defecto hace 1 intento", async () => {
    const fn = mock(() => {
      throw new Error("boom");
    });
    await expect(resilience().attempt(fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("reintenta hasta `attempts` y rechaza con el último error", async () => {
    let n = 0;
    const fn = mock(() => {
      n++;
      throw new Error(`fallo ${n}`);
    });
    await expect(resilience({ attempts: 3 }).attempt(fn)).rejects.toThrow("fallo 3");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("se detiene en el primer intento exitoso", async () => {
    const fn = mock(async ({ attempt }: { attempt: number }) => {
      if (attempt < 2) throw new Error("todavía no");
      return attempt;
    });
    expect(await resilience({ attempts: 5 }).attempt(fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("control expone attempt, attempts, signal y lastError", async () => {
    const seen: Array<{ attempt: number; attempts: number; lastError: unknown }> = [];
    const err = new Error("x");
    await resilience({ attempts: 2 }).attempt((control) => {
      expect(control.signal).toBeInstanceOf(AbortSignal);
      seen.push({
        attempt: control.attempt,
        attempts: control.attempts,
        lastError: control.lastError,
      });
      if (control.attempt === 1) throw err;
    });
    expect(seen).toEqual([
      { attempt: 1, attempts: 2, lastError: undefined },
      { attempt: 2, attempts: 2, lastError: err },
    ]);
  });

  test("onRetry se llama antes de cada reejecución", async () => {
    const events: RetryEvent[] = [];
    const errors = [new Error("a"), new Error("b")];
    await resilience({ attempts: 3, onRetry: (e) => void events.push(e) }).attempt(
      ({ attempt }) => {
        if (attempt <= 2) throw errors[attempt - 1];
        return "ok";
      },
    );
    expect(events).toEqual([
      { attempt: 2, attempts: 3, error: errors[0], delay: 0 },
      { attempt: 3, attempts: 3, error: errors[1], delay: 0 },
    ]);
  });

  test("onRetry no se llama si el primer intento funciona", async () => {
    const onRetry = mock(() => {});
    await resilience({ attempts: 3, onRetry }).attempt(() => 1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  test("onRetry asíncrono se espera antes de reintentar", async () => {
    const order: string[] = [];
    await resilience({
      attempts: 2,
      onRetry: async () => {
        await Bun.sleep(5);
        order.push("onRetry");
      },
    }).attempt(({ attempt }) => {
      order.push(`run ${attempt}`);
      if (attempt === 1) throw new Error();
    });
    expect(order).toEqual(["run 1", "onRetry", "run 2"]);
  });

  test("rechaza sin ejecutar si el signal ya está abortado", async () => {
    const ac = new AbortController();
    ac.abort(new Error("cancelado"));
    const fn = mock(() => 1);
    await expect(resilience({ signal: ac.signal }).attempt(fn)).rejects.toThrow("cancelado");
    expect(fn).not.toHaveBeenCalled();
  });

  test("abortar propaga al signal del control y no reintenta", async () => {
    const ac = new AbortController();
    const fn = mock(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
          setTimeout(() => ac.abort(new Error("cancelado")), 5);
        }),
    );
    await expect(
      resilience({ attempts: 5, signal: ac.signal }).attempt(fn),
    ).rejects.toThrow("cancelado");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("abortar durante onRetry evita el siguiente intento", async () => {
    const ac = new AbortController();
    const fn = mock(() => {
      throw new Error("falla");
    });
    await expect(
      resilience({
        attempts: 3,
        signal: ac.signal,
        onRetry: () => ac.abort(new Error("cancelado")),
      }).attempt(fn),
    ).rejects.toThrow("cancelado");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("funciona con fetch pasando el signal", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("hola") });
    try {
      let calls = 0;
      const text = await resilience({ attempts: 2 }).attempt(async ({ signal }) => {
        calls++;
        if (calls === 1) throw new Error("red caída");
        const res = await fetch(server.url, { signal });
        return res.text();
      });
      expect(text).toBe("hola");
    } finally {
      server.stop(true);
    }
  });

  test("delay espera los ms indicados entre intentos", async () => {
    const times: number[] = [];
    await resilience({ attempts: 3, delay: 30 }).attempt(({ attempt }) => {
      times.push(performance.now());
      if (attempt < 3) throw new Error();
    });
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(25);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(25);
  });

  test("delay no espera antes del primer intento", async () => {
    const start = performance.now();
    await resilience({ attempts: 3, delay: 200 }).attempt(() => 1);
    expect(performance.now() - start).toBeLessThan(100);
  });

  test("delay como función recibe el contexto y onRetry recibe el valor", async () => {
    const delay = mock(({ attempt }: { attempt: number }) => attempt * 5);
    const events: RetryEvent[] = [];
    await resilience({
      attempts: 3,
      delay,
      onRetry: (e) => void events.push(e),
    }).attempt(({ attempt }) => {
      if (attempt < 3) throw new Error(`e${attempt}`);
    });
    expect(delay).toHaveBeenCalledTimes(2);
    expect(events.map((e) => [e.attempt, e.delay])).toEqual([
      [2, 10],
      [3, 15],
    ]);
  });

  test("abortar durante el delay rechaza de inmediato", async () => {
    const ac = new AbortController();
    const fn = mock(() => {
      throw new Error("falla");
    });
    setTimeout(() => ac.abort(new Error("cancelado")), 10);
    const start = performance.now();
    await expect(
      resilience({ attempts: 3, delay: 5_000, signal: ac.signal }).attempt(fn),
    ).rejects.toThrow("cancelado");
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("valida delay", async () => {
    expect(() => resilience({ delay: -1 })).toThrow(RangeError);
    expect(() => resilience({ delay: Number.NaN })).toThrow(RangeError);
    await expect(
      resilience({ attempts: 2, delay: () => -5 }).attempt(() => {
        throw new Error("x");
      }),
    ).rejects.toThrow(RangeError);
  });

  test("retryable false rechaza sin reintentar", async () => {
    const fatal = new Error("401");
    const fn = mock(() => {
      throw fatal;
    });
    const retryable = mock((error: unknown) => error !== fatal);
    await expect(
      resilience({ attempts: 5, retryable }).attempt(fn),
    ).rejects.toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(retryable).toHaveBeenCalledWith(fatal, { attempt: 1, attempts: 5 });
  });

  test("retryable false: el error de attempt se captura con try/catch", async () => {
    class HttpError extends Error {
      constructor(public status: number) {
        super(`HTTP ${status}`);
      }
    }
    const original = new HttpError(401);
    const fn = mock(() => {
      throw original;
    });

    let caught: unknown;
    try {
      await resilience({ attempts: 3, retryable: () => false }).attempt(fn);
      throw new Error("no debería llegar aquí");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(401);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retryable true sigue reintentando y puede ser async", async () => {
    const fn = mock(({ attempt }: { attempt: number }) => {
      if (attempt < 3) throw new Error("503");
      return "ok";
    });
    const result = await resilience({
      attempts: 3,
      retryable: async () => true,
    }).attempt(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("retryable no se llama en el último intento", async () => {
    const retryable = mock(() => true);
    await expect(
      resilience({ attempts: 2, retryable }).attempt(() => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(retryable).toHaveBeenCalledTimes(1);
  });

  test("timeout aborta el signal del intento y falla con TimeoutError", async () => {
    let signal: AbortSignal | undefined;
    const error = await resilience({ timeout: 20 })
      .attempt((control) => {
        signal = control.signal;
        return new Promise(() => {});
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("TimeoutError");
    expect(signal?.aborted).toBe(true);
  });

  test("timeout dispara el evento abort en control.signal", async () => {
    const onAbort = mock((_event: Event) => {});
    let reason: unknown;
    await expect(
      resilience({ timeout: 20 }).attempt(({ signal }) => {
        signal.addEventListener("abort", (event) => {
          reason = signal.reason;
          onAbort(event);
        });
        return new Promise(() => {});
      }),
    ).rejects.toThrow();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0]![0].type).toBe("abort");
    expect(reason).toBeInstanceOf(DOMException);
    expect((reason as DOMException).name).toBe("TimeoutError");
  });

  test("timeout aborta un fetch lento mediante control.signal", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        await Bun.sleep(500);
        return new Response("tarde");
      },
    });
    try {
      const signals: AbortSignal[] = [];
      const start = performance.now();
      const error = await resilience({ attempts: 2, timeout: 50 })
        .attempt(async ({ signal }) => {
          signals.push(signal);
          const res = await fetch(server.url, { signal });
          return res.text();
        })
        .catch((e: unknown) => e);
      expect((error as DOMException).name).toBe("TimeoutError");
      expect(signals).toHaveLength(2);
      expect(signals.every((s) => s.aborted)).toBe(true);
      expect(performance.now() - start).toBeLessThan(400);
    } finally {
      server.stop(true);
    }
  });

  test("timeout se reintenta como cualquier otro fallo", async () => {
    const fn = mock(async ({ attempt }: { attempt: number }) => {
      if (attempt === 1) await Bun.sleep(100);
      return attempt;
    });
    expect(await resilience({ attempts: 2, timeout: 20 }).attempt(fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("timeout no afecta a un intento que termina a tiempo", async () => {
    let signal: AbortSignal | undefined;
    await resilience({ timeout: 20 }).attempt((control) => {
      signal = control.signal;
      return 1;
    });
    await Bun.sleep(40);
    expect(signal?.aborted).toBe(false);
  });

  test("delay acepta helpers de backoff", async () => {
    const events: RetryEvent[] = [];
    await resilience({
      attempts: 4,
      delay: exponentialBackoff(1),
      onRetry: (e) => void events.push(e),
    }).attempt(({ attempt }) => {
      if (attempt < 4) throw new Error();
    });
    expect(events.map((e) => e.delay)).toEqual([1, 2, 4]);
  });

  test("valida timeout", () => {
    expect(() => resilience({ timeout: 0 })).toThrow(RangeError);
    expect(() => resilience({ timeout: -1 })).toThrow(RangeError);
  });

  test("valida attempts", () => {
    expect(() => resilience({ attempts: 0 })).toThrow(RangeError);
    expect(() => resilience({ attempts: 1.5 })).toThrow(RangeError);
  });
});

describe("fallback", () => {
  test("no se llama si la función funciona", async () => {
    const fallback = mock(() => null);
    expect(await resilience({ fallback }).attempt(() => 1)).toBe(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  test("recibe el último error y su valor es el resultado de attempt", async () => {
    const errors = [new Error("e1"), new Error("e2"), new Error("e3")];
    const fallback = mock(async (_lastError: unknown) => null);
    const result = await resilience({ attempts: 3, fallback }).attempt(
      ({ attempt }) => {
        throw errors[attempt - 1];
      },
    );
    expect(result).toBeNull();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith(errors[2], { attempt: 3, attempts: 3 });
  });

  test("puede devolver el error como valor", async () => {
    const original = new Error("x");
    const result = await resilience({
      fallback: (lastError) => lastError as Error,
    }).attempt(() => {
      throw original;
    });
    expect(result).toBe(original);
  });

  test("si el fallback lanza, attempt rechaza con ese error", async () => {
    await expect(
      resilience({
        fallback: () => {
          throw new Error("desde fallback");
        },
      }).attempt(() => {
        throw new Error("original");
      }),
    ).rejects.toThrow("desde fallback");
  });

  test("se usa cuando retryable devuelve false", async () => {
    const fn = mock(() => {
      throw new Error("401");
    });
    const result = await resilience({
      attempts: 3,
      retryable: () => false,
      fallback: (_e, { attempt }) => `fallback tras ${attempt}`,
    }).attempt(fn);
    expect(result).toBe("fallback tras 1");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("se usa cuando vence el timeout de todos los intentos", async () => {
    const result = await resilience({
      attempts: 2,
      timeout: 10,
      fallback: (e) => (e as DOMException).name,
    }).attempt(() => new Promise(() => {}));
    expect(result).toBe("TimeoutError");
  });

  test("no se llama cuando se aborta el signal", async () => {
    const ac = new AbortController();
    const fallback = mock(() => null);
    setTimeout(() => ac.abort(new Error("cancelado")), 5);
    await expect(
      resilience({ signal: ac.signal, fallback }).attempt(
        ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          ),
      ),
    ).rejects.toThrow("cancelado");
    expect(fallback).not.toHaveBeenCalled();
  });

  test("el tipo del resultado incluye el del fallback", async () => {
    const result: number | null = await resilience({
      fallback: async () => null,
    }).attempt(() => 1);
    expect(result).toBe(1);
  });
});

describe("waitForTask", () => {
  // Tarea que ignora el signal y termina sola después de `ms`.
  const stubborn = (ms: number, value = "terminó") => async () => {
    await Bun.sleep(ms);
    return value;
  };

  test("por defecto, timeout rechaza en el momento con TimeoutError", async () => {
    const start = performance.now();
    const error = await resilience({ timeout: 20 })
      .attempt(stubborn(200))
      .catch((e: unknown) => e);
    expect((error as DOMException).name).toBe("TimeoutError");
    expect(performance.now() - start).toBeLessThan(150);
  });

  test("por defecto, abortar signal rechaza en el momento aunque la tarea ignore el signal", async () => {
    const start = performance.now();
    const error = await resilience({ signal: AbortSignal.timeout(20) })
      .attempt(stubborn(200))
      .catch((e: unknown) => e);
    expect((error as DOMException).name).toBe("TimeoutError");
    expect(performance.now() - start).toBeLessThan(150);
  });

  test("por defecto, un abort manual rechaza con su reason", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("cancelado")), 10);
    await expect(
      resilience({ signal: ac.signal }).attempt(stubborn(200)),
    ).rejects.toThrow("cancelado");
  });

  test("waitForTask con timeout: aborta control.signal pero entrega el resultado de la tarea", async () => {
    let signal: AbortSignal | undefined;
    const result = await resilience({ timeout: 20, waitForTask: true }).attempt(
      async (control) => {
        signal = control.signal;
        await Bun.sleep(60);
        return "terminó";
      },
    );
    expect(result).toBe("terminó");
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as DOMException).name).toBe("TimeoutError");
  });

  test("waitForTask con signal: espera a la tarea y entrega su resultado", async () => {
    const result = await resilience({
      signal: AbortSignal.timeout(20),
      waitForTask: true,
    }).attempt(stubborn(60));
    expect(result).toBe("terminó");
  });

  test("waitForTask: si la tarea lanza al abortar, attempt rechaza con ese error", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    await expect(
      resilience({ signal: ac.signal, waitForTask: true }).attempt(
        ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("la tarea se detuvo")),
            ),
          ),
      ),
    ).rejects.toThrow("la tarea se detuvo");
  });

  test("waitForTask con timeout: si la tarea lanza, se reintenta", async () => {
    const onTimeout = mock(() => {});
    const fn = mock(({ signal, attempt }: { signal: AbortSignal; attempt: number }) => {
      if (attempt === 2) return "ok";
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    });
    const result = await resilience({
      attempts: 2,
      timeout: 10,
      waitForTask: true,
      onTimeout,
    }).attempt(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});

describe("hooks del ciclo de vida", () => {
  const recorder = () => {
    const log: string[] = [];
    const hooks = {
      onStart: ({ attempt, attempts }: { attempt: number; attempts: number }) =>
        void log.push(`start ${attempt}/${attempts}`),
      onAttempt: ({ attempt }: { attempt: number }) => void log.push(`attempt ${attempt}`),
      onTimeout: ({ attempt, timeout }: { attempt: number; timeout: number }) =>
        void log.push(`timeout ${attempt} ${timeout}ms`),
      onError: (e: unknown, { attempt, willRetry }: { attempt: number; willRetry: boolean }) =>
        void log.push(`error ${attempt} ${(e as Error).message} retry=${willRetry}`),
      onRetry: ({ attempt }: { attempt: number }) => void log.push(`retry ${attempt}`),
      onSuccess: (v: unknown, { attempt }: { attempt: number }) =>
        void log.push(`success ${attempt} ${v}`),
      onFailure: (e: unknown, { attempt }: { attempt: number }) =>
        void log.push(`failure ${attempt} ${(e as Error).message}`),
      onAbort: (r: unknown) => void log.push(`abort ${(r as Error).message}`),
      onSettled: (e: { status: string; attempt: number }) =>
        void log.push(`settled ${e.status} ${e.attempt}`),
    };
    return { log, hooks };
  };

  test("orden en un éxito tras un reintento", async () => {
    const { log, hooks } = recorder();
    await resilience({ attempts: 3, ...hooks }).attempt(({ attempt }) => {
      if (attempt === 1) throw new Error("e1");
      return "ok";
    });
    expect(log).toEqual([
      "start 0/3",
      "attempt 1",
      "error 1 e1 retry=true",
      "retry 2",
      "attempt 2",
      "success 2 ok",
      "settled success 2",
    ]);
  });

  test("orden en un fallo definitivo", async () => {
    const { log, hooks } = recorder();
    await expect(
      resilience({ attempts: 2, ...hooks }).attempt(({ attempt }) => {
        throw new Error(`e${attempt}`);
      }),
    ).rejects.toThrow("e2");
    expect(log).toEqual([
      "start 0/2",
      "attempt 1",
      "error 1 e1 retry=true",
      "retry 2",
      "attempt 2",
      "error 2 e2 retry=false",
      "failure 2 e2",
      "settled failure 2",
    ]);
  });

  test("retryable false marca willRetry=false", async () => {
    const { log, hooks } = recorder();
    await expect(
      resilience({ attempts: 3, retryable: () => false, ...hooks }).attempt(() => {
        throw new Error("401");
      }),
    ).rejects.toThrow("401");
    expect(log).toContain("error 1 401 retry=false");
    expect(log).toContain("failure 1 401");
  });

  test("onTimeout se llama antes de onError", async () => {
    const { log, hooks } = recorder();
    await expect(
      resilience({ timeout: 10, ...hooks }).attempt(() => new Promise(() => {})),
    ).rejects.toThrow();
    expect(log.slice(1, 4)).toEqual([
      "attempt 1",
      "timeout 1 10ms",
      "error 1 The attempt timed out after 10 ms retry=false",
    ]);
  });

  test("con fallback, onSettled recibe status fallback y el valor", async () => {
    const settled = mock((_e: unknown) => {});
    const onFailure = mock(() => {});
    const result = await resilience({
      fallback: () => "default",
      onFailure,
      onSettled: settled,
    }).attempt(() => {
      throw new Error("x");
    });
    expect(result).toBe("default");
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(settled.mock.calls[0]![0]).toMatchObject({
      status: "fallback",
      value: "default",
      attempt: 1,
      attempts: 1,
    });
  });

  test("al abortar se llama onAbort y onSettled aborted, no onFailure", async () => {
    const { log, hooks } = recorder();
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("cancelado")), 5);
    await expect(
      resilience({ signal: ac.signal, ...hooks }).attempt(
        ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason)),
          ),
      ),
    ).rejects.toThrow("cancelado");
    expect(log).toEqual([
      "start 0/1",
      "attempt 1",
      "abort cancelado",
      "settled aborted 1",
    ]);
  });

  test("los hooks async se esperan", async () => {
    const log: string[] = [];
    await resilience({
      onStart: async () => {
        await Bun.sleep(5);
        log.push("start");
      },
      onSuccess: async () => {
        await Bun.sleep(5);
        log.push("success");
      },
    }).attempt(() => void log.push("run"));
    expect(log).toEqual(["start", "run", "success"]);
  });

  test("si un hook lanza, attempt rechaza con ese error", async () => {
    await expect(
      resilience({
        onStart: () => {
          throw new Error("hook");
        },
      }).attempt(() => 1),
    ).rejects.toThrow("hook");
  });
});

describe("utilidades en resilience.*", () => {
  test("los helpers están disponibles como propiedades", () => {
    expect(resilience.exponentialBackoff).toBe(exponentialBackoff);
    for (const name of [
      "fixedBackoff",
      "linearBackoff",
      "exponentialBackoff",
      "fibonacciBackoff",
      "circuitBreaker",
      "bulkhead",
      "throttle",
      "cache",
      "dedupe",
      "CircuitOpenError",
      "BulkheadRejectedError",
      "ThrottleError",
    ] as const) {
      expect(typeof resilience[name]).toBe("function");
    }
  });

  test("resilience.exponentialBackoff se usa en delay", async () => {
    const delays: number[] = [];
    await resilience({
      attempts: 3,
      delay: resilience.exponentialBackoff(1),
      onRetry: ({ delay }) => void delays.push(delay),
    }).attempt(({ attempt }) => {
      if (attempt < 3) throw new Error();
    });
    expect(delays).toEqual([1, 2]);
  });
});
