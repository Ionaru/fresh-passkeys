# fresh-passkeys

## Purpose

Passkey (WebAuthn) authentication for [Fresh](https://fresh.deno.dev) 2.x:
passwordless login backed by the device's biometrics or security key. Passkeys
remove the password from the threat model entirely: nothing to phish, reuse, or
leak in a breach. But the WebAuthn protocol behind them is unforgiving:
challenge generation, signature verification, and signature-counter checks all
have to be exactly right or the whole thing is insecure.

This plugin owns that hard part. It mounts the registration and login ceremony
endpoints on your Fresh app and handles the full challenge lifecycle, credential
verification, and replay-protection counter updates for you. It stays out of
everything that is yours to own: it ships no UI, and it reaches your application
only through a storage port and a few config hooks, so you keep full control of
your user model, sessions, and database.

> 📖 **[Full documentation lives in `docs/`](./docs/README.md)**

## Install

```sh
deno add jsr:@ionaru/fresh-passkeys
```

## Usage

Mount the ceremonies on the server, then drive them from a browser island. Full
walkthrough: [getting-started.md](./docs/getting-started.md).

```ts
// server: main.ts, after session middleware, before app.fsRoutes()
import { passkeyAuth } from "@ionaru/fresh-passkeys/server";

passkeyAuth(app, {
  rpId: "example.com",
  rpName: "Example",
  store, // your PasskeyStore; see docs/storage-port.md
  getSessionUserId: (state) => state.userId ?? null,
  onRegistered: (verified, state) => {/* persist user+passkey+session */},
  onAuthenticated: (userId, state) => {/* create session */},
});
```

```ts
// browser: an island
import { createPasskeyClient } from "@ionaru/fresh-passkeys/client";

const passkeys = createPasskeyClient();
await passkeys.register(username); // new account + first passkey
await passkeys.login(); // discoverable-credential login
await passkeys.addPasskey(); // add a passkey to the signed-in user
```

## Entry points

Two separate exports keep server code out of client bundles:

| Export                                          | Use from          | Provides                                                                                                  |
| ----------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `fresh-passkeys/server` (`./src/server/mod.ts`) | server            | `passkeyAuth`, `PasskeyConfig`, `PasskeyStore`, `ChallengeEntry`, `StoredPasskey`, `VerifiedRegistration` |
| `fresh-passkeys/client` (`./src/client/mod.ts`) | islands / browser | `createPasskeyClient`, `PasskeyClient`, `PasskeyClientConfig`, `WebAuthnError`, `WebAuthnErrorCode`       |

## Server

Register the ceremony endpoints on the Fresh app. Call **before**
`app.fsRoutes()` and **after** the middleware that populates the session state
the hooks read:

```ts
import { passkeyAuth } from "fresh-passkeys/server";

passkeyAuth(app, {
  rpId: "example.com",
  rpName: "Example",
  store, // your PasskeyStore implementation
  getSessionUserId: (state) => state.userId ?? null,
  onRegistered: async (verified, state) => {
    // persist user + passkey + session, return a Response
  },
  onAuthenticated: async (userId, state) => {
    // create session for userId, return a Response
  },
});
```

The host owns identity, the user model and sessions; the plugin reaches them
only through these hooks. Storage (Drizzle, in-memory, Redis, …) is supplied via
the `PasskeyStore` interface.

Endpoints are mounted under `basePath` (default `/api/auth`): `register`,
`add-passkey`, `authenticate` (each GET to begin, POST to finish). Each segment
can be overridden individually via `paths`, e.g.
`{ paths: { register: "/signup" } }`. Pass the same `paths` to the client so its
requests match.

## Client

```ts
import { createPasskeyClient } from "fresh-passkeys/client";

const passkeys = createPasskeyClient(); // or { basePath, paths } to customize URLs

await passkeys.register(username); // new account + first passkey
await passkeys.login(); // discoverable-credential login
await passkeys.addPasskey(); // add a passkey to the signed-in user
```

`WebAuthnError` (re-exported from `@simplewebauthn/browser`) lets the host do
typed error handling without depending on SimpleWebAuthn directly.

## License

MIT
