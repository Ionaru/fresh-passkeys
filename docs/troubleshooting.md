# Troubleshooting

Most WebAuthn failures trace back to a handful of causes. Find your symptom
below, or use the status-code reference to decode a response.

## <a id="http-status-reference"></a>HTTP status reference

What each ceremony endpoint returns, and what it means:

| Status | Condition                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | Malformed JSON body, missing required field, username mismatch, or `validateUsername` rejection                                                        |
| 400    | Challenge missing, expired, or malformed (the `"Invalid challenge"` branch)                                                                            |
| 401    | Not signed in, on a session-gated endpoint (add-passkey)                                                                                               |
| 401    | Any other verification failure: signature invalid, origin/rpId mismatch, counter didn't advance, add-passkey challenge not bound to the signed-in user |
| 404    | Presented credential is unknown (no stored passkey with that id)                                                                                       |
| 404    | No passkeys registered anywhere (on authenticate begin)                                                                                                |
| 201    | Success: registration finish (your `onRegistered` status) / add-passkey finish                                                                         |
| 500    | Unexpected failure during a _begin_ phase (e.g. the store threw)                                                                                       |

Per endpoint:

- **GET /register**: 400 username missing/rejected · 500 store error.
- **POST /register**: your `onRegistered` status on success · 400 bad body /
  missing field / username mismatch / rejection / invalid challenge · 401 any
  other verification failure.
- **GET /add-passkey**: 401 not signed in · 500 store error.
- **POST /add-passkey**: 201 success · 401 not signed in / challenge not bound
  to the signed-in user / verification failure · 400 missing field / invalid
  challenge.
- **GET /authenticate**: 404 no passkeys registered · 500 other store error.
- **POST /authenticate**: your `onAuthenticated` status on success · 404 unknown
  credential · 400 missing field / invalid challenge · 401 any other
  verification failure (including counter not advancing).

## Symptom → cause → fix

### Register/login finish returns 401 "verification failed"

**Cause:** the `rpId` doesn't match the origin the browser reports, or the
expected origin is wrong (common behind a reverse proxy).

**Fix:**

- `rpId` must be the bare **registrable domain**, `example.com`, not
  `https://example.com`, not `example.com:8000`, not `www.example.com` if you
  serve from the apex. In dev it's `localhost`.
- Behind a TLS-terminating proxy, set `expectedOrigin` to the public origin:
  ```ts
  expectedOrigin: () => "https://example.com",
  ```
- A credential registered under one `rpId` cannot be used under another.

### The browser prompt never appears

**Cause:** not a secure context. WebAuthn requires HTTPS, or `localhost` in dev.

**Fix:** serve over HTTPS with a valid certificate in production; use
`http://localhost` (not a LAN IP like `192.168.x.x`) for local development.
Self-signed certs are rejected by most browsers.

### 400 "Invalid challenge" after the user paused

**Cause:** challenges live **5 minutes**, then expire. They are also
**single-use**: the finish phase consumes the challenge, so retrying a finish
request finds nothing.

**Fix:** start the ceremony over from the begin call (the client `register` /
`login` / `addPasskey` methods do this for you). Don't retry a finish POST on
its own. If users routinely hit this, surface a "session expired, try again"
message and re-trigger the client method.

### Login begin returns 404 "No passkeys registered"

**Cause:** no credentials exist anywhere yet: `hasAnyPasskeys()` returned false.
This is a distinct, expected state, not an error.

**Fix:** surface it as "no passkeys yet, register first" rather than a generic
failure. It commonly means your store's `hasAnyPasskeys`/`createPasskey` aren't
agreeing. Confirm `onRegistered` actually persisted the first credential.

### Login fails 401 and logs mention the counter

**Cause:** the signature counter didn't advance past the stored value. The
protocol requires it to strictly increase; a stalled counter can indicate a
cloned authenticator. **This is replay protection working**: the rejection is
correct.

**Fix:** if it happens legitimately (some authenticators always report 0),
verify your store's `setCounter` actually persists and `findPasskey` returns the
latest value. A counter that never updates because `setCounter` is a no-op will
eventually wedge logins.

### Client requests all 404

**Cause:** the client's `basePath`/`paths` don't match the server's, so it POSTs
to URLs the plugin never mounted.

**Fix:** pass identical `basePath`/`paths` to both `passkeyAuth` and
`createPasskeyClient`. With defaults, pass nothing to either.

### Ceremony succeeds but the client throws reading the result

**Cause:** your hook response is missing the field the client reads.

**Fix:**

- `onRegistered` response body must include `userId`.
- `onAuthenticated` response body must include `user` (any shape).

```ts
return Response.json({ userId }, { status: 201, headers });
// and
return Response.json({ user: { id, username } }, { headers });
```

### add-passkey returns 401 for a signed-in-looking user

**Cause:** `getSessionUserId(state)` returned `null`. The ceremony is
session-gated on **both** begin and finish.

**Fix:**

- Ensure `passkeyAuth` is registered **after** the session middleware, so
  `context.state` is populated when the hook runs (see
  [configuration.md](./configuration.md#wiring-order)).
- The client sends `credentials: "same-origin"`; confirm the session cookie is
  same-origin and not blocked (e.g. by `SameSite`/secure flags on a mismatched
  origin).

### Registration finish returns 400 "Username does not match"

**Cause:** the username sent on finish differs (after trim) from the one sent on
begin, or `validateUsername` rejected it on the second pass. The plugin
validates the username in **both** phases and compares them exactly
(case-sensitive, after trimming).

**Fix:** send the same username string for both client calls, and keep
`validateUsername` deterministic: it must accept at finish whatever it accepted
at begin.

## Still stuck?

- Check the response body: the plugin returns `{ "error": "<message>" }` with
  the specific reason on every non-hook failure.
- Re-read the wiring order and hook contracts in
  [configuration.md](./configuration.md).
- Verify your store against the checklist in
  [storage-port.md](./storage-port.md#checklist-for-any-store).
