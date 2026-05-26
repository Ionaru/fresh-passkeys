import { assertEquals, assertRejects } from "@std/assert";
import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url";

import {
  beginAddPasskey,
  beginAuthentication,
  beginRegistration,
  type CeremonyOptions,
  finishAuthentication,
  verifyAddPasskey,
  verifyRegistration,
} from "../src/server/ceremonies.ts";
import { MemoryStore } from "./support/memory_store.ts";
import { must } from "./support/must.ts";
import { credentialResponse } from "./support/fixtures.ts";
import { resetServerMock, serverMock } from "./mocks/simplewebauthn_server.ts";

function setup(): { store: MemoryStore; options: CeremonyOptions } {
  resetServerMock();
  const store = new MemoryStore();
  return {
    store,
    options: { rpId: "example.com", rpName: "Example", store },
  };
}

// Pull the single saved challenge entry (begin always stores exactly one).
function onlyChallenge(store: MemoryStore) {
  const entries = [...store.challenges.entries()];
  assertEquals(entries.length, 1);
  return must(entries[0]);
}

Deno.test("beginRegistration trims username and persists a tagged challenge", async () => {
  const { store, options } = setup();
  const before = Date.now();

  const { challengeId, options: opts } = await beginRegistration(
    options,
    "  alice  ",
  );

  assertEquals(typeof challengeId, "string");
  const options_ = opts as {
    challenge: string;
    rp: { id: string };
    excludeCredentials: unknown[];
  };
  assertEquals(options_.challenge, "reg-challenge");
  // Begin returns the full options the browser needs, not just the challenge.
  assertEquals(options_.rp.id, "example.com");
  assertEquals(options_.excludeCredentials, []);

  const [id, entry] = onlyChallenge(store);
  assertEquals(id, challengeId);
  assertEquals(entry.challenge, "reg-challenge");
  assertEquals(entry.username, "alice");
  assertEquals(typeof entry.pendingUserId, "string");
  assertEquals(entry.addPasskeyUserId, undefined);
  // Expiry is ~5 minutes out.
  const ttl = entry.expiresAt - before;
  assertEquals(ttl >= 5 * 60 * 1000 && ttl <= 5 * 60 * 1000 + 5000, true);

  const args = must(serverMock.lastGenerateRegistrationArgs);
  assertEquals(args.rpName, "Example");
  assertEquals(args.rpID, "example.com");
  assertEquals(args.userName, "alice");
  assertEquals(args.userDisplayName, "alice");
  assertEquals(args.excludeCredentials, []);
  // Fixed, non-configurable policy: no attestation, resident key required
  // (enables passwordless login), user verification preferred.
  assertEquals(args.attestationType, "none");
  assertEquals(args.authenticatorSelection, {
    residentKey: "required",
    userVerification: "preferred",
  });
});

Deno.test("verifyRegistration returns the verified credential on success", async () => {
  const { store, options } = setup();
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    pendingUserId: "pending-1",
    username: "alice",
  });

  const result = await verifyRegistration(
    options,
    "c1",
    credentialResponse("browser-cred"),
    "https://example.com",
  );

  assertEquals(result, {
    pendingUserId: "pending-1",
    username: "alice",
    credentialId: "cred-id", // string id passes through toBase64Url
    publicKey: encodeBase64Url(new Uint8Array([1, 2, 3, 4])),
    counter: 0,
    transports: JSON.stringify(["internal", "hybrid"]),
  });

  const args = must(serverMock.lastVerifyRegistrationArgs);
  assertEquals(args.expectedChallenge, "reg-challenge");
  assertEquals(args.expectedOrigin, "https://example.com");
  assertEquals(args.expectedRPID, "example.com");
});

Deno.test("verifyRegistration encodes absent transports as null", async () => {
  const { store, options } = setup();
  serverMock.registrationCredential.transports = undefined;
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    pendingUserId: "pending-1",
    username: "alice",
  });

  const result = await verifyRegistration(
    options,
    "c1",
    credentialResponse("browser-cred"),
    "o",
  );
  assertEquals(result.transports, null);
});

Deno.test("verifyRegistration rejects a missing or untagged challenge", async () => {
  const { store, options } = setup();
  // Missing entirely.
  await assertRejects(
    () => verifyRegistration(options, "absent", {}, "o"),
    Error,
    "Invalid challenge",
  );
  // Present but missing pendingUserId.
  store.saveChallenge("no-user", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    username: "alice",
  });
  await assertRejects(
    () => verifyRegistration(options, "no-user", {}, "o"),
    Error,
    "Invalid challenge",
  );
  // Present but missing username.
  store.saveChallenge("no-name", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    pendingUserId: "pending-1",
  });
  await assertRejects(
    () => verifyRegistration(options, "no-name", {}, "o"),
    Error,
    "Invalid challenge",
  );
});

Deno.test("verifyRegistration rejects when verification fails", async () => {
  const { store, options } = setup();
  const seed = () =>
    store.saveChallenge("c1", {
      challenge: "reg-challenge",
      expiresAt: Date.now() + 1000,
      pendingUserId: "pending-1",
      username: "alice",
    });

  serverMock.registrationVerified = false;
  seed();
  await assertRejects(
    () => verifyRegistration(options, "c1", credentialResponse("c"), "o"),
    Error,
    "Registration verification failed",
  );

  // verified: true but no registrationInfo.
  serverMock.registrationVerified = true;
  serverMock.registrationInfoPresent = false;
  seed();
  await assertRejects(
    () => verifyRegistration(options, "c1", credentialResponse("c"), "o"),
    Error,
    "Registration verification failed",
  );
});

Deno.test("verifyRegistration rejects a credential with no id (like the real lib)", async () => {
  const { store, options } = setup();
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    pendingUserId: "pending-1",
    username: "alice",
  });
  await assertRejects(
    () => verifyRegistration(options, "c1", {}, "o"),
    Error,
    "Missing credential ID",
  );
});

Deno.test("verifyRegistration rejects an expired challenge", async () => {
  const { store, options } = setup();
  // Expiry enforcement lives in the store's takeChallenge (storage-port
  // contract), so an expired entry is returned as absent and the ceremony
  // fails as an invalid challenge.
  store.saveChallenge("stale", {
    challenge: "reg-challenge",
    expiresAt: Date.now() - 1000,
    pendingUserId: "pending-1",
    username: "alice",
  });
  await assertRejects(
    () => verifyRegistration(options, "stale", credentialResponse("c"), "o"),
    Error,
    "Invalid challenge",
  );
});

Deno.test("beginAddPasskey rejects when the user has no username", async () => {
  const { options } = setup();
  await assertRejects(
    () => beginAddPasskey(options, "ghost"),
    Error,
    "User not found",
  );
});

Deno.test("beginAddPasskey excludes existing credentials and tags the challenge", async () => {
  const { store, options } = setup();
  store.usernames.set("u1", "alice");
  store.createPasskey({
    userId: "u1",
    credentialId: "has-transports",
    publicKey: "pk1",
    counter: 0,
    transports: JSON.stringify(["usb"]),
  });
  store.createPasskey({
    userId: "u1",
    credentialId: "no-transports",
    publicKey: "pk2",
    counter: 0,
    transports: null,
  });

  const { challengeId, options: opts } = await beginAddPasskey(options, "u1");

  const args = must(serverMock.lastGenerateRegistrationArgs);
  // The username read back from storage populates account + display names, and
  // the real (not provisional) user id is the WebAuthn user handle.
  assertEquals(args.userName, "alice");
  assertEquals(args.userDisplayName, "alice");
  assertEquals(args.userID, new TextEncoder().encode("u1"));

  const exclude = args
    .excludeCredentials as Array<{ id: string; transports?: string[] }>;
  assertEquals(exclude.length, 2);
  const byId = Object.fromEntries(exclude.map((e) => [e.id, e.transports]));
  assertEquals(byId["has-transports"], ["usb"]); // parseTransports parses JSON
  assertEquals(byId["no-transports"], undefined); // null -> undefined branch

  // The exclude list also reaches the browser via the begin response options.
  assertEquals(
    (opts as { excludeCredentials: unknown[] }).excludeCredentials.length,
    2,
  );

  const [, entry] = onlyChallenge(store);
  assertEquals(entry.addPasskeyUserId, "u1");
  assertEquals(challengeId.length > 0, true);
});

Deno.test("beginAddPasskey treats malformed stored transports as none", async () => {
  const { store, options } = setup();
  store.usernames.set("u1", "alice");
  store.createPasskey({
    userId: "u1",
    credentialId: "bad-transports",
    publicKey: "pk",
    counter: 0,
    transports: "not-json", // corrupt/legacy value, not valid JSON
  });

  // parseTransports swallows the parse error rather than crashing the ceremony.
  await beginAddPasskey(options, "u1");

  const exclude = must(serverMock.lastGenerateRegistrationArgs)
    .excludeCredentials as Array<{ id: string; transports?: string[] }>;
  assertEquals(exclude.length, 1);
  assertEquals(must(exclude[0]).transports, undefined);
});

Deno.test("verifyAddPasskey rejects an untagged or foreign challenge", async () => {
  const { store, options } = setup();
  // No addPasskeyUserId.
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
  });
  await assertRejects(
    () => verifyAddPasskey(options, "c1", {}, "o", "u1"),
    Error,
    "Invalid challenge",
  );
  // Tagged for a different user.
  store.saveChallenge("c2", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    addPasskeyUserId: "someone-else",
  });
  await assertRejects(
    () => verifyAddPasskey(options, "c2", {}, "o", "u1"),
    Error,
    "Challenge does not belong to the signed-in user",
  );
});

Deno.test("verifyAddPasskey rejects when verification fails", async () => {
  const { store, options } = setup();
  serverMock.registrationVerified = false;
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    addPasskeyUserId: "u1",
  });
  await assertRejects(
    () => verifyAddPasskey(options, "c1", credentialResponse("c"), "o", "u1"),
    Error,
    "Registration verification failed",
  );
});

Deno.test("verifyAddPasskey persists the new credential on success", async () => {
  const { store, options } = setup();
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    addPasskeyUserId: "u1",
  });

  const { credentialId } = await verifyAddPasskey(
    options,
    "c1",
    credentialResponse("browser-cred"),
    "https://example.com",
    "u1",
  );

  assertEquals(credentialId, "cred-id");
  assertEquals(store.passkeys.get("cred-id"), {
    userId: "u1",
    credentialId: "cred-id",
    publicKey: encodeBase64Url(new Uint8Array([1, 2, 3, 4])),
    counter: 0,
    transports: JSON.stringify(["internal", "hybrid"]),
  });
});

Deno.test("verifyAddPasskey stores null transports when none reported", async () => {
  const { store, options } = setup();
  serverMock.registrationCredential.transports = undefined;
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 1000,
    addPasskeyUserId: "u1",
  });

  await verifyAddPasskey(
    options,
    "c1",
    credentialResponse("browser-cred"),
    "o",
    "u1",
  );
  assertEquals(must(store.passkeys.get("cred-id")).transports, null);
});

Deno.test("beginAuthentication rejects when no passkeys exist", async () => {
  const { options } = setup();
  await assertRejects(
    () => beginAuthentication(options),
    Error,
    "No passkeys registered",
  );
});

Deno.test("beginAuthentication persists an identity-free challenge", async () => {
  const { store, options } = setup();
  store.createPasskey({
    userId: "u1",
    credentialId: "cred-id",
    publicKey: "pk",
    counter: 0,
    transports: null,
  });

  const { options: opts } = await beginAuthentication(options);
  const authOpts = opts as {
    challenge: string;
    rpId: string;
    allowCredentials: unknown[];
  };
  assertEquals(authOpts.challenge, "auth-challenge");
  assertEquals(authOpts.rpId, "example.com");
  assertEquals(authOpts.allowCredentials, []);

  const [, entry] = onlyChallenge(store);
  assertEquals(entry.challenge, "auth-challenge");
  assertEquals(entry.pendingUserId, undefined);
  assertEquals(entry.username, undefined);
  assertEquals(entry.addPasskeyUserId, undefined);
});

Deno.test("finishAuthentication rejects a missing challenge", async () => {
  const { options } = setup();
  await assertRejects(
    () => finishAuthentication(options, "absent", { id: "x" }, "o"),
    Error,
    "Invalid challenge",
  );
});

Deno.test("finishAuthentication rejects a credential with no id", async () => {
  const { store, options } = setup();
  store.saveChallenge("c1", {
    challenge: "auth-challenge",
    expiresAt: Date.now() + 1000,
  });
  await assertRejects(
    () => finishAuthentication(options, "c1", {}, "o"),
    Error,
    "Missing credential id",
  );
});

Deno.test("finishAuthentication rejects an unknown credential", async () => {
  const { store, options } = setup();
  store.saveChallenge("c1", {
    challenge: "auth-challenge",
    expiresAt: Date.now() + 1000,
  });
  await assertRejects(
    () => finishAuthentication(options, "c1", { id: "nope" }, "o"),
    Error,
    "Unknown credential",
  );
});

Deno.test("finishAuthentication rejects when verification fails", async () => {
  const { store, options } = setup();
  serverMock.authenticationVerified = false;
  store.createPasskey({
    userId: "u1",
    credentialId: "cred-id",
    publicKey: encodeBase64Url(new Uint8Array([9, 9])),
    counter: 3,
    transports: null,
  });
  store.saveChallenge("c1", {
    challenge: "auth-challenge",
    expiresAt: Date.now() + 1000,
  });
  await assertRejects(
    () => finishAuthentication(options, "c1", { id: "cred-id" }, "o"),
    Error,
    "Auth verification failed",
  );
});

Deno.test("finishAuthentication advances the counter and returns the owner", async () => {
  const { store, options } = setup();
  serverMock.newCounter = 42;
  store.createPasskey({
    userId: "owner-1",
    credentialId: "cred-id",
    publicKey: encodeBase64Url(new Uint8Array([9, 9])),
    counter: 3,
    transports: null,
  });
  store.saveChallenge("c1", {
    challenge: "auth-challenge",
    expiresAt: Date.now() + 1000,
  });

  const result = await finishAuthentication(
    options,
    "c1",
    { id: "cred-id" },
    "https://example.com",
  );

  assertEquals(result, { userId: "owner-1" });
  assertEquals(store.setCounterCalls, [{
    credentialId: "cred-id",
    counter: 42,
  }]);
  assertEquals(must(store.passkeys.get("cred-id")).counter, 42);

  // The stored public key is base64url-decoded before verification.
  const args = must(serverMock.lastVerifyAuthenticationArgs);
  const cred = args.credential as { publicKey: Uint8Array; counter: number };
  assertEquals(
    cred.publicKey,
    decodeBase64Url(encodeBase64Url(new Uint8Array([9, 9]))),
  );
  assertEquals(cred.counter, 3);
  assertEquals(args.expectedRPID, "example.com");
});

Deno.test("finishAuthentication checks only the presented credential's counter", async () => {
  const { store, options } = setup();
  serverMock.newCounter = 5;
  // Two credentials with independent counters. The new assertion reports 5,
  // which advances "b" (stored 1) but would regress "a" (stored 10), proving
  // each credential is checked against its own counter, never another's.
  store.createPasskey({
    userId: "owner-a",
    credentialId: "a",
    publicKey: encodeBase64Url(new Uint8Array([1])),
    counter: 10,
    transports: null,
  });
  store.createPasskey({
    userId: "owner-b",
    credentialId: "b",
    publicKey: encodeBase64Url(new Uint8Array([2])),
    counter: 1,
    transports: null,
  });
  store.saveChallenge("c1", {
    challenge: "auth-challenge",
    expiresAt: Date.now() + 1000,
  });

  const result = await finishAuthentication(
    options,
    "c1",
    credentialResponse("b"),
    "o",
  );

  assertEquals(result, { userId: "owner-b" });
  assertEquals(must(store.passkeys.get("b")).counter, 5); // advanced
  assertEquals(must(store.passkeys.get("a")).counter, 10); // untouched
});

Deno.test("finishAuthentication rejects a counter that fails to advance (replay)", async () => {
  const { store, options } = setup();
  // Stored counter 5; the new assertion reports 3, a non-advancing counter
  // signals a cloned authenticator and must be rejected.
  serverMock.newCounter = 3;
  store.createPasskey({
    userId: "owner-1",
    credentialId: "cred-id",
    publicKey: encodeBase64Url(new Uint8Array([9, 9])),
    counter: 5,
    transports: null,
  });
  store.saveChallenge("c1", {
    challenge: "auth-challenge",
    expiresAt: Date.now() + 1000,
  });

  await assertRejects(
    () =>
      finishAuthentication(
        options,
        "c1",
        credentialResponse("cred-id"),
        "https://example.com",
      ),
    Error,
    "counter value",
  );
  // Counter was NOT advanced on a failed verification.
  assertEquals(store.setCounterCalls, []);
});
