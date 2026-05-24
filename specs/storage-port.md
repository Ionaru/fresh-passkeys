# Storage Port

This document specifies the storage port — the set of capabilities the host
implements so the plugin can persist and retrieve challenges and credentials —
and the data shapes that cross the boundary between plugin and host. See also
[Overview](./overview.md), [Ceremonies](./ceremonies.md), and
[Configuration](./configuration.md).

The plugin never accesses a database directly. It calls the capabilities below
and the host backs them with any store it chooses. Each capability may be
implemented synchronously or asynchronously; the plugin awaits all of them.
Every capability sits on a request's critical path, so implementations should be
inexpensive.

## Capabilities

### Persist a challenge

Stores a challenge record under a challenge identifier. Called during every
begin phase. The record carries the challenge value, its expiry, and any
ceremony-specific identity fields.

### Take a challenge

Retrieves the challenge record for an identifier and removes it in the same
operation, so a challenge can be consumed only once. Returns nothing when no
record exists. The implementation is also the enforcement point for expiry: a
record whose expiry has passed must be treated as absent (returned as nothing,
and ideally discarded). Called during every finish phase.

### Find a passkey

Looks up a single stored credential by its credential identifier, returning
nothing if none matches. Used during login and during add-passkey verification
to recover the public key and counter needed to verify an assertion.

### List passkeys

Returns every credential belonging to a given user. Used during the add-passkey
begin phase to build the exclude list that prevents enrolling a duplicate
credential.

### Save a passkey

Persists a newly verified credential. Called when an additional passkey is
verified; the registration path persists through the host's registration hook
instead, but supplies the same credential shape.

### Bump a counter

Advances the stored signature counter for a credential to a new value. Called
after every successful login to keep replay protection current. See the replay
protection section of [Ceremonies](./ceremonies.md).

### Has any passkeys

Reports whether at least one credential exists anywhere in the system. Used at
the start of the authentication ceremony so the host can distinguish a "nothing
is registered yet" state from a genuine failure.

### Get username

Returns the stored username for a user identifier, or nothing if the user is not
found. Used during the add-passkey begin phase to populate the credential's
account and display names.

## Data shapes

The following describe the information that crosses the boundary, not any
particular representation. Credential identifiers and public keys are exchanged
as base64url-encoded text so they remain safe to store and transmit as strings.

### Challenge entry

What the plugin asks the host to persist for an in-flight ceremony:

- the challenge value issued for the ceremony;
- an expiry timestamp, set five minutes after creation;
- ceremony-specific identity fields: a provisional user identifier and username
  for registration, an authenticated user identifier for add passkey, and none
  for authentication.

### Stored passkey

What the host persists for each enrolled credential:

- the identifier of the user who owns it;
- the credential identifier;
- the credential's public key;
- the current signature counter;
- the credential's transports, if the authenticator reported any.

### Verified registration result

What the plugin hands to the host's registration hook after a registration is
verified, so the host can create the account and its first credential together:

- the provisional user identifier generated during the ceremony;
- the validated username;
- the credential identifier;
- the public key;
- the starting counter value;
- the transports, if any.
