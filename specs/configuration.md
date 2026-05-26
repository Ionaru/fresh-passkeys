# Configuration

This document specifies what the host supplies when it mounts the plugin: the
required and optional configuration, and the hooks through which the plugin
hands control back to the host. See also [Overview](./overview.md),
[Storage Port](./storage-port.md), and [HTTP API](./http-api.md).

The host mounts the plugin by registering it against its Fresh application and
passing a single configuration object. Registration must happen **after** the
middleware that populates session state (so the session hooks can read it) and
**before** the application's file-based routes are added, so the ceremony
endpoints take priority.

## Required configuration

### Relying-party identifier

The domain that scopes the credentials, for example the site's registrable
domain. It is supplied to every ceremony and must match the origin the browser
reports, or verification fails.

### Relying-party name

A human-readable name for the service. It appears in the credential the
authenticator stores, so users recognize it when choosing a passkey.

### Store

The storage-port implementation. This is how the plugin persists challenges and
credentials and reads back the small amounts of user data the ceremonies need.
See [Storage Port](./storage-port.md).

### Session-user-id reader

A function that, given the current request's session state, returns the
signed-in user's identifier, or nothing when no one is signed in. It gates the
add-passkey ceremony and is read during the authentication finish. The plugin
treats the session state as opaque and learns the current user only through this
function.

### Registered hook

Called after a registration is verified, receiving the verified registration
result and the session state. The host owns everything that happens next: it
creates the user account, persists the first credential, establishes a session,
and returns the HTTP response that the plugin sends back to the browser. Until
this hook runs, no account exists: registration is not complete until the host
commits it here.

The response body this hook returns must carry the new user's identifier under a
`userId` field. The browser client reads that field back and returns it from its
register operation, so a hook that omits it breaks the client contract.

### Authenticated hook

Called after a login is verified, receiving the authenticated user's identifier
and the session state. The host establishes a session for that user and returns
the HTTP response. As with registration, the plugin issues no session itself; it
delegates entirely to this hook.

The response body this hook returns must carry the signed-in user under a `user`
field. The browser client reads that field back and returns it from its log-in
operation; the user's shape is entirely the host's choice, but the field must be
present or the client contract breaks.

## Optional configuration

### Base path

The prefix under which the ceremony endpoints are mounted. When omitted it
defaults to `/api/auth`. See [HTTP API](./http-api.md) for the full set of
paths.

### Endpoint path overrides

The segment for each ceremony (registration, add-passkey, and authentication)
may be overridden individually. Any segment left unspecified keeps its default.
Each override is appended to the base path, so they compose: changing both the
base path and a single segment is allowed. The same overrides must be given to
the browser client so its requests target the same paths the server mounts.

### Expected-origin override

A function that, given the request, returns the origin that credential
verification should require. When omitted, the plugin derives the expected
origin from the request itself. An override is useful behind proxies or across
multiple domains, where the request's own origin is not the one to enforce.

### Username validator

A function that checks a username before registration proceeds. It returns
nothing when the username is acceptable, or a message describing why it is not.
The message is surfaced to the caller as a client error. The validator runs in
both phases of registration.

## Ownership implications

The hooks are the only points where the plugin touches identity, and at each one
control passes fully to the host. The host decides what a user record looks
like, when an account truly exists, and how sessions are represented and issued.
The plugin commits nothing about identity on its own: it verifies the
cryptography and then asks the host to take over.
