# @jondotsoy/recilience

Ejecuta una función con reintentos y cancelación mediante `AbortSignal`. Sin dependencias.

```sh
npm install @jondotsoy/recilience
```

## Uso

```ts
import { recilience } from "@jondotsoy/recilience";

const res = await recilience({ attempts: 3 }).run(({ signal }) =>
  fetch("https://api.example.com/data", { signal }),
);
```

### Sintaxis

```ts
recilience(options).run((control) => T | Promise<T>): Promise<T>
```

## Opciones

| Opción     | Tipo                                         | Por defecto | Descripción                                                        |
| ---------- | -------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `attempts` | `number`                                     | `1`         | Número de intentos antes de rechazar. Debe ser un entero `>= 1`.   |
| `signal`   | `AbortSignal`                                | —           | Cancela el intento en curso y los reintentos pendientes.            |
| `onRetry`  | `(event: RetryEvent) => void \| Promise<void>` | —           | Se llama antes de cada reejecución. Si devuelve una promesa, se espera. |

`RetryEvent` contiene:

- `attempt`: número del intento que está por ejecutarse (2, 3, ...).
- `attempts`: total de intentos permitidos.
- `error`: error que provocó el reintento.

## Control

La función recibe un objeto `control` en cada intento:

- `signal`: `AbortSignal` del intento. Pásalo a `fetch` o a cualquier API cancelable. Se aborta cuando se aborta `options.signal`.
- `attempt`: número del intento actual, empezando en 1.
- `attempts`: total de intentos permitidos.
- `lastError`: error del intento anterior (o `undefined` en el primero).

## Comportamiento

- Si la función se resuelve, `run` devuelve ese valor y no hay más intentos.
- Si falla en todos los intentos, `run` rechaza con el error del último intento.
- Si `options.signal` se aborta, `run` rechaza con `signal.reason` y no reintenta.

## Ejemplos

Notificar los reintentos:

```ts
await recilience({
  attempts: 5,
  onRetry: ({ attempt, attempts, error }) => {
    console.warn(`Reintento ${attempt}/${attempts}`, error);
  },
}).run(({ signal }) => fetch(url, { signal }));
```

Cancelar con timeout:

```ts
await recilience({
  attempts: 3,
  signal: AbortSignal.timeout(10_000),
}).run(({ signal }) => fetch(url, { signal }));
```

Esperar entre reintentos usando `onRetry`:

```ts
await recilience({
  attempts: 3,
  onRetry: ({ attempt }) => new Promise((r) => setTimeout(r, 2 ** attempt * 100)),
}).run(task);
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
