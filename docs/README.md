# fresh-passkeys documentation

Passkey (WebAuthn) authentication for [Fresh](https://fresh.deno.dev) 2.x. This
plugin owns the hard, security-critical parts of WebAuthn (challenge generation,
signature verification, and replay-protection counter checks) and mounts the
registration and login ceremony endpoints on your Fresh app.

**What it does for you:** the full challenge lifecycle, credential verification,
and signature-counter updates for three ceremonies (register, add-passkey,
authenticate).

**What stays yours:** it ships **no UI**, creates **no users or sessions**, and
touches **no database directly**. It reaches your app only through a storage
port (`PasskeyStore`) and a few config hooks, so you keep full control of your
user model, sessions, and database.

## Two entry points

Server code must never end up in a browser bundle, so the package has two
separate JSR exports:

| Import                          | Use from          | Provides                                                                                                  |
| ------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `@ionaru/fresh-passkeys/server` | server only       | `passkeyAuth`, `PasskeyConfig`, `PasskeyStore`, `ChallengeEntry`, `StoredPasskey`, `VerifiedRegistration` |
| `@ionaru/fresh-passkeys/client` | islands / browser | `createPasskeyClient`, `PasskeyClient`, `PasskeyClientConfig`, `WebAuthnError`, `WebAuthnErrorCode`       |

> **Never import `/server` into an island or any client-bundled module.** It
> pulls in `@simplewebauthn/server` and your storage code.

## Pages

| Page                                       | What it covers                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| [getting-started.md](./getting-started.md) | Install, minimal server + client wiring, and your first working register/login.      |
| [configuration.md](./configuration.md)     | Every `PasskeyConfig` field, endpoint paths, and the required wiring order.          |
| [storage-port.md](./storage-port.md)       | The `PasskeyStore` contract plus complete Deno KV and Drizzle (PostgreSQL) examples. |
| [client-usage.md](./client-usage.md)       | The browser client in a Fresh island, with error handling.                           |
| [troubleshooting.md](./troubleshooting.md) | Symptom → cause → fix, plus the full HTTP status-code reference.                     |

## Choose your path

- **First time?** Read [getting-started.md](./getting-started.md) top to bottom:
  it is a complete, runnable path.
- **Wiring storage?** Go to [storage-port.md](./storage-port.md) for a
  production-ready store you can copy.
- **Something's broken?** Jump to [troubleshooting.md](./troubleshooting.md):
  most WebAuthn failures map to a handful of causes (rpId/origin mismatch,
  expired challenge, non-secure context).

## Mental model

```
Browser (island)                    Fresh server
─────────────────                   ─────────────────────────────
createPasskeyClient()  ── GET ──►   begin  ── generate options + challenge
   │                                          saveChallenge() ──► PasskeyStore
   │  WebAuthn prompt                                                  │
   ▼                                                                   │
navigator.credentials  ── POST ─►   finish ── takeChallenge() ◄────────┘
                                            verify signature + counter
                                            onRegistered / onAuthenticated
                                            (you create the user + session)
```

The plugin never persists anything itself: every read and write goes through the
`PasskeyStore` you implement. Challenge expiry (5 min) and single-use are
enforced inside your store's `takeChallenge`, not by the plugin. See
[storage-port.md](./storage-port.md).
