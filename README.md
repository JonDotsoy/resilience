# @jondotsoy/resilience

Ejecuta una función con reintentos y cancelación mediante `AbortSignal`. Sin dependencias.

```sh
npm install @jondotsoy/resilience
```

## Uso

```ts
import { resilience } from "@jondotsoy/resilience";

const res = await resilience({ attempts: 3 }).attempt(({ signal }) =>
  fetch("https://api.example.com/data", { signal }),
);
```

### Sintaxis

```ts
resilience(options).attempt((control) => T | Promise<T>): Promise<T>
```

## Opciones

| Opción     | Tipo                                         | Por defecto | Descripción                                                        |
| ---------- | -------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `attempts` | `number`                                     | `1`         | Número de intentos antes de rechazar. Debe ser un entero `>= 1`.   |
| `signal`   | `AbortSignal`                                | —           | Cancela el intento en curso y los reintentos pendientes.            |
| `delay`    | `number \| (ctx: DelayContext) => number`     | `0`         | Milisegundos a esperar entre intentos. Con una función puedes calcularlo por intento. La espera se cancela si se aborta `signal`. |
| `onRetry`  | `(event: RetryEvent) => void \| Promise<void>` | —           | Se llama antes de cada reejecución (antes de la espera). Si devuelve una promesa, se espera. |
| `retryable` | `(error, ctx: RetryableContext) => boolean \| Promise<boolean>` | reintenta todo | Si devuelve `false`, rechaza de inmediato con ese error sin reintentar. `ctx` tiene `attempt` (el que falló) y `attempts`. |
| `timeout`  | `number`                                     | —           | Tiempo máximo en ms por intento. Al vencer aborta `control.signal` y el intento falla con `DOMException` `"TimeoutError"`, que se puede reintentar. |

`RetryEvent` contiene:

- `attempt`: número del intento que está por ejecutarse (2, 3, ...).
- `attempts`: total de intentos permitidos.
- `error`: error que provocó el reintento.
- `delay`: milisegundos que se esperarán antes de reejecutar.

`DelayContext` contiene `attempt`, `attempts` y `error`.

## Control

La función recibe un objeto `control` en cada intento:

- `signal`: `AbortSignal` del intento. Pásalo a `fetch` o a cualquier API cancelable. Se aborta cuando se aborta `options.signal` o cuando vence `options.timeout`.
- `attempt`: número del intento actual, empezando en 1.
- `attempts`: total de intentos permitidos.
- `lastError`: error del intento anterior (o `undefined` en el primero).

## Comportamiento

- Si la función se resuelve, `attempt` devuelve ese valor y no hay más intentos.
- Si `retryable` devuelve `false`, rechaza con ese error sin más intentos.
- Si falla en todos los intentos, `attempt` rechaza con el error del último intento.
- Entre un intento fallido y el siguiente: se llama `onRetry`, luego se espera `delay` ms.
- Si `options.signal` se aborta (incluso durante la espera), `attempt` rechaza con `signal.reason` y no reintenta.

## Ejemplos

Notificar los reintentos:

```ts
await resilience({
  attempts: 5,
  onRetry: ({ attempt, attempts, error }) => {
    console.warn(`Reintento ${attempt}/${attempts}`, error);
  },
}).attempt(({ signal }) => fetch(url, { signal }));
```

### Timeout por intento vs. timeout total

Hay dos formas de poner un límite de tiempo, y se pueden usar juntas:

| | `timeout: ms` | `signal: AbortSignal.timeout(ms)` |
| --- | --- | --- |
| Qué limita | Cada intento por separado | Toda la ejecución, incluidos reintentos y esperas |
| Al vencer | Aborta `control.signal` con `TimeoutError` | Aborta `control.signal` con el `reason` del signal (`TimeoutError`) |
| ¿Se reintenta? | Sí, cuenta como un fallo más | No, `attempt` rechaza de inmediato |

```ts
await resilience({
  attempts: 3,
  timeout: 2_000,                      // cada intento tiene como máximo 2 s
  signal: AbortSignal.timeout(10_000), // y todo junto, como máximo 10 s
  delay: 500,
}).attempt(({ signal }) => fetch(url, { signal }));
```

En ambos casos `control.signal` recibe el evento `abort`, así que basta con pasárselo a `fetch` o a la API que uses.

Esperar 500 ms entre intentos:

```ts
await resilience({ attempts: 3, delay: 500 }).attempt(task);
```

Timeout de 2 s por intento, solo reintentar errores de servidor:

```ts
class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

await resilience({
  attempts: 3,
  timeout: 2_000,
  retryable: (error) => !(error instanceof HttpError) || error.status >= 500,
}).attempt(async ({ signal }) => {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
});
```

## Backoff

Helpers listos para la opción `delay`. Todos aceptan `{ maxDelay, jitter }`, donde `jitter` puede ser `"full"` (entre 0 y el delay) o `"equal"` (entre la mitad y el delay).

| Helper                              | Serie con `ms = 100`         |
| ----------------------------------- | ---------------------------- |
| `fixedBackoff(ms)`                  | 100, 100, 100, ...           |
| `linearBackoff(ms)`                 | 100, 200, 300, ...           |
| `exponentialBackoff(ms, { factor })` | 100, 200, 400, ... (factor 2) |
| `fibonacciBackoff(ms)`              | 100, 100, 200, 300, 500, ... |

```ts
import { resilience, exponentialBackoff } from "@jondotsoy/resilience";

await resilience({
  attempts: 5,
  delay: exponentialBackoff(200, { maxDelay: 5_000, jitter: "full" }),
  onRetry: ({ attempt, delay }) => console.warn(`Reintento ${attempt} en ${delay} ms`),
}).attempt(task);
```

También puedes pasar tu propia función: `delay: ({ attempt, error }) => ...`.

Todas las utilidades (backoffs, políticas y errores) también están colgadas de la función `resilience`, así que basta con un solo import:

```ts
import { resilience } from "@jondotsoy/resilience";

await resilience({
  attempts: 5,
  delay: resilience.exponentialBackoff(200, { maxDelay: 5_000 }),
}).attempt(task);

const breaker = resilience.circuitBreaker({ failureThreshold: 3 });
```

## Políticas con estado

Además de `resilience`, la lib trae políticas que guardan estado entre llamadas. Créalas **una vez** (por ejemplo, una por servicio) y reutilízalas. Todas exponen `execute(fn)` y se pueden anidar entre sí y con `resilience`.

### fallback

Devuelve un valor alternativo si la tarea falla.

```ts
import { fallback, resilience } from "@jondotsoy/resilience";

const user = await fallback(
  () => resilience({ attempts: 3 }).attempt(({ signal }) => getUser(id, signal)),
  (error) => anonymousUser,
);
```

### circuitBreaker

Tras `failureThreshold` fallos seguidos se **abre** y rechaza al instante con `CircuitOpenError`. Después de `resetTimeout` ms pasa a **half-open** y deja pasar una prueba: si funciona se **cierra**, si falla se vuelve a abrir.

| Opción             | Por defecto | Descripción                                        |
| ------------------ | ----------- | -------------------------------------------------- |
| `failureThreshold` | `5`         | Fallos seguidos que abren el circuito.             |
| `resetTimeout`     | `30_000`    | Ms abierto antes de probar de nuevo.               |
| `successThreshold` | `1`         | Éxitos en half-open para cerrarlo.                 |
| `isFailure`        | todos       | `(error) => boolean`, qué errores cuentan como fallo. |
| `onStateChange`    | —           | `(state, previous) => void`.                       |

```ts
const breaker = circuitBreaker({ failureThreshold: 5, resetTimeout: 10_000 });

await breaker.execute(() => fetch(url));
breaker.state; // "closed" | "open" | "half-open"
breaker.reset();
```

### bulkhead

Limita cuántas llamadas corren en paralelo. Si no hay cupo ni espacio en la cola, lanza `BulkheadRejectedError`.

```ts
const pool = bulkhead({ maxConcurrent: 5, maxQueue: 20 });

await pool.execute(() => fetch(url), { signal }); // signal cancela la espera en cola
pool.running; // en curso
pool.queued;  // esperando
```

### throttle

Limita la cantidad de llamadas en una ventana deslizante. Al superarla lanza `ThrottleError`, con `retryAfter` en ms.

```ts
const limiter = throttle({ limit: 10, interval: 1_000 }); // 10 por segundo

await limiter.execute(() => fetch(url));
limiter.remaining;
```

### cache

Guarda en memoria el resultado por `ttl` ms. No guarda errores. Las llamadas simultáneas con la misma key comparten la ejecución.

```ts
const users = cache({ ttl: 60_000, maxSize: 500 });

await users.execute(`user:${id}`, () => getUser(id));
users.delete(`user:${id}`);
users.clear();
```

### dedupe

Si ya hay una llamada en curso con la misma key, devuelve esa misma promesa.

```ts
const inFlight = dedupe();

const [a, b] = await Promise.all([
  inFlight.execute("config", loadConfig),
  inFlight.execute("config", loadConfig), // no vuelve a llamar a loadConfig
]);
```

### Combinarlas

El orden de anidación define el comportamiento. Por ejemplo, un breaker por fuera hace que toda la secuencia de reintentos cuente como una sola llamada:

```ts
const breaker = circuitBreaker({ failureThreshold: 3 });
const pool = bulkhead({ maxConcurrent: 10 });

const getData = () =>
  fallback(
    () =>
      breaker.execute(() =>
        resilience({ attempts: 3, timeout: 2_000, delay: exponentialBackoff(200) }).attempt(
          ({ signal }) => pool.execute(() => fetch(url, { signal }), { signal }),
        ),
      ),
    () => cachedData,
  );
```

## Desarrollo

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Licencia

MIT
