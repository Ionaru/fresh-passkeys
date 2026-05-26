# Client usage

The browser client is a thin wrapper around the WebAuthn ceremony: it GETs the
options + challenge, drives the native `navigator.credentials` prompt, POSTs the
signed result, and returns what your server hooks put in the response. It
renders **no UI**: markup is entirely yours.

Import it from the client entry point (safe in islands):

```ts
import {
  createPasskeyClient,
  WebAuthnError,
  type WebAuthnErrorCode,
} from "@ionaru/fresh-passkeys/client";
```

> Only import `@ionaru/fresh-passkeys/client` in islands/browser code. The
> `/server` export must never reach the browser bundle.

## Creating a client

```ts
const passkeys = createPasskeyClient(); // defaults to /api/auth
```

If you customized `basePath`/`paths` on the server, pass the **same** values
here, otherwise the client POSTs to URLs that don't exist (404):

```ts
const passkeys = createPasskeyClient({
  basePath: "/auth",
  paths: { register: "/signup" },
});
```

All requests are sent with `credentials: "same-origin"`, so your session cookie
travels with them: that's how add-passkey knows who is signed in.

## Methods

| Method               | Returns                     | When to call                                   |
| -------------------- | --------------------------- | ---------------------------------------------- |
| `register(username)` | `Promise<{ userId }>`       | New account + its first passkey.               |
| `login<User>()`      | `Promise<{ user: User }>`   | Passwordless, discoverable-credential sign-in. |
| `addPasskey()`       | `Promise<{ credentialId }>` | Add another passkey to the signed-in account.  |

- `register` returns the `userId` your `onRegistered` hook put in its response.
- `login` returns the `user` your `onAuthenticated` hook put in its response;
  type it with the generic: `await passkeys.login<MyUser>()`.
- `addPasskey` returns the new credential's id; it requires an active session.

All three **throw** on failure (see error handling below).

## A complete island

```tsx
// islands/Passkeys.tsx
import { useState } from "preact/hooks";
import {
  createPasskeyClient,
  WebAuthnError,
} from "@ionaru/fresh-passkeys/client";

interface User {
  id: string;
  username: string;
}

const passkeys = createPasskeyClient();

export default function Passkeys({ signedIn }: { signedIn: boolean }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (caught) {
      setMessage(describe(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!signedIn && (
        <>
          <input
            value={username}
            disabled={busy}
            onInput={(event) => setUsername(event.currentTarget.value)}
            placeholder="username"
          />
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { userId } = await passkeys.register(username);
                return `Registered as ${userId}`;
              })}
          >
            Create account
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { user } = await passkeys.login<User>();
                return `Welcome back, ${user.username}`;
              })}
          >
            Sign in
          </button>
        </>
      )}

      {signedIn && (
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const { credentialId } = await passkeys.addPasskey();
              return `Added passkey ${credentialId.slice(0, 8)}…`;
            })}
        >
          Add another passkey
        </button>
      )}

      {message && <p>{message}</p>}
    </div>
  );
}
```

## Error handling

Two kinds of failure surface as thrown errors:

1. **`WebAuthnError`**: raised by the browser's WebAuthn layer (re-exported so
   you don't need a direct `@simplewebauthn/browser` dependency). The most
   common is the user dismissing or cancelling the prompt. Branch on
   `error.code` (typed `WebAuthnErrorCode`).
2. **Plain `Error`**: the server rejected a begin or finish request. Its
   `message` carries the server's error text; if the response had none, it falls
   back to a message that includes the HTTP status.

```ts
function describe(caught: unknown): string {
  if (caught instanceof WebAuthnError) {
    // e.g. the user closed the OS prompt
    return `Passkey prompt failed (${caught.code})`;
  }
  if (caught instanceof Error) {
    // server-side rejection: bad username, expired challenge, etc.
    return caught.message;
  }
  return "Something went wrong";
}
```

You can treat begin- and finish-phase failures uniformly: both arrive as a
thrown `Error` with the server's message. Map specific cases (expired challenge,
"no passkeys registered", unauthorized add-passkey) using
[troubleshooting.md](./troubleshooting.md#http-status-reference).

## <a id="add-a-passkey"></a>Add a passkey

`addPasskey()` enrolls an additional credential for the **already signed-in**
user (a second device, a hardware key, etc.). It relies on the session cookie,
so:

- Only show the button when the user is signed in.
- The server gates both phases on `getSessionUserId`; an unauthenticated call
  returns 401 and the client throws.
- The plugin automatically excludes the user's existing credentials, so the same
  authenticator can't be enrolled twice.

## Secure-context reminder

`navigator.credentials` only works in a secure context: **HTTPS in production,
`localhost` in development**. On a plain-HTTP non-localhost origin the browser
refuses before any request is sent. See
[troubleshooting.md](./troubleshooting.md).
