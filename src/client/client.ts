// Browser entry: thin wrappers over `@simplewebauthn/browser` that drive the
// endpoints registered by `passkeyAuth`. Intentionally UI-free — the host app
// owns islands/markup/styling. Imports no server code, so it is island-safe.
import {
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

import { resolvePaths } from "../shared/constants.ts";
import type { PasskeyClient, PasskeyClientConfig } from "./types.ts";

type BeginResponse = { challengeId: string; options: unknown };

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `${fallback} (${response.status})`;
}

async function registerPasskey(
  path: string,
  username: string,
): Promise<{ userId: string }> {
  const begin = await fetch(
    `${path}?username=${encodeURIComponent(username)}`,
  );
  if (!begin.ok) {
    throw new Error(await errorMessage(begin, "Could not start registration"));
  }
  const { challengeId, options } = await begin.json() as BeginResponse;
  const credential = await startRegistration({
    optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
  });
  const finish = await fetch(path, {
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
  path: string,
): Promise<{ user: User }> {
  const begin = await fetch(path);
  if (!begin.ok) throw new Error(await errorMessage(begin, "Login failed"));
  const { challengeId, options } = await begin.json() as BeginResponse;
  const credential = await startAuthentication({
    optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
  });
  const finish = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ challengeId, credential }),
  });
  if (!finish.ok) throw new Error(await errorMessage(finish, "Verify failed"));
  return await finish.json() as { user: User };
}

async function addPasskey(
  path: string,
): Promise<{ credentialId: string }> {
  const begin = await fetch(path, {
    credentials: "same-origin",
  });
  if (!begin.ok) throw new Error(await errorMessage(begin, "Could not start"));
  const { challengeId, options } = await begin.json() as BeginResponse;
  const credential = await startRegistration({
    optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
  });
  const finish = await fetch(path, {
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
  const paths = resolvePaths(config.basePath, config.paths);
  return {
    register: (username) => registerPasskey(paths.register, username),
    login: <User = unknown>() => loginPasskey<User>(paths.authenticate),
    addPasskey: () => addPasskey(paths.addPasskey),
  };
}
