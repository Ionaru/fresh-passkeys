# The storage port (`PasskeyStore`)

The plugin owns the WebAuthn crypto but **persists nothing itself**. Every read
and write goes through a `PasskeyStore` you implement, so you keep full control
of your database. This page documents the contract and gives three complete,
copy-pasteable implementations: a dev-only in-memory store, **Deno KV**, and
**Drizzle (PostgreSQL)**.

```ts
import type {
  ChallengeEntry,
  PasskeyStore,
  StoredPasskey,
} from "@ionaru/fresh-passkeys/server";
```

## The contract

Every method may be **sync or async**: the plugin `await`s all of them, so
returning a value or a `Promise` of it both work.

| Method                              | Returns                  | Contract                                                                                                         |
| ----------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `saveChallenge(challengeId, entry)` | `void`                   | Store a challenge record keyed by `challengeId`. Called at the start of every ceremony.                          |
| `takeChallenge(challengeId)`        | `ChallengeEntry \| null` | **Read-and-delete, single use.** Return the entry once, then forget it. Return `null` if missing **or expired**. |
| `findPasskey(credentialId)`         | `StoredPasskey \| null`  | Look up one credential by id. `null` if none. Used to load the public key + counter for login/add-passkey.       |
| `listPasskeys(userId)`              | `StoredPasskey[]`        | All credentials owned by a user. Used to build the exclude list during add-passkey (prevents duplicate enroll).  |
| `createPasskey(passkey)`            | `void`                   | Persist a newly verified credential. Called by the add-passkey ceremony, and by **you** inside `onRegistered`.   |
| `setCounter(credentialId, counter)` | `void`                   | Overwrite the stored signature counter after a successful login.                                                 |
| `hasAnyPasskeys()`                  | `boolean`                | Whether _any_ credential exists anywhere. Lets login distinguish "nothing registered yet" (404) from a failure.  |
| `findUsername(userId)`              | `string \| null`         | The username for a user, or `null`. Used to label the credential during add-passkey.                             |

### The single-use + expiry rule (important)

Challenge TTL is **5 minutes**, and the plugin does **not** re-check it: your
`takeChallenge` is the enforcement point. It must:

1. Remove the entry as it reads it (so a replayed finish request finds nothing).
2. Treat an entry whose `expiresAt` has passed as **absent** (`null`), ideally
   deleting it too.

Get this wrong and you either leak replay protection or accept stale challenges.
Every example below implements it correctly.

## Data shapes

```ts
type ChallengeEntry = {
  challenge: string; //       WebAuthn challenge (base64url)
  expiresAt: number; //       epoch ms; set 5 min ahead by the plugin
  pendingUserId?: string; //  registration only
  username?: string; //       registration only
  addPasskeyUserId?: string; // add-passkey only
};

type StoredPasskey = {
  userId: string;
  credentialId: string; //    base64url
  publicKey: string; //       base64url
  counter: number;
  transports: string | null; // JSON-stringified array, e.g. '["internal","hybrid"]'
};
```

The plugin sets the ceremony-specific identity fields on `ChallengeEntry` and
checks them on finish, so your store only needs to round-trip the whole object
faithfully: store all fields, return them unchanged.

## Where usernames come from

`findUsername` is read during add-passkey, but the plugin never writes a
username. **You** record it inside `onRegistered`, alongside the first
credential. Each example below adds a small `saveUsername(userId, username)`
helper (not part of the `PasskeyStore` interface) for your `onRegistered` to
call. Use your own users table instead if you already have one, just make
`findUsername` read from it.

---

## Example 1: In-memory (development only)

Adapted from the plugin's own test store. **Lost on restart, not safe across
multiple processes, never use it in production.** Good for `deno task dev` and
trying the flow end to end.

```ts
// dev_store.ts
import type {
  ChallengeEntry,
  PasskeyStore,
  StoredPasskey,
} from "@ionaru/fresh-passkeys/server";

export class MemoryStore implements PasskeyStore {
  readonly challenges = new Map<string, ChallengeEntry>();
  readonly passkeys = new Map<string, StoredPasskey>();
  readonly usernames = new Map<string, string>();

  saveChallenge(challengeId: string, entry: ChallengeEntry): void {
    this.challenges.set(challengeId, entry);
  }

  // Read-and-delete; expired entries are treated as absent.
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
    return [...this.passkeys.values()].filter((row) => row.userId === userId);
  }

  createPasskey(passkey: StoredPasskey): void {
    this.passkeys.set(passkey.credentialId, passkey);
  }

  setCounter(credentialId: string, counter: number): void {
    const existing = this.passkeys.get(credentialId);
    if (existing) existing.counter = counter;
  }

  hasAnyPasskeys(): boolean {
    return this.passkeys.size > 0;
  }

  findUsername(userId: string): string | null {
    return this.usernames.get(userId) ?? null;
  }

  // Helper for your onRegistered hook (not part of PasskeyStore).
  saveUsername(userId: string, username: string): void {
    this.usernames.set(userId, username);
  }
}
```

---

## Example 2: Deno KV (production starter)

[Deno KV](https://docs.deno.com/deploy/kv/manual/) is built in, needs no extra
dependencies, and runs on Deno Deploy. This store uses four key spaces:

- `["challenge", id]`: the challenge, with a native **`expireIn`** so KV evicts
  it automatically near the 5-minute mark.
- `["passkey", credentialId]`: the canonical credential record.
- `["passkey_by_user", userId, credentialId]`: a secondary index backing
  `listPasskeys`.
- `["username", userId]`: the username.

```ts
// kv_store.ts
import type {
  ChallengeEntry,
  PasskeyStore,
  StoredPasskey,
} from "@ionaru/fresh-passkeys/server";

export class KvStore implements PasskeyStore {
  constructor(private readonly kv: Deno.Kv) {}

  async saveChallenge(
    challengeId: string,
    entry: ChallengeEntry,
  ): Promise<void> {
    // Belt-and-suspenders: KV evicts near expiry, takeChallenge re-checks below.
    const expireIn = Math.max(0, entry.expiresAt - Date.now());
    await this.kv.set(["challenge", challengeId], entry, { expireIn });
  }

  // Read-and-delete (single use); expired or missing entries return null.
  async takeChallenge(challengeId: string): Promise<ChallengeEntry | null> {
    const key = ["challenge", challengeId];
    const found = await this.kv.get<ChallengeEntry>(key);
    if (found.value === null) return null;
    // Atomic delete keyed on the version we read, so a concurrent finish can't
    // consume the same challenge twice.
    await this.kv.atomic().check(found).delete(key).commit();
    if (found.value.expiresAt < Date.now()) return null;
    return found.value;
  }

  async findPasskey(credentialId: string): Promise<StoredPasskey | null> {
    const found = await this.kv.get<StoredPasskey>(["passkey", credentialId]);
    return found.value;
  }

  async listPasskeys(userId: string): Promise<StoredPasskey[]> {
    const out: StoredPasskey[] = [];
    const index = this.kv.list<string>({ prefix: ["passkey_by_user", userId] });
    for await (const entry of index) {
      const credentialId = entry.value;
      const passkey = await this.kv.get<StoredPasskey>([
        "passkey",
        credentialId,
      ]);
      if (passkey.value) out.push(passkey.value);
    }
    return out;
  }

  async createPasskey(passkey: StoredPasskey): Promise<void> {
    await this.kv.atomic()
      .set(["passkey", passkey.credentialId], passkey)
      .set(
        ["passkey_by_user", passkey.userId, passkey.credentialId],
        passkey.credentialId,
      )
      .commit();
  }

  async setCounter(credentialId: string, counter: number): Promise<void> {
    const key = ["passkey", credentialId];
    const found = await this.kv.get<StoredPasskey>(key);
    if (!found.value) return;
    await this.kv.atomic()
      .check(found)
      .set(key, { ...found.value, counter })
      .commit();
  }

  async hasAnyPasskeys(): Promise<boolean> {
    const iterator = this.kv.list({ prefix: ["passkey"] }, { limit: 1 });
    for await (const _ of iterator) return true;
    return false;
  }

  async findUsername(userId: string): Promise<string | null> {
    const found = await this.kv.get<string>(["username", userId]);
    return found.value;
  }

  // Helper for your onRegistered hook (not part of PasskeyStore).
  async saveUsername(userId: string, username: string): Promise<void> {
    await this.kv.set(["username", userId], username);
  }
}
```

Wire it up:

```ts
const kv = await Deno.openKv();
const store = new KvStore(kv);
```

> Run with `--unstable-kv` on older Deno versions. `hasAnyPasskeys` lists at
> most one key, so it stays cheap even with many credentials.

---

## Example 3: Drizzle (PostgreSQL)

Closest to a real app. Two tables; `transports` is stored exactly as the plugin
hands it to you (a JSON string or `null`).

```ts
// schema.ts
import { bigint, integer, pgTable, text } from "drizzle-orm/pg-core";

export const passkeys = pgTable("passkeys", {
  credentialId: text("credential_id").primaryKey(),
  userId: text("user_id").notNull(),
  publicKey: text("public_key").notNull(),
  counter: bigint("counter", { mode: "number" }).notNull(),
  transports: text("transports"), // JSON string or null
});

export const challenges = pgTable("challenges", {
  challengeId: text("challenge_id").primaryKey(),
  challenge: text("challenge").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(), // epoch ms
  pendingUserId: text("pending_user_id"),
  username: text("username"),
  addPasskeyUserId: text("add_passkey_user_id"),
});

export const usernames = pgTable("usernames", {
  userId: text("user_id").primaryKey(),
  username: text("username").notNull(),
});
```

```ts
// drizzle_store.ts
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type {
  ChallengeEntry,
  PasskeyStore,
  StoredPasskey,
} from "@ionaru/fresh-passkeys/server";
import { challenges, passkeys, usernames } from "./schema.ts";

export class DrizzleStore implements PasskeyStore {
  constructor(private readonly db: PostgresJsDatabase) {}

  async saveChallenge(
    challengeId: string,
    entry: ChallengeEntry,
  ): Promise<void> {
    await this.db.insert(challenges).values({
      challengeId,
      challenge: entry.challenge,
      expiresAt: entry.expiresAt,
      pendingUserId: entry.pendingUserId ?? null,
      username: entry.username ?? null,
      addPasskeyUserId: entry.addPasskeyUserId ?? null,
    });
  }

  // DELETE ... RETURNING does the read-and-delete in one round trip; an expired
  // row is then treated as absent.
  async takeChallenge(challengeId: string): Promise<ChallengeEntry | null> {
    const [row] = await this.db
      .delete(challenges)
      .where(eq(challenges.challengeId, challengeId))
      .returning();
    if (!row) return null;
    if (row.expiresAt < Date.now()) return null;
    return {
      challenge: row.challenge,
      expiresAt: row.expiresAt,
      pendingUserId: row.pendingUserId ?? undefined,
      username: row.username ?? undefined,
      addPasskeyUserId: row.addPasskeyUserId ?? undefined,
    };
  }

  async findPasskey(credentialId: string): Promise<StoredPasskey | null> {
    const [row] = await this.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, credentialId))
      .limit(1);
    return row ?? null;
  }

  async listPasskeys(userId: string): Promise<StoredPasskey[]> {
    return await this.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, userId));
  }

  async createPasskey(passkey: StoredPasskey): Promise<void> {
    await this.db.insert(passkeys).values(passkey);
  }

  async setCounter(credentialId: string, counter: number): Promise<void> {
    await this.db
      .update(passkeys)
      .set({ counter })
      .where(eq(passkeys.credentialId, credentialId));
  }

  async hasAnyPasskeys(): Promise<boolean> {
    const [row] = await this.db.select().from(passkeys).limit(1);
    return row !== undefined;
  }

  async findUsername(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select()
      .from(usernames)
      .where(eq(usernames.userId, userId))
      .limit(1);
    return row?.username ?? null;
  }

  // Helper for your onRegistered hook (not part of PasskeyStore).
  async saveUsername(userId: string, username: string): Promise<void> {
    await this.db.insert(usernames).values({ userId, username });
  }
}
```

> `select()` returns rows shaped exactly like `StoredPasskey` because the column
> types line up (`counter` as a JS `number` via `mode: "number"`, `transports`
> as `string | null`). If you fold passkeys into a wider table, map the columns
> back to the `StoredPasskey` shape in `findPasskey` / `listPasskeys`.

## Checklist for any store

- [ ] `takeChallenge` deletes on read **and** returns `null` past `expiresAt`.
- [ ] `createPasskey` and `listPasskeys` agree on how a user's credentials are
      indexed.
- [ ] `setCounter` persists: replay protection depends on it advancing.
- [ ] `hasAnyPasskeys` is cheap (limit 1); it runs on every login begin.
- [ ] `findUsername` reads whatever your `onRegistered` wrote.
- [ ] Store `transports` and the `ChallengeEntry` identity fields verbatim.
