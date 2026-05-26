# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-27

First stable release. The public API of the `./server` and `./client` exports is
now covered by Semantic Versioning.

### Added

- WebAuthn passkey plugin for Fresh 2.x, published to JSR as
  `@ionaru/fresh-passkeys`.
- `./server` export: `passkeyAuth` plugin factory, plus the `PasskeyConfig`,
  `PasskeyStore`, `StoredPasskey`, `ChallengeEntry`, and `VerifiedRegistration`
  types.
- `./client` export: `createPasskeyClient` factory, the `PasskeyClient`,
  `PasskeyClientConfig`, and `WebAuthnErrorCode` types, and a re-exported
  `WebAuthnError` class for typed, island-safe error handling.
- Three ceremonies, each mounting a GET (begin) and POST (finish) endpoint:
  registration, authentication, and add-a-passkey for a signed-in user.
- Dependency-inverted design: the plugin owns ceremony crypto but persists
  nothing. The host implements the `PasskeyStore` port and a
  `getSessionUserId()` hook.
- Single-use challenge handling with a 5-minute TTL enforced by the store's
  `takeChallenge()` (read-and-delete); expired entries are treated as absent.
- Configurable endpoint locations via `basePath` (default `/api/auth`) and
  per-ceremony `paths` overrides, shared by server and client through
  `resolvePaths`.
- Configurable `expectedOrigin`, falling back to the `Origin` header and then
  the request URL origin.
- Replay protection: authentication rejects a non-advancing signature counter.

[Unreleased]: https://github.com/Ionaru/fresh-passkeys/compare/1.0.0...HEAD
[1.0.0]: https://github.com/Ionaru/fresh-passkeys/releases/tag/1.0.0
