// Browser entry: thin wrappers over `@simplewebauthn/browser` that drive the
// endpoints registered by `passkeyAuth`. Intentionally UI-free — the host app
// owns islands/markup/styling. Imports no server code, so it is island-safe.
import {
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { DEFAULT_BASE_PATH } from "../shared/constants.ts";

// Re-exported so host apps do typed error handling without importing
// `@simplewebauthn/browser` directly. `WebAuthnError` is browser-only (the
// server's verify functions throw plain `Error`), so it lives on this
// island-safe entry rather than the server entry (`mod.ts`).
export { WebAuthnError } from "@simplewebauthn/browser";
export type { WebAuthnErrorCode } from "@simplewebauthn/browser";

type BeginResponse = { challengeId: string; options: unknown };

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

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `${fallback} (${response.status})`;
}

async function registerPasskey(
  base: string,
  username: string,
): Promise<{ userId: string }> {
  const begin = await fetch(
    `${base}/register-public?username=${encodeURIComponent(username)}`,
  );
  if (!begin.ok) {
    throw new Error(await errorMessage(begin, "Could not start registration"));
  }
  const { challengeId, options } = await begin.json() as BeginResponse;
  const credential = await startRegistration({
    optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
  });
  const finish = await fetch(`${base}/register-public`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ challengeId, username, credential }),
  });
  if (!finish.ok) {
    throw new Error(await errorMessage(finish, "Registration failed"));
  }
  return await finish.json() as { userId: string };
}

async function loginPasskey<User>(
  base: string,
): Promise<{ user: User }> {
  const begin = await fetch(`${base}/authenticate`);
  if (!begin.ok) throw new Error(await errorMessage(begin, "Login failed"));
  const { challengeId, options } = await begin.json() as BeginResponse;
  const credential = await startAuthentication({
    optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
  });
  const finish = await fetch(`${base}/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ challengeId, credential }),
  });
  if (!finish.ok) throw new Error(await errorMessage(finish, "Verify failed"));
  return await finish.json() as { user: User };
}

async function addPasskey(
  base: string,
): Promise<{ credentialId: string }> {
  const begin = await fetch(`${base}/register-add-passkey`, {
    credentials: "same-origin",
  });
  if (!begin.ok) throw new Error(await errorMessage(begin, "Could not start"));
  const { challengeId, options } = await begin.json() as BeginResponse;
  const credential = await startRegistration({
    optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
  });
  const finish = await fetch(`${base}/register-add-passkey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ challengeId, credential }),
  });
  if (!finish.ok) {
    throw new Error(await errorMessage(finish, "Add passkey failed"));
  }
  return await finish.json() as { credentialId: string };
}

/** Create a client bound to a base path; call once and reuse the methods. */
export function createPasskeyClient(
  config: PasskeyClientConfig = {},
): PasskeyClient {
  const base = config.basePath ?? DEFAULT_BASE_PATH;
  return {
    register: (username) => registerPasskey(base, username),
    login: <User = unknown>() => loginPasskey<User>(base),
    addPasskey: () => addPasskey(base),
  };
}
