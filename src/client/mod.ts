// Client entry for the passkey plugin. Islands import this directly; it pulls
// in no server code so nothing leaks into client bundles.
export { createPasskeyClient } from "./client.ts";
export type {
  PasskeyClient,
  PasskeyClientConfig,
  WebAuthnErrorCode,
} from "./types.ts";

// `WebAuthnError` is the value-level error class (browser-only, the server's
// verify functions throw plain `Error`), kept on this island-safe entry so host
// apps can do typed error handling without importing `@simplewebauthn/browser`.
export { WebAuthnError } from "@simplewebauthn/browser";
