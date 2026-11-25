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

`RetryEvent` contiene:

- `attempt`: número del intento que está por ejecutarse (2, 3, ...).
- `attempts`: total de intentos permitidos.
- `error`: error que provocó el reintento.
- `delay`: milisegundos que se esperarán antes de reejecutar.

`DelayContext` contiene `attempt`, `attempts` y `error`.

## Control

La función recibe un objeto `control` en cada intento:

- `signal`: `AbortSignal` del intento. Pásalo a `fetch` o a cualquier API cancelable. Se aborta cuando se aborta `options.signal`.
- `attempt`: número del intento actual, empezando en 1.
- `attempts`: total de intentos permitidos.
- `lastError`: error del intento anterior (o `undefined` en el primero).

## Comportamiento

- Si la función se resuelve, `attempt` devuelve ese valor y no hay más intentos.
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

Cancelar con timeout:

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

Backoff exponencial (200 ms, 400 ms, 800 ms, ...):

```ts
await recilience({
  attempts: 5,
  delay: ({ attempt }) => 100 * 2 ** (attempt - 1),
  onRetry: ({ attempt, delay }) => console.warn(`Reintento ${attempt} en ${delay} ms`),
}).attempt(task);
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
