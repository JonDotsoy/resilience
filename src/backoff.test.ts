import { describe, expect, test } from "bun:test";
import {
  exponentialBackoff,
  fibonacciBackoff,
  fixedBackoff,
  linearBackoff,
} from "./backoff.js";

// El contexto de `delay` empieza en attempt 2 (primer reintento).
const series = (fn: (c: { attempt: number; attempts: number; error: unknown }) => number, n = 5) =>
  Array.from({ length: n }, (_, i) => fn({ attempt: i + 2, attempts: n + 1, error: null }));

describe("backoff", () => {
  test("fixed", () => {
    expect(series(fixedBackoff(100))).toEqual([100, 100, 100, 100, 100]);
  });

  test("linear", () => {
    expect(series(linearBackoff(100))).toEqual([100, 200, 300, 400, 500]);
  });

  test("exponential", () => {
    expect(series(exponentialBackoff(100))).toEqual([100, 200, 400, 800, 1600]);
    expect(series(exponentialBackoff(100, { factor: 3 }), 3)).toEqual([100, 300, 900]);
  });

  test("fibonacci", () => {
    expect(series(fibonacciBackoff(100), 6)).toEqual([100, 100, 200, 300, 500, 800]);
  });

  test("maxDelay limita el delay", () => {
    expect(series(exponentialBackoff(100, { maxDelay: 500 }))).toEqual([
      100, 200, 400, 500, 500,
    ]);
  });

  test("jitter full queda entre 0 y el delay", () => {
    for (const d of series(exponentialBackoff(100, { jitter: "full" }), 50)) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
    const fn = fixedBackoff(100, { jitter: "full" });
    for (let i = 0; i < 50; i++) {
      const d = fn({ attempt: 2, attempts: 3, error: null });
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(100);
    }
  });

  test("jitter equal queda entre la mitad y el delay", () => {
    const fn = fixedBackoff(100, { jitter: "equal" });
    for (let i = 0; i < 50; i++) {
      const d = fn({ attempt: 2, attempts: 3, error: null });
      expect(d).toBeGreaterThanOrEqual(50);
      expect(d).toBeLessThanOrEqual(100);
    }
  });
});
