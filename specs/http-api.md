# HTTP API

This document specifies the HTTP endpoints the plugin mounts and the status
codes it returns. See also [Ceremonies](./ceremonies.md) for the behavior behind
each endpoint and [Configuration](./configuration.md) for how the base path is
set.

All endpoints live under a configurable base path, which defaults to
`/api/auth`. Each ceremony's segment can also be overridden individually; the
paths below are the defaults, written relative to that base. Each ceremony
exposes a pair: a GET that begins it and a POST that finishes it. Begin
responses carry a challenge identifier and the options the browser needs; the
matching finish request must echo that challenge identifier back.

## Registration

### GET `/register`

Begins account creation. Takes the desired username as a query input. The
username is required and, if a validator is configured, must pass it.

- **Success — 200.** Returns the challenge identifier and the registration
  options.
- **Bad request — 400.** Username missing or rejected by the validator.
- **Server error — 500.** Unexpected failure while beginning.

### POST `/register`

Finishes account creation. Takes the challenge identifier, the username, and the
signed credential.

- **Success.** The status and body are produced by the host's registered hook,
  which creates the account and session. See
  [Configuration](./configuration.md).
- **Bad request — 400.** Malformed request body, a missing field, a username
  rejected by the validator, a username that does not match the one from the
  begin phase, or a challenge that is missing, expired, or malformed.
- **Unauthorized — 401.** Any other verification failure (for example an invalid
  signature or an origin mismatch).

## Add passkey

These endpoints require an active session throughout.

### GET `/add-passkey`

Begins enrolling an additional credential for the signed-in user.

- **Success — 200.** Returns the challenge identifier and the registration
  options.
- **Unauthorized — 401.** No signed-in user.
- **Server error — 500.** Unexpected failure while beginning.

### POST `/add-passkey`

Finishes enrolling the additional credential. Takes the challenge identifier and
the signed credential.

- **Success — 201.** Confirms the enrollment and returns the new credential
  identifier.
- **Bad request — 400.** A missing field, or a challenge that is missing,
  expired, or malformed.
- **Unauthorized — 401.** No signed-in user, a challenge not bound to the
  signed-in user, or any other verification failure.

## Authentication

### GET `/authenticate`

Begins a login. Takes no inputs.

- **Success — 200.** Returns the challenge identifier and the authentication
  options.
- **Not found — 404.** No passkeys are registered anywhere, so there is nothing
  to authenticate against.
- **Server error — 500.** Any other unexpected failure while beginning.

### POST `/authenticate`

Finishes the login. Takes the challenge identifier and the signed credential.

- **Success.** The status and body are produced by the host's authenticated
  hook, which establishes the session. See [Configuration](./configuration.md).
- **Bad request — 400.** A missing field, or a challenge that is missing,
  expired, or malformed.
- **Not found — 404.** The presented credential matches no stored credential.
- **Unauthorized — 401.** Any other verification failure, including a signature
  counter that fails to advance.

## Status-code summary

The finish phases map outcomes to status codes consistently:

| Condition                                                                    | Status |
| ---------------------------------------------------------------------------- | ------ |
| Malformed body, missing field, username mismatch, or username policy failure | 400    |
| Challenge missing, expired, or malformed                                     | 400    |
| Presented credential is unknown                                              | 404    |
| No passkeys registered, on authentication begin                              | 404    |
| Not signed in, on a session-gated endpoint                                   | 401    |
| Any other verification failure                                               | 401    |
| Unexpected failure during a begin phase                                      | 500    |
