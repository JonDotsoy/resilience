# @jondotsoy/recilience

Ejecuta una función con reintentos y cancelación mediante `AbortSignal`. Sin dependencias.

```sh
npm install @jondotsoy/recilience
```

## Uso

```ts
import { recilience } from "@jondotsoy/recilience";

const res = await recilience({ attempts: 3 }).attempt(({ signal }) =>
  fetch("https://api.example.com/data", { signal }),
);
```

### Sintaxis

```ts
recilience(options).attempt((control) => T | Promise<T>): Promise<T>
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
await recilience({
  attempts: 5,
  onRetry: ({ attempt, attempts, error }) => {
    console.warn(`Reintento ${attempt}/${attempts}`, error);
  },
}).attempt(({ signal }) => fetch(url, { signal }));
```

Cancelar todo después de 10 s (incluidos los reintentos):

```ts
await recilience({
  attempts: 3,
  signal: AbortSignal.timeout(10_000),
}).attempt(({ signal }) => fetch(url, { signal }));
```

Esperar 500 ms entre intentos:

```ts
await recilience({ attempts: 3, delay: 500 }).attempt(task);
```

Timeout de 2 s por intento, solo reintentar errores de servidor:

```ts
class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

await recilience({
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
import { recilience, exponentialBackoff } from "@jondotsoy/recilience";

await recilience({
  attempts: 5,
  delay: exponentialBackoff(200, { maxDelay: 5_000, jitter: "full" }),
  onRetry: ({ attempt, delay }) => console.warn(`Reintento ${attempt} en ${delay} ms`),
}).attempt(task);
```

También puedes pasar tu propia función: `delay: ({ attempt, error }) => ...`.

## Desarrollo

```sh
bun install
bun test
bun run typecheck
bun run build
```

## Licencia

MIT
