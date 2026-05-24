// The plugin owns the WebAuthn ceremonies, challenge lifecycle and counter
// updates, and reaches the host app only through the `PasskeyStore` port and
// the `onRegistered` / `onAuthenticated` hooks.

/** Single-use challenge record kept between a ceremony's begin and finish. */
export type ChallengeEntry = {
  challenge: string;
  expiresAt: number;
  /** Public registration: provisional user id encoded into WebAuthn `user.id`. */
  pendingUserId?: string;
  username?: string;
  /** Add-passkey ceremony: the already-authenticated user id. */
  addPasskeyUserId?: string;
};

/** A persisted credential, as the host stores it. `publicKey` is base64url. */
export type StoredPasskey = {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string | null;
};

/** Result of a verified public registration; the host persists this atomically. */
export type VerifiedRegistration = {
  pendingUserId: string;
  username: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string | null;
};

/**
 * Storage port. Every method sits on the request critical path and returns a
 * value, so this is a plain async interface rather than an event emitter. The
 * host supplies one implementation (Drizzle, in-memory, Redis, ...).
 */
export interface PasskeyStore {
  putChallenge(
    challengeId: string,
    entry: ChallengeEntry,
  ): Promise<void> | void;
  /** Read-and-delete: returns the entry once, then forgets it. */
  takeChallenge(
    challengeId: string,
  ): Promise<ChallengeEntry | null> | ChallengeEntry | null;
  findPasskey(
    credentialId: string,
  ): Promise<StoredPasskey | null> | StoredPasskey | null;
  /** Used to build `excludeCredentials` for the add-passkey ceremony. */
  listPasskeys(userId: string): Promise<StoredPasskey[]> | StoredPasskey[];
  savePasskey(passkey: StoredPasskey): Promise<void> | void;
  bumpCounter(credentialId: string, counter: number): Promise<void> | void;
  /** Whether any credential exists at all (drives the login "no passkeys" case). */
  hasAnyPasskeys(): Promise<boolean> | boolean;
  /** Display name for the add-passkey ceremony. */
  getUsername(userId: string): Promise<string | null> | string | null;
}

/**
 * Plugin configuration. The plugin owns ceremonies + challenge lifecycle +
 * counter updates; identity, the user model and sessions stay host-side and are
 * reached through the hooks below. The hooks receive the host's request state
 * (`context.state`) so the plugin never forces a context shape on the host.
 */
export interface PasskeyConfig<State> {
  rpId: string;
  rpName: string;
  store: PasskeyStore;
  /** Endpoint prefix; defaults to `/api/auth`. */
  basePath?: string;
  /** Override expected WebAuthn origin; defaults to the request origin. */
  expectedOrigin?: (request: Request) => string;
  /** Host-owned username policy; runs before public registration begins. */
  validateUsername?: (username: string) => string | null;
  /** Identity hook: the current user id, or null when unauthenticated. */
  getSessionUserId: (state: State) => string | null;
  /** Host persists user + passkey + session and returns the HTTP response. */
  onRegistered: (
    verified: VerifiedRegistration,
    state: State,
  ) => Promise<Response>;
  /** Host creates its session for `userId` and returns the HTTP response. */
  onAuthenticated: (
    userId: string,
    state: State,
  ) => Promise<Response>;
}
