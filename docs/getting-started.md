# Getting started

This guide takes you from nothing to a working passkey register + login in a
Fresh 2.x app. It uses a throwaway in-memory store so you can see it run; swap
in a real store from [storage-port.md](./storage-port.md) before shipping.

## 1. Install

```sh
deno add jsr:@ionaru/fresh-passkeys
```

Then import from the two entry points:

```ts
import { passkeyAuth } from "@ionaru/fresh-passkeys/server";
import { createPasskeyClient } from "@ionaru/fresh-passkeys/client";
```

> **Known issue:** the package is currently being published under a name that
> JSR may still reject as unscoped: if `deno add` fails, check the latest
> published version on JSR and adjust the import specifier to match. Everything
> below is unaffected once the import resolves.

## 2. Prerequisites

WebAuthn only runs in a **secure context**:

- **Production:** HTTPS with a valid certificate.
- **Development:** `http://localhost` is treated as secure, so `deno task dev`
  works without TLS.

Your `rpId` must equal the **registrable domain** the app is served from
(`example.com`, or `localhost` in dev), not a full URL, no scheme, no port. A
mismatch makes every verification fail. See
[troubleshooting.md](./troubleshooting.md).

## 3. Server wiring

Call `passkeyAuth(app, config)` **after** the middleware that populates the
session state your hooks read, and **before** `app.fsRoutes()`. Order matters:
see [configuration.md](./configuration.md#wiring-order).

```ts
// main.ts
import { App } from "fresh";
import { passkeyAuth } from "@ionaru/fresh-passkeys/server";

// Your app's State must carry whatever your hooks read (here: a user id).
interface State {
  userId: string | null;
}

// Dev-only in-memory store. NOT for production; see docs/storage-port.md.
import { MemoryStore } from "./dev_store.ts";
const store = new MemoryStore();

export const app = new App<State>();

// 1. Session middleware FIRST: populates state.userId from the session cookie.
app.use(async (context) => {
  context.state.userId = await readUserIdFromSession(context.req);
  return context.next();
});

// 2. Passkey endpoints: mounted under /api/auth by default.
passkeyAuth(app, {
  rpId: "localhost", // your registrable domain in production
  rpName: "Example",
  store,

  // Identity hook: who is signed in? null when nobody is.
  getSessionUserId: (state) => state.userId,

  // Called after a verified registration. You create the account + session.
  onRegistered: async (verified, _state) => {
    const userId = await createUser(verified.username);
    await store.createPasskey({
      userId,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: verified.transports,
    });
    store.usernames.set(userId, verified.username);
    const headers = await startSession(userId); // set your session cookie
    // The client reads `userId` from this body. It MUST be present.
    return Response.json({ userId }, { status: 201, headers });
  },

  // Called after a verified login. You create the session.
  onAuthenticated: async (userId, _state) => {
    const headers = await startSession(userId);
    const username = store.usernames.get(userId) ?? null;
    // The client reads `user` from this body. It MUST be present.
    return Response.json({ user: { id: userId, username } }, { headers });
  },
});

// 3. File-based routes LAST.
app.fsRoutes();
```

> Registration verifies the credential and hands you a `VerifiedRegistration`,
> but **the plugin does not create the user**: until `onRegistered` runs and
> persists it, no account exists. The `pendingUserId` on `verified` is only the
> temporary WebAuthn user handle; mint your own real id (as above) or use it,
> your choice.

## 4. The two hook contracts that bite people

The browser client reads specific fields back out of your hook responses. If
they are missing, the client throws even though the ceremony succeeded:

| Hook              | Response body must include | Client returns |
| ----------------- | -------------------------- | -------------- |
| `onRegistered`    | `userId` (string)          | `{ userId }`   |
| `onAuthenticated` | `user` (any shape)         | `{ user }`     |

The `user` shape is entirely yours: the client types it as a generic `User`.

## 5. Client wiring (an island)

```tsx
// islands/PasskeyForm.tsx
import { useState } from "preact/hooks";
import {
  createPasskeyClient,
  WebAuthnError,
} from "@ionaru/fresh-passkeys/client";

const passkeys = createPasskeyClient(); // defaults to /api/auth

export default function PasskeyForm() {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function register() {
    setError(null);
    try {
      const { userId } = await passkeys.register(username);
      globalThis.location.href = `/welcome?u=${userId}`;
    } catch (caught) {
      // User dismissed the prompt, or the server rejected it.
      if (caught instanceof WebAuthnError) {
        setError(`Passkey error: ${caught.code}`);
      } else setError(caught instanceof Error ? caught.message : "Failed");
    }
  }

  async function login() {
    setError(null);
    try {
      const { user } = await passkeys.login();
      console.log("signed in", user);
      globalThis.location.href = "/";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed");
    }
  }

  return (
    <div>
      <input
        value={username}
        onInput={(event) => setUsername(event.currentTarget.value)}
        placeholder="username"
      />
      <button onClick={register}>Create account</button>
      <button onClick={login}>Sign in</button>
      {error && <p>{error}</p>}
    </div>
  );
}
```

The client and server resolve their URLs from the same defaults. If you
customize `basePath` or `paths` on the server, pass the **same** values to
`createPasskeyClient`, otherwise requests 404. See
[client-usage.md](./client-usage.md).

## 6. Run it

```sh
deno task dev
```

Open `http://localhost:8000`, type a username, click **Create account**. Your
browser prompts to create a passkey (Touch ID, Windows Hello, a security key, or
your phone). On success the island redirects and a row exists in your store.
Click **Sign in** on a fresh visit to log back in with no username: passkeys are
discoverable.

## Next steps

- Replace the dev store with a real one: [storage-port.md](./storage-port.md).
- Tune origins, paths, and username rules:
  [configuration.md](./configuration.md).
- Add "add another passkey" for signed-in users:
  [client-usage.md](./client-usage.md#add-a-passkey).
- When something fails: [troubleshooting.md](./troubleshooting.md).
