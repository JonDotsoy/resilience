/**
 * Ejecuta `task` y, si falla, devuelve el resultado de `handler`.
 *
 * @example
 * const user = await fallback(
 *   () => resilience({ attempts: 3 }).attempt(({ signal }) => getUser(id, signal)),
 *   () => anonymousUser,
 * );
 */
export const fallback = async <T, F = T>(
  task: () => T | Promise<T>,
  handler: (error: unknown) => F | Promise<F>,
): Promise<T | F> => {
  try {
    return await task();
  } catch (error) {
    return handler(error);
  }
};
