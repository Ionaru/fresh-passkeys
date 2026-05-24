// In-memory PasskeyStore for ceremony/plugin tests. Enforces challenge expiry
// inside `takeChallenge` (the storage-port contract puts expiry enforcement
// here, not in the ceremony) and records calls so tests can assert what the
// plugin persisted.

import type {
  ChallengeEntry,
  PasskeyStore,
  StoredPasskey,
} from "../../src/server/types.ts";

export class MemoryStore implements PasskeyStore {
  readonly challenges: Map<string, ChallengeEntry> = new Map();
  readonly passkeys: Map<string, StoredPasskey> = new Map();
  readonly setCounterCalls: Array<{ credentialId: string; counter: number }> =
    [];

  saveChallenge(challengeId: string, entry: ChallengeEntry): void {
    this.challenges.set(challengeId, entry);
  }

  /** Read-and-delete; expired entries are treated as absent and discarded. */
  takeChallenge(challengeId: string): ChallengeEntry | null {
    const entry = this.challenges.get(challengeId);
    if (!entry) return null;
    this.challenges.delete(challengeId);
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  }

  findPasskey(credentialId: string): StoredPasskey | null {
    return this.passkeys.get(credentialId) ?? null;
  }

  listPasskeys(userId: string): StoredPasskey[] {
    return [...this.passkeys.values()].filter((p) => p.userId === userId);
  }

  createPasskey(passkey: StoredPasskey): void {
    this.passkeys.set(passkey.credentialId, passkey);
  }

  setCounter(credentialId: string, counter: number): void {
    this.setCounterCalls.push({ credentialId, counter });
    const existing = this.passkeys.get(credentialId);
    if (existing) existing.counter = counter;
  }

  hasAnyPasskeys(): boolean {
    return this.passkeys.size > 0;
  }

  findUsername(userId: string): string | null {
    return this.usernames.get(userId) ?? null;
  }

  /** Single source of truth for usernames, keyed by user id. */
  readonly usernames: Map<string, string> = new Map();
}

/** Which PasskeyStore method a FailingStore should throw from. */
export type FailingMethod = keyof PasskeyStore;

/**
 * Store whose chosen method throws, to drive begin-phase 500s and other
 * failure branches. All other methods behave like an empty MemoryStore.
 */
export function failingStore(
  method: FailingMethod,
  error: Error = new Error("store boom"),
): PasskeyStore {
  const base = new MemoryStore();
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === method) {
        return () => Promise.reject(error);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
