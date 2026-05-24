# Client

This document specifies the browser-side helper the plugin provides. See also
[Overview](./overview.md), [HTTP API](./http-api.md), and
[Ceremonies](./ceremonies.md).

The client is a thin, interface-free helper that drives the ceremony endpoints
from the host's own components. It renders nothing and dictates no markup; it
only relays the browser's WebAuthn interaction to and from the server. Because
it imports no server code, it is safe to use inside interactive client
components.

## Creating a client

The host creates a client from a factory, optionally giving it a base path. When
the base path is omitted it defaults to `/api/auth`, matching the server's
default. The base path the client is created with must match where the host
mounted the endpoints. The resulting client exposes three operations: register,
log in, and add a passkey.

## Two-phase operation

Each operation follows the same shape as the ceremony it drives: a GET to begin,
which fetches the challenge identifier and options; then the native browser
WebAuthn interaction, carried out through the underlying browser WebAuthn
library; then a POST to finish, which sends the challenge identifier together
with the signed credential. All requests are made same-origin so the host's
session cookie travels with them.

### Register

Begins registration for a given username, prompts the browser to create a new
passkey, and finishes by submitting the result. On success it yields the
identifier of the newly created user.

### Log in

Begins authentication, prompts the browser to select and use a discoverable
passkey, and finishes by submitting the assertion. On success it yields the
signed-in user. The shape of that user is whatever the host's authenticated hook
returns — the client treats it generically and the plugin never dictates the
user model.

### Add a passkey

Begins enrollment for the already signed-in user, prompts the browser to create
an additional passkey, and finishes by submitting the result. On success it
yields the new credential's identifier. Because it relies on the session, it is
only meaningful when a user is signed in.

## Errors

When an endpoint responds with a failure, the client raises an error carrying
the server's message when one is present and otherwise a fallback that includes
the HTTP status, so the host can react to begin- and finish-phase failures
uniformly. The plugin also re-exports the underlying library's typed WebAuthn
error so the host can distinguish and handle authenticator-level failures — such
as a user dismissing the prompt — without taking a direct dependency on that
library.
