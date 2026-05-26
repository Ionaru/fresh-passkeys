# Configuration

`passkeyAuth(app, config)` registers the ceremony endpoints. This page documents
every field of `config` (a `PasskeyConfig<State>`), the endpoint URLs it mounts,
and the order in which it must be called.

```ts
import { passkeyAuth } from "@ionaru/fresh-passkeys/server";

passkeyAuth(app, config);
```

`State` is your Fresh app's context state type; the plugin treats it as opaque
and only ever passes it to your hooks.

## Wiring order

```
app.use(sessionMiddleware)   // 1. populate state your hooks read
passkeyAuth(app, config)     // 2. mount ceremony endpoints
app.fsRoutes()               // 3. file-based routes
```

- **After** session middleware: `getSessionUserId`, `onRegistered`, and
  `onAuthenticated` receive `context.state`. If `passkeyAuth` runs first, that
  state is empty and `getSessionUserId` always sees "signed out".
- **Before** `fsRoutes`: the ceremony routes are registered with `app.get` /
  `app.post` and need to take priority over your file routes.

## Required fields

| Field              | Type                                                                  | Purpose                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rpId`             | `string`                                                              | Relying-Party ID: the registrable domain that scopes credentials (`example.com`, `localhost` in dev). Must match the origin the browser reports, or verification fails. No scheme, no port.           |
| `rpName`           | `string`                                                              | Human-readable service name shown in the OS/browser passkey dialog and stored in the authenticator.                                                                                                   |
| `store`            | `PasskeyStore`                                                        | Storage port. The plugin persists challenges and credentials, and reads back the little user data it needs, only through this. See [storage-port.md](./storage-port.md).                              |
| `getSessionUserId` | `(state: State) => string \| null`                                    | Returns the signed-in user's id, or `null` when nobody is signed in. Gates the add-passkey ceremony (both phases) and is read on authenticate finish.                                                 |
| `onRegistered`     | `(verified: VerifiedRegistration, state: State) => Promise<Response>` | Runs after a registration is cryptographically verified. **You** create the account, persist the first credential, start the session, and return the HTTP `Response`. Body **must** include `userId`. |
| `onAuthenticated`  | `(userId: string, state: State) => Promise<Response>`                 | Runs after a login is verified. **You** start the session and return the `Response`. Body **must** include `user`.                                                                                    |

### `VerifiedRegistration` (passed to `onRegistered`)

```ts
type VerifiedRegistration = {
  pendingUserId: string; // temporary WebAuthn user handle from the begin phase
  username: string; //      validated username
  credentialId: string; //  base64url
  publicKey: string; //     base64url
  counter: number; //       initial signature counter
  transports: string | null; // JSON-stringified array, or null
};
```

`pendingUserId` is **not** an account id: no account exists until your
`onRegistered` commits one. Persist the credential with whatever real user id
you mint (or reuse `pendingUserId` if that suits your model).

### Hook response contracts

The browser client parses these fields back out of your responses:

- `onRegistered` → JSON body with `userId` → client `register()` resolves to
  `{ userId }`.
- `onAuthenticated` → JSON body with `user` (any shape you like) → client
  `login()` resolves to `{ user }`.

Status codes and extra headers (e.g. `Set-Cookie`) are yours to set.

## Optional fields

| Field              | Type                                   | Default                                                                                | Purpose                                                                                                                                                                  |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `basePath`         | `string`                               | `/api/auth`                                                                            | Prefix under which all ceremony endpoints are mounted.                                                                                                                   |
| `paths`            | `Partial<PasskeyPaths>`                | `{ register: "/register", addPasskey: "/add-passkey", authenticate: "/authenticate" }` | Override individual endpoint segments. Unspecified segments keep defaults; each is appended to `basePath`.                                                               |
| `expectedOrigin`   | `(request: Request) => string`         | `request.headers.get("origin") ?? new URL(request.url).origin`                         | The origin credential verification must require. Override behind a reverse proxy or when the request's own origin isn't the one to enforce.                              |
| `validateUsername` | `(username: string) => string \| null` | none                                                                                   | Username policy. Return `null` to accept, or an error message to reject (surfaced to the client as a 400). Runs on **both** the begin and finish phases of registration. |

### `expectedOrigin`

WebAuthn verification checks the origin embedded in the signed credential
against an expected value. By default the plugin derives it from the request
(`Origin` header, then request URL). Behind a TLS-terminating proxy the
in-process origin may be `http://internal:8000` while the browser saw
`https://example.com`. Set `expectedOrigin` to return the public origin:

```ts
expectedOrigin: () => "https://example.com",
```

### `validateUsername`

```ts
validateUsername: (username) => {
  const trimmed = username.trim();
  if (trimmed.length < 3) return "Username must be at least 3 characters";
  if (!/^[a-z0-9_]+$/i.test(trimmed)) return "Letters, digits, underscore only";
  return null; // accept
},
```

Because it runs in both phases, keep it pure and deterministic: a username that
passes the begin phase must still pass at finish, or the ceremony fails.

## Endpoint paths

With defaults, these six routes are mounted:

| Ceremony     | Begin (GET)                          | Finish (POST)            |
| ------------ | ------------------------------------ | ------------------------ |
| Register     | `/api/auth/register?username=<name>` | `/api/auth/register`     |
| Add passkey  | `/api/auth/add-passkey`              | `/api/auth/add-passkey`  |
| Authenticate | `/api/auth/authenticate`             | `/api/auth/authenticate` |

Customizing them:

```ts
passkeyAuth(app, {
  // ...
  basePath: "/auth",
  paths: { register: "/signup" }, // -> /auth/signup ; others keep defaults
});
```

> **The browser client must use the same `basePath`/`paths`.** Pass identical
> values to `createPasskeyClient`, or the client will POST to URLs that don't
> exist and get a 404. See [client-usage.md](./client-usage.md).

### Request / response bodies

| Endpoint     | Method | Request                                      | Success response                       |
| ------------ | ------ | -------------------------------------------- | -------------------------------------- |
| register     | GET    | `?username=<name>`                           | `{ challengeId, options }` (200)       |
| register     | POST   | `{ challengeId, username, credential }`      | your `onRegistered` body (e.g. 201)    |
| add-passkey  | GET    | none (session required)                      | `{ challengeId, options }` (200)       |
| add-passkey  | POST   | `{ challengeId, credential }` (session req.) | `{ ok: true, credentialId }` (201)     |
| authenticate | GET    | none                                         | `{ challengeId, options }` (200)       |
| authenticate | POST   | `{ challengeId, credential }`                | your `onAuthenticated` body (e.g. 200) |

You normally never build these by hand: the browser client does. They're listed
for debugging and for non-JS clients. Full error-status mapping is in
[troubleshooting.md](./troubleshooting.md#http-status-reference).
