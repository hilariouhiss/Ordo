/**
 * Unwraps a value a test has just proved exists, without `!`.
 *
 * Biome's `noNonNullAssertion` is on, and it is right: `!` turns a wrong
 * assumption into "cannot read properties of undefined" fifteen frames away.
 * This throws at the point of the assumption instead, naming the thing that
 * went missing, so a broken fixture says so.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${what} to exist`);
  }
  return value;
}
