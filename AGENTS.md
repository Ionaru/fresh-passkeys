# AGENTS.md

WebAuthn passkey plugin for Fresh 2.x, published to JSR. Deno, TypeScript.
Behavioral specs live in `specs/`; read the relevant one before changing
ceremony, storage, HTTP, or client behavior.

## Naming

- No single-letter names for variables, parameters, functions, or any other
  identifier.
- No abbreviated or shortened words. Spell names out in full.
  - Use `error`, not `e` or `err`.
  - Use `message`, not `msg`.
  - Use `request`, not `req`; `response`, not `res`.
- Apply the same rules to type parameters (generics): use `Type`, `Element`,
  `Key`, etc., not `T`, `E`, `K`.

## Commands

- `deno task check`: `deno fmt --check . && deno lint . && deno check`. Run
  before considering work done.
- `deno task fix`: auto-format and lint-fix.
- `deno task test`: runs with a custom import-map that mocks
  `@simplewebauthn/*`. Tests fail without it.
- Single test file:
  `deno test -A --import-map=tests/import-map.json tests/ceremonies_test.ts`
- `deno task coverage`: coverage report excluding `tests/`.

## Code style

- Lint forbids `!` non-null assertion (`no-non-null-assertion`). In tests use
  `must()` from `tests/support/must.ts` instead.
- `eqeqeq` (`===` only), no Node/`process` globals. `strict` +
  `noUncheckedIndexedAccess` + `isolatedDeclarations` on.

## Architecture

- Two separate JSR exports: `./server` (`src/server/mod.ts`) and `./client`
  (`src/client/mod.ts`). Keep server code out of the client export: it ships to
  the browser bundle.
- Dependency-inverted: the plugin owns ceremony crypto but persists nothing
  itself. The host implements the `PasskeyStore` port and a `getSessionUserId()`
  hook. Don't add direct DB/session access to the plugin.
- Challenge TTL (5 min) is enforced by the store's `takeChallenge()`
  (read-and-delete, single-use), NOT by the plugin. Expired entries are treated
  as absent.
- Each ceremony mounts GET (begin) + POST (finish) under a configurable base
  path (`/api/auth` default). Same paths must be passed to the browser client.

## Tests

- Mocks of `@simplewebauthn/server` and `@simplewebauthn/browser` are swapped in
  via `tests/import-map.json`; keep mock shapes matching the real v13 library.
- `tests/support/`: `memory_store.ts` (in-memory `PasskeyStore` with call
  tracking + TTL enforcement), `fixtures.ts` (credential/challenge data),
  `must.ts`.
