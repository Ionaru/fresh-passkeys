import { assertExists } from "@std/assert";

/**
 * Assert a value is present and return it narrowed. Test-friendly stand-in for
 * the `!` non-null assertion, which the project's lint config forbids.
 */
export function must<T>(value: T): NonNullable<T> {
  assertExists(value);
  return value as NonNullable<T>;
}
