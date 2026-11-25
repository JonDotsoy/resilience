import { describe, expect, mock, test } from "bun:test";
import { recilience, type RetryEvent } from "./index.js";

describe("recilience", () => {
  test("devuelve el valor de la función", async () => {
    expect(await recilience().run(() => 42)).toBe(42);
    expect(await recilience().run(async () => "ok")).toBe("ok");
  });

  test("por defecto hace 1 intento", async () => {
    const fn = mock(() => {
      throw new Error("boom");
    });
    await expect(recilience().run(fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("reintenta hasta `attempts` y rechaza con el último error", async () => {
    let n = 0;
    const fn = mock(() => {
      n++;
      throw new Error(`fallo ${n}`);
    });
    await expect(recilience({ attempts: 3 }).run(fn)).rejects.toThrow("fallo 3");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("se detiene en el primer intento exitoso", async () => {
    const fn = mock(async ({ attempt }: { attempt: number }) => {
      if (attempt < 2) throw new Error("todavía no");
      return attempt;
    });
    expect(await recilience({ attempts: 5 }).run(fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("control expone attempt, attempts, signal y lastError", async () => {
    const seen: Array<{ attempt: number; attempts: number; lastError: unknown }> = [];
    const err = new Error("x");
    await recilience({ attempts: 2 }).run((control) => {
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
    await recilience({ attempts: 3, onRetry: (e) => void events.push(e) }).run(
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
    await recilience({ attempts: 3, onRetry }).run(() => 1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  test("onRetry asíncrono se espera antes de reintentar", async () => {
    const order: string[] = [];
    await recilience({
      attempts: 2,
      onRetry: async () => {
        await Bun.sleep(5);
        order.push("onRetry");
      },
    }).run(({ attempt }) => {
      order.push(`run ${attempt}`);
      if (attempt === 1) throw new Error();
    });
    expect(order).toEqual(["run 1", "onRetry", "run 2"]);
  });

  test("rechaza sin ejecutar si el signal ya está abortado", async () => {
    const ac = new AbortController();
    ac.abort(new Error("cancelado"));
    const fn = mock(() => 1);
    await expect(recilience({ signal: ac.signal }).run(fn)).rejects.toThrow("cancelado");
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
      recilience({ attempts: 5, signal: ac.signal }).run(fn),
    ).rejects.toThrow("cancelado");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("abortar durante onRetry evita el siguiente intento", async () => {
    const ac = new AbortController();
    const fn = mock(() => {
      throw new Error("falla");
    });
    await expect(
      recilience({
        attempts: 3,
        signal: ac.signal,
        onRetry: () => ac.abort(new Error("cancelado")),
      }).run(fn),
    ).rejects.toThrow("cancelado");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("funciona con fetch pasando el signal", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("hola") });
    try {
      let calls = 0;
      const text = await recilience({ attempts: 2 }).run(async ({ signal }) => {
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
    await recilience({ attempts: 3, delay: 30 }).run(({ attempt }) => {
      times.push(performance.now());
      if (attempt < 3) throw new Error();
    });
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(25);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(25);
  });

  test("delay no espera antes del primer intento", async () => {
    const start = performance.now();
    await recilience({ attempts: 3, delay: 200 }).run(() => 1);
    expect(performance.now() - start).toBeLessThan(100);
  });

  test("delay como función recibe el contexto y onRetry recibe el valor", async () => {
    const delay = mock(({ attempt }: { attempt: number }) => attempt * 5);
    const events: RetryEvent[] = [];
    await recilience({
      attempts: 3,
      delay,
      onRetry: (e) => void events.push(e),
    }).run(({ attempt }) => {
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
      recilience({ attempts: 3, delay: 5_000, signal: ac.signal }).run(fn),
    ).rejects.toThrow("cancelado");
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("valida delay", async () => {
    expect(() => recilience({ delay: -1 })).toThrow(RangeError);
    expect(() => recilience({ delay: Number.NaN })).toThrow(RangeError);
    await expect(
      recilience({ attempts: 2, delay: () => -5 }).run(() => {
        throw new Error("x");
      }),
    ).rejects.toThrow(RangeError);
  });

  test("valida attempts", () => {
    expect(() => recilience({ attempts: 0 })).toThrow(RangeError);
    expect(() => recilience({ attempts: 1.5 })).toThrow(RangeError);
  });
});
