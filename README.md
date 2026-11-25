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
| `fallback` | `(lastError, ctx: FallbackContext) => F \| Promise<F>` | — | Se llama cuando la ejecución falla definitivamente. Lo que devuelva pasa a ser el resultado de `attempt` (el tipo queda `T \| F`). Si lanza, `attempt` rechaza con ese error. No se llama al abortar `signal`. `ctx` tiene `attempt` (intentos ejecutados) y `attempts`. |
| `waitForTask` | `boolean` | `false` | Qué hace `attempt` al abortarse `signal` o vencer `timeout`. `false`: rechaza en ese momento (con `TimeoutError` en un timeout), aunque la tarea siga corriendo. `true`: aborta `control.signal` y espera a la tarea, entregando lo que devuelva o lance. |

`RetryEvent` contiene:

- `attempt`: número del intento que está por ejecutarse (2, 3, ...).
- `attempts`: total de intentos permitidos.
- `error`: error que provocó el reintento.
- `delay`: milisegundos que se esperarán antes de reejecutar.

`DelayContext` contiene `attempt`, `attempts` y `error`.

## Ciclo de vida

Además de `onRetry`, las opciones aceptan hooks `on<Evento>` que se ejecutan en este orden:

```
onStart
  └─ por cada intento: onAttempt → onTimeout? → onError? → onRetry?
onSuccess | onFailure | onAbort
onSettled
```

| Hook        | Argumentos                                         | Cuándo                                                                 |
| ----------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `onStart`   | `{ attempt: 0, attempts }`                         | Antes del primer intento.                                              |
| `onAttempt` | `{ attempt, attempts, lastError }`                 | Antes de ejecutar cada intento, incluido el primero.                   |
| `onTimeout` | `{ attempt, attempts, timeout }`                   | Cuando vence el `timeout` de un intento (antes de `onError`).          |
| `onError`   | `(error, { attempt, attempts, willRetry })`        | Cada vez que un intento falla. `willRetry` indica si habrá otro.       |
| `onRetry`   | `{ attempt, attempts, error, delay }`              | Antes de reejecutar, antes de la espera.                               |
| `onSuccess` | `(value, { attempt, attempts })`                   | Cuando un intento termina bien.                                        |
| `onFailure` | `(error, { attempt, attempts })`                   | Cuando falla definitivamente, antes de `fallback`.                     |
| `onAbort`   | `(reason, { attempt, attempts })`                  | Cuando se aborta `signal`. No se llama `onFailure` ni `fallback`.      |
| `onSettled` | `{ status, attempt, attempts, value?, error? }`    | Siempre al final. `status`: `"success"`, `"fallback"`, `"failure"` o `"aborted"`. |

Todos los hooks se esperan si devuelven una promesa. Si un hook lanza, `attempt` rechaza con ese error.

```ts
await resilience({
  attempts: 3,
  timeout: 2_000,
  onAttempt: ({ attempt, attempts }) => console.log(`intento ${attempt}/${attempts}`),
  onError: (error, { willRetry }) => console.warn("falló", error, { willRetry }),
  onSettled: ({ status, attempt }) => metrics.record("fetch_user", { status, attempt }),
}).attempt(({ signal }) => getUser(id, signal));
```

## Control

La función recibe un objeto `control` en cada intento:

- `signal`: `AbortSignal` del intento. Pásalo a `fetch` o a cualquier API cancelable. Se aborta cuando se aborta `options.signal` o cuando vence `options.timeout`.
- `attempt`: número del intento actual, empezando en 1.
- `attempts`: total de intentos permitidos.
- `lastError`: error del intento anterior (o `undefined` en el primero).

## Comportamiento

- Si la función se resuelve, `attempt` devuelve ese valor y no hay más intentos.
- Si `retryable` devuelve `false`, rechaza con ese error sin más intentos.
- Si hay `fallback`, cualquier fallo definitivo (intentos agotados o `retryable` en `false`) se resuelve con lo que devuelva el fallback.
- Si falla en todos los intentos sin `fallback`, `attempt` rechaza con el error del último intento.
- Entre un intento fallido y el siguiente: se llama `onRetry`, luego se espera `delay` ms.
- Si `options.signal` se aborta (incluso durante la espera), `attempt` rechaza en ese momento con `signal.reason` y no reintenta. Con `waitForTask: true`, espera a la tarea y entrega su resultado o su error.

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

### ¿Esperar a la tarea o no? (`waitForTask`)

Abortar solo **avisa** a la tarea: si la tarea ignora `control.signal`, puede seguir corriendo. `waitForTask` decide qué hace el `await` de `.attempt()`:

```ts
// Por defecto (waitForTask: false): rechaza apenas vence el timeout o se aborta el signal.
await resilience({ timeout: 1_000 }).attempt(task);
// → TimeoutError al segundo, aunque `task` siga corriendo.

// waitForTask: true: aborta control.signal pero espera a que la tarea termine.
const result = await resilience({ timeout: 1_000, waitForTask: true }).attempt(
  async ({ signal }) => {
    const items: string[] = [];
    let stop = false;

    signal.addEventListener("abort", () => {
      // signal.reason es un TimeoutError: se termina el ítem actual y se corta.
      console.warn("Tiempo agotado, guardando lo procesado", signal.reason);
      stop = true;
    });

    for (const item of queue) {
      if (stop) break;
      items.push(await process(item));
    }

    await save(items);
    return { items, complete: !stop };
  },
);
// → lo que devuelva la tarea; si la tarea lanza, `attempt` rechaza (o reintenta, en un timeout).
```

#### Qué pasa en cada combinación

| Configuración | Al vencer / abortarse | Si la tarea **termina bien** después | Si la tarea **lanza** después | ¿Reintenta? | ¿`fallback`? |
| --- | --- | --- | --- | --- | --- |
| `timeout` | Rechaza en el momento con `TimeoutError` | Se ignora su valor | Se ignora su error | Sí | Sí, si se agotan los intentos |
| `timeout` + `waitForTask: true` | Aborta `control.signal` y espera | `attempt` devuelve ese valor (éxito) | Cuenta como fallo del intento | Sí | Sí, si se agotan los intentos |
| `signal` | Rechaza en el momento con `signal.reason` | Se ignora su valor | Se ignora su error | No | No |
| `signal` + `waitForTask: true` | Aborta `control.signal` y espera | `attempt` devuelve ese valor (éxito) | `attempt` rechaza con el error de la tarea | No | No |

#### `signal: AbortSignal.timeout(10_000)` + `waitForTask: true`

```ts
const result = await resilience({
  attempts: 3,
  delay: 1_000,
  signal: AbortSignal.timeout(10_000),
  waitForTask: true,
}).attempt(async ({ signal }) => {
  signal.addEventListener("abort", () => {
    // A los 10 s: signal.reason es un TimeoutError.
  });
  return await longTask(signal);
});
```

A los 10 s, contados desde que se creó el signal (no desde cada intento):

1. **Si hay un intento corriendo**, se aborta su `control.signal` con el `TimeoutError` y `attempt` **espera** a que la tarea termine:
   - Si la tarea devuelve un valor, `attempt` resuelve con ese valor. Se llama `onSuccess` y `onSettled` con `status: "success"`.
   - Si la tarea lanza, `attempt` rechaza con **ese error** (no con el `TimeoutError`). No se reintenta ni se usa `fallback`; se llama `onAbort` y `onSettled` con `status: "aborted"`.
2. **Si está esperando entre intentos** (`delay`), no hay tarea que esperar: `attempt` rechaza en el momento con el `TimeoutError` y no hace más intentos.
3. **Si el signal ya estaba abortado** antes de llamar a `attempt`, rechaza sin ejecutar la tarea.

En resumen: `waitForTask` solo cambia si se espera a la tarea **que está corriendo**; un signal abortado nunca deja empezar un intento nuevo.

Esperar 500 ms entre intentos:

```ts
await resilience({ attempts: 3, delay: 500 }).attempt(task);
```

Valor alternativo cuando todo falla:

```ts
const user = await resilience({
  attempts: 3,
  fallback: async (lastError) => {
    console.error("No se pudo obtener el usuario", lastError);
    return null;
  },
}).attempt(({ signal }) => getUser(id, signal)); // User | null
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
  breaker.execute(() =>
    resilience({
      attempts: 3,
      timeout: 2_000,
      delay: exponentialBackoff(200),
    }).attempt(({ signal }) => pool.execute(() => fetch(url, { signal }), { signal })),
  );

// Con fallback por fuera, incluso un CircuitOpenError termina en el valor alternativo:
const getDataSafe = () =>
  resilience({ fallback: () => cachedData }).attempt(getData);
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
