// Server entry for the passkey plugin. Islands import `../client/mod.ts`
// directly so no server code leaks into client bundles.
export { passkeyAuth } from "./plugin.ts";
export type {
  ChallengeEntry,
  PasskeyConfig,
  PasskeyStore,
  StoredPasskey,
  VerifiedRegistration,
} from "./types.ts";
