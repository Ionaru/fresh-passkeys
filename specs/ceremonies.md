# Ceremonies

This document specifies the authentication ceremonies the plugin performs, the
lifecycle of the challenges they rely on, and the replay protection that secures
logins. It is the behavioral heart of the plugin. See also
[Overview](./overview.md), [HTTP API](./http-api.md), and
[Storage Port](./storage-port.md).

Every ceremony runs in two phases against a paired set of endpoints:

- A **begin** phase that produces a fresh challenge plus the options the
  browser's WebAuthn interaction needs, and persists the challenge for later.
- A **finish** phase that receives the signed result from the browser, retrieves
  and consumes the stored challenge, verifies the result cryptographically, and
  either persists a credential or hands control to the host.

There are three ceremonies: **public registration**, **add passkey**, and
**authentication**.

## Public registration

This ceremony creates a brand-new account together with its first passkey. It is
open — it does not require an existing session.

### Begin

1. The host-supplied username is trimmed. An empty username is rejected. If a
   username validator is configured, it runs and any failure stops the ceremony
   with a validation message.
2. A provisional user identifier is generated. This is a random value used only
   to populate the WebAuthn user handle during credential creation; it is not
   yet a real account identifier.
3. Registration options are generated under a fixed policy:
   - the relying-party name and identifier come from configuration;
   - the username is used for both the account name and its display name;
   - attestation is requested as "none", so no authenticator vendor chain needs
     to be verified;
   - a resident (discoverable) credential is required, which is what enables
     later passwordless login;
   - user verification is preferred;
   - the exclude list is empty, because this is a new account with no prior
     credentials.
4. A challenge identifier is generated. The challenge — together with its
   expiry, the provisional user identifier, and the validated username — is
   persisted.
5. The challenge identifier and the options are returned to the browser.

### Finish

1. The submitted challenge identifier, username, and signed credential are all
   required.
2. The username is validated again under the same policy, then compared against
   the username captured during the begin phase. The comparison is exact after
   trimming and is case-sensitive; a mismatch stops the ceremony.
3. The stored challenge is retrieved and consumed (read-and-deleted). If it is
   missing, expired, or does not carry the provisional user identifier and
   username, the ceremony fails as an invalid challenge.
4. The credential is verified against the stored challenge, the expected origin,
   and the relying-party identifier.
5. On success the verified credential — the provisional user identifier, the
   username, the credential identifier, the public key, the starting counter,
   and the transports — is handed to the host's registration hook. The host
   creates the account, persists the credential, establishes a session, and
   returns the HTTP response. The plugin itself does not create users or
   sessions.

## Add passkey

This ceremony enrolls an additional passkey onto an account that is already
signed in. It is session-gated throughout.

### Begin

1. The current session's user identifier is read. If there is none, the ceremony
   is refused as unauthorized.
2. The username for that user is read back from storage and used for the
   credential's account and display names.
3. All credentials already registered to that user are read and placed on the
   exclude list, so the authenticator will not enroll a duplicate of a
   credential the user already has.
4. Registration options are generated under the same policy as public
   registration, but with the real user identifier.
5. A challenge is persisted, tagged with the authenticated user identifier, and
   its identifier and options are returned.

### Finish

1. The current session's user identifier is required; an unauthenticated request
   is refused.
2. The submitted challenge identifier and signed credential are required.
3. The stored challenge is retrieved and consumed. It must carry an add-passkey
   user identifier that matches the authenticated user; otherwise the ceremony
   fails as an invalid challenge. This binds the challenge to the user who began
   it.
4. The credential is verified against the stored challenge, the expected origin,
   and the relying-party identifier.
5. On success the new credential is persisted directly through the storage port,
   and the credential identifier is returned. Because the account already
   exists, no host hook is involved.

## Authentication

This ceremony logs an existing user in using a discoverable credential, so the
user need not type a username.

### Begin

1. The store is asked whether any passkey exists at all. If none do, the
   ceremony fails with a "no passkeys registered" condition, which the host can
   surface as a distinct state rather than a generic error.
2. Authentication options are generated from the relying-party identifier with a
   preferred user-verification setting.
3. A challenge is persisted with no ceremony-specific identity fields, and its
   identifier and options are returned.

### Finish

1. The submitted challenge identifier and signed credential are required.
2. The stored challenge is retrieved and consumed; a missing or expired
   challenge fails as invalid.
3. The credential identifier is extracted from the signed result and used to
   look up the stored passkey. A missing identifier fails as a generic
   verification failure; an identifier that matches no stored credential fails
   as an unknown credential.
4. The credential is verified against the stored challenge, the expected origin,
   the relying-party identifier, and the stored public key and counter.
5. On success the stored counter is advanced to the new value reported by
   verification, and the owning user identifier is handed to the host's
   authenticated hook. The host establishes a session and returns the HTTP
   response.

## Challenge lifecycle

- **Single use.** Every finish phase retrieves its challenge with a
  read-and-delete operation. A challenge can therefore be consumed exactly once;
  a replayed finish request finds nothing and fails.
- **Expiry.** Each challenge is stored with an expiry five minutes after
  creation. The plugin records this expiry; enforcing it — refusing or
  discarding a challenge whose expiry has passed — is part of the storage port's
  contract, not re-checked inside the ceremony. See
  [Storage Port](./storage-port.md).
- **Ceremony discrimination.** A stored challenge carries different identity
  fields depending on which ceremony created it: a provisional user identifier
  and username for public registration, an authenticated user identifier for add
  passkey, and no identity fields for authentication. The finish phase checks
  for the fields its ceremony expects, which prevents a challenge minted for one
  ceremony from being consumed by another.

## Replay protection

WebAuthn authenticators maintain a signature counter that increases with each
assertion. The plugin uses it to detect cloned authenticators.

- A counter value is stored per credential, captured at registration and updated
  on every successful login.
- Verification requires the counter reported by a new assertion to be strictly
  greater than the stored value. A counter that fails to advance indicates the
  private key may have been copied, and verification fails.
- On a successful login the stored counter is advanced to the newly reported
  value before the host hook runs, so the next login is checked against it.
- Counters are independent per credential; an assertion from one credential is
  never checked against another's counter.
