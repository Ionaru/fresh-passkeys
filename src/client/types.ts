// Public type surface for the island-safe browser client. Re-exported by
// `mod.ts`. Imports no server code so it stays island-safe.

// Re-exported so host apps do typed error handling without importing
// `@simplewebauthn/browser` directly. `WebAuthnErrorCode` is browser-only (the
// server's verify functions throw plain `Error`), so it lives on this
// island-safe entry rather than the server entry.
export type { WebAuthnErrorCode } from "@simplewebauthn/browser";

/** Client configuration; the base path is given once, not per call. */
export interface PasskeyClientConfig {
  /** Endpoint prefix; defaults to `DEFAULT_BASE_PATH` ("/api/auth"). */
  basePath?: string;
}

/**
 * Bound client. The shape of the authenticated user is whatever the host's
 * `onAuthenticated` hook returns, so `login` is generic over it and the plugin
 * never dictates a user type.
 */
export interface PasskeyClient {
  /** Register a new account + its first passkey. Throws on failure. */
  register(username: string): Promise<{ userId: string }>;
  /** Discoverable-credential login. Throws on failure. */
  login<User = unknown>(): Promise<{ user: User }>;
  /** Add another passkey to the signed-in account. Throws on failure. */
  addPasskey(): Promise<{ credentialId: string }>;
}
