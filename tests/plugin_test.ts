import { assertEquals } from "@std/assert";
import { App } from "fresh";

import { passkeyAuth } from "../src/server/plugin.ts";
import type { PasskeyConfig } from "../src/server/types.ts";
import { failingStore, MemoryStore } from "./support/memory_store.ts";
import { must } from "./support/must.ts";
import { credentialResponse } from "./support/fixtures.ts";
import { resetServerMock, serverMock } from "./mocks/simplewebauthn_server.ts";

interface State {
  userId: string | null;
}

type Handler = (request: Request) => Promise<Response>;

interface BuildOptions {
  store: PasskeyConfig<State>["store"];
  userId?: string | null;
  validateUsername?: PasskeyConfig<State>["validateUsername"];
  expectedOrigin?: PasskeyConfig<State>["expectedOrigin"];
  basePath?: string;
  paths?: PasskeyConfig<State>["paths"];
  onRegistered?: PasskeyConfig<State>["onRegistered"];
  onAuthenticated?: PasskeyConfig<State>["onAuthenticated"];
}

function build(opts: BuildOptions): Handler {
  resetServerMock();
  const app = new App<State>();
  app.use((ctx) => {
    ctx.state.userId = opts.userId ?? null;
    return ctx.next();
  });
  const config: PasskeyConfig<State> = {
    rpId: "example.com",
    rpName: "Example",
    store: opts.store,
    getSessionUserId: (state) => state.userId,
    validateUsername: opts.validateUsername,
    expectedOrigin: opts.expectedOrigin,
    basePath: opts.basePath,
    paths: opts.paths,
    onRegistered: opts.onRegistered ??
      ((verified) =>
        Promise.resolve(
          Response.json({ userId: verified.pendingUserId }, { status: 201 }),
        )),
    onAuthenticated: opts.onAuthenticated ??
      ((userId) => Promise.resolve(Response.json({ user: { id: userId } }))),
  };
  passkeyAuth(app, config);
  return app.handler() as Handler;
}

const URL_BASE = "http://localhost";

function get(path: string, headers?: HeadersInit): Request {
  return new Request(`${URL_BASE}${path}`, { headers });
}

function post(path: string, body: unknown, headers?: HeadersInit): Request {
  return new Request(`${URL_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// --- Registration -----------------------------------------------------------

Deno.test("GET /register: blank username -> 400", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(get("/api/auth/register?username=%20%20"));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Username is required" });
});

Deno.test("GET /register: validator rejection -> 400 with its message", async () => {
  const handler = build({
    store: new MemoryStore(),
    validateUsername: () => "too short",
  });
  const res = await handler(get("/api/auth/register?username=al"));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "too short" });
});

Deno.test("GET /register: store failure during begin -> 500", async () => {
  const handler = build({ store: failingStore("saveChallenge") });
  const res = await handler(get("/api/auth/register?username=alice"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "store boom" });
});

Deno.test("GET /register: success -> 200 with challenge + options", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(get("/api/auth/register?username=alice"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(typeof body.challengeId, "string");
  assertEquals(body.options.challenge, "reg-challenge");
});

Deno.test("POST /register: invalid JSON -> 400", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(post("/api/auth/register", "{not json"));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Invalid JSON body" });
});

Deno.test("POST /register: missing fields -> 400", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(post("/api/auth/register", { challengeId: "c" }));
  assertEquals(res.status, 400);
  assertEquals(
    (await res.json()).error,
    "challengeId, username, and credential are required",
  );
});

Deno.test("POST /register: validator rejection -> 400", async () => {
  const handler = build({
    store: new MemoryStore(),
    validateUsername: () => "nope",
  });
  const res = await handler(
    post("/api/auth/register", {
      challengeId: "c",
      username: "alice",
      credential: {},
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "nope" });
});

Deno.test("POST /register: missing challenge -> 400 (Invalid challenge)", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(
    post("/api/auth/register", {
      challengeId: "absent",
      username: "alice",
      credential: {},
    }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Invalid challenge");
});

Deno.test("POST /register: verification failure -> 401", async () => {
  const store = new MemoryStore();
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  serverMock.registrationVerified = false;
  const res = await handler(
    post("/api/auth/register", {
      challengeId: begin.challengeId,
      username: "alice",
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "Registration verification failed");
});

Deno.test("POST /register: username mismatch -> 400", async () => {
  const store = new MemoryStore();
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  const res = await handler(
    post("/api/auth/register", {
      challengeId: begin.challengeId,
      username: "bob",
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(
    (await res.json()).error,
    "Username does not match registration",
  );
});

Deno.test("POST /register: success -> host hook response", async () => {
  const store = new MemoryStore();
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  const res = await handler(
    post("/api/auth/register", {
      challengeId: begin.challengeId,
      username: "alice",
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 201);
  assertEquals(typeof (await res.json()).userId, "string");
});

Deno.test("POST /register: expired challenge -> 400", async () => {
  const store = new MemoryStore();
  // The store discards an expired challenge (expiry enforcement is the
  // storage-port's job), so finish sees it as missing -> invalid -> 400.
  store.saveChallenge("stale", {
    challenge: "reg-challenge",
    expiresAt: Date.now() - 1000,
    pendingUserId: "pending-1",
    username: "alice",
  });
  const handler = build({ store });
  const res = await handler(
    post("/api/auth/register", {
      challengeId: "stale",
      username: "alice",
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Invalid challenge" });
});

Deno.test("POST /register: case-mismatched username -> 400", async () => {
  const store = new MemoryStore();
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  // The finish username must match the begin username case-sensitively.
  const res = await handler(
    post("/api/auth/register", {
      challengeId: begin.challengeId,
      username: "Alice",
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(
    (await res.json()).error,
    "Username does not match registration",
  );
});

Deno.test("POST /register: surrounding whitespace still matches -> 201", async () => {
  const store = new MemoryStore();
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  // The comparison trims, so padded whitespace around the same name matches.
  const res = await handler(
    post("/api/auth/register", {
      challengeId: begin.challengeId,
      username: "  alice  ",
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 201);
});

// --- Add passkey -------------------------------------------------------------

Deno.test("GET /add-passkey: no session -> 401", async () => {
  const handler = build({ store: new MemoryStore(), userId: null });
  const res = await handler(get("/api/auth/add-passkey"));
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
});

Deno.test("GET /add-passkey: store failure -> 500", async () => {
  const handler = build({ store: failingStore("findUsername"), userId: "u1" });
  const res = await handler(get("/api/auth/add-passkey"));
  assertEquals(res.status, 500);
});

Deno.test("GET /add-passkey: success -> 200", async () => {
  const store = new MemoryStore();
  store.usernames.set("u1", "alice");
  const handler = build({ store, userId: "u1" });
  const res = await handler(get("/api/auth/add-passkey"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).options.challenge, "reg-challenge");
});

Deno.test("POST /add-passkey: no session -> 401", async () => {
  const handler = build({ store: new MemoryStore(), userId: null });
  const res = await handler(
    post("/api/auth/add-passkey", { challengeId: "c", credential: {} }),
  );
  assertEquals(res.status, 401);
});

Deno.test("POST /add-passkey: invalid JSON -> 400", async () => {
  const handler = build({ store: new MemoryStore(), userId: "u1" });
  const res = await handler(post("/api/auth/add-passkey", "{bad"));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Invalid JSON body");
});

Deno.test("POST /add-passkey: missing fields -> 400", async () => {
  const handler = build({ store: new MemoryStore(), userId: "u1" });
  const res = await handler(
    post("/api/auth/add-passkey", { challengeId: "c" }),
  );
  assertEquals(res.status, 400);
  assertEquals(
    (await res.json()).error,
    "challengeId and credential are required",
  );
});

Deno.test("POST /add-passkey: challenge bound to another user -> 401", async () => {
  const store = new MemoryStore();
  store.saveChallenge("c1", {
    challenge: "reg-challenge",
    expiresAt: Date.now() + 60000,
    addPasskeyUserId: "someone-else",
  });
  const handler = build({ store, userId: "u1" });
  const res = await handler(
    post("/api/auth/add-passkey", { challengeId: "c1", credential: {} }),
  );
  assertEquals(res.status, 401);
  assertEquals(
    (await res.json()).error,
    "Challenge does not belong to the signed-in user",
  );
});

Deno.test("POST /add-passkey: missing challenge -> 400", async () => {
  const handler = build({ store: new MemoryStore(), userId: "u1" });
  const res = await handler(
    post("/api/auth/add-passkey", { challengeId: "absent", credential: {} }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Invalid challenge");
});

Deno.test("POST /add-passkey: success -> 201 with credentialId", async () => {
  const store = new MemoryStore();
  store.usernames.set("u1", "alice");
  const handler = build({ store, userId: "u1" });
  const begin = await (await handler(get("/api/auth/add-passkey"))).json();
  const res = await handler(
    post("/api/auth/add-passkey", {
      challengeId: begin.challengeId,
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 201);
  assertEquals(await res.json(), { ok: true, credentialId: "cred-id" });
});

Deno.test("POST /add-passkey: verification failure -> 401", async () => {
  const store = new MemoryStore();
  store.usernames.set("u1", "alice");
  const handler = build({ store, userId: "u1" });
  const begin = await (await handler(get("/api/auth/add-passkey"))).json();
  serverMock.registrationVerified = false;
  const res = await handler(
    post("/api/auth/add-passkey", {
      challengeId: begin.challengeId,
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "Registration verification failed");
});

// --- Authentication ----------------------------------------------------------

Deno.test("GET /authenticate: no passkeys -> 404", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(get("/api/auth/authenticate"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "No passkeys registered" });
});

Deno.test("GET /authenticate: store failure -> 500", async () => {
  const handler = build({ store: failingStore("hasAnyPasskeys") });
  const res = await handler(get("/api/auth/authenticate"));
  assertEquals(res.status, 500);
});

Deno.test("GET /authenticate: success -> 200", async () => {
  const store = new MemoryStore();
  store.createPasskey({
    userId: "u1",
    credentialId: "cred-id",
    publicKey: "cGs",
    counter: 0,
    transports: null,
  });
  const handler = build({ store });
  const res = await handler(get("/api/auth/authenticate"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).options.challenge, "auth-challenge");
});

Deno.test("POST /authenticate: invalid JSON -> 400", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(post("/api/auth/authenticate", "{bad"));
  assertEquals(res.status, 400);
});

Deno.test("POST /authenticate: missing fields -> 400", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(
    post("/api/auth/authenticate", { challengeId: "c" }),
  );
  assertEquals(res.status, 400);
});

Deno.test("POST /authenticate: missing challenge -> 400", async () => {
  const handler = build({ store: new MemoryStore() });
  const res = await handler(
    post("/api/auth/authenticate", { challengeId: "absent", credential: {} }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "Invalid challenge");
});

Deno.test("POST /authenticate: unknown credential -> 404", async () => {
  const store = new MemoryStore();
  store.createPasskey({
    userId: "u1",
    credentialId: "known",
    publicKey: "cGs",
    counter: 0,
    transports: null,
  });
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/authenticate"))).json();
  const res = await handler(
    post("/api/auth/authenticate", {
      challengeId: begin.challengeId,
      credential: { id: "unknown" },
    }),
  );
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "Unknown credential");
});

Deno.test("POST /authenticate: verification failure -> 401", async () => {
  const store = new MemoryStore();
  store.createPasskey({
    userId: "u1",
    credentialId: "cred-id",
    publicKey: "cGs",
    counter: 0,
    transports: null,
  });
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/authenticate"))).json();
  serverMock.authenticationVerified = false;
  const res = await handler(
    post("/api/auth/authenticate", {
      challengeId: begin.challengeId,
      credential: { id: "cred-id" },
    }),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "Auth verification failed");
});

Deno.test("POST /authenticate: success -> host hook response", async () => {
  const store = new MemoryStore();
  store.createPasskey({
    userId: "owner",
    credentialId: "cred-id",
    publicKey: "cGs",
    counter: 0,
    transports: null,
  });
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/authenticate"))).json();
  const res = await handler(
    post("/api/auth/authenticate", {
      challengeId: begin.challengeId,
      credential: { id: "cred-id" },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { user: { id: "owner" } });
});

Deno.test("POST /authenticate: credential without id -> 401", async () => {
  const store = new MemoryStore();
  store.createPasskey({
    userId: "u1",
    credentialId: "cred-id",
    publicKey: "cGs",
    counter: 0,
    transports: null,
  });
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/authenticate"))).json();
  // Valid challenge, but the signed credential carries no id: per spec this is
  // a generic verification failure (401), distinct from unknown-id (404).
  const res = await handler(
    post("/api/auth/authenticate", {
      challengeId: begin.challengeId,
      credential: {},
    }),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "Missing credential id");
});

Deno.test("POST /authenticate: non-advancing counter -> 401 (replay)", async () => {
  const store = new MemoryStore();
  store.createPasskey({
    userId: "u1",
    credentialId: "cred-id",
    publicKey: "cGs",
    counter: 5,
    transports: null,
  });
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/authenticate"))).json();
  serverMock.newCounter = 3; // lower than the stored 5 -> cloned authenticator
  const res = await handler(
    post("/api/auth/authenticate", {
      challengeId: begin.challengeId,
      credential: credentialResponse("cred-id"),
    }),
  );
  assertEquals(res.status, 401);
  assertEquals(store.setCounterCalls, []);
});

// --- Origin resolution -------------------------------------------------------

Deno.test("expectedOrigin override is forwarded to verification", async () => {
  const store = new MemoryStore();
  const handler = build({
    store,
    expectedOrigin: () => "https://proxy.example",
  });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  await handler(
    post("/api/auth/register", {
      challengeId: begin.challengeId,
      username: "alice",
      credential: credentialResponse("browser-cred"),
    }),
  );
  assertEquals(
    must(serverMock.lastVerifyRegistrationArgs).expectedOrigin,
    "https://proxy.example",
  );
});

Deno.test("Origin header is used when no override is configured", async () => {
  const store = new MemoryStore();
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  await handler(
    post(
      "/api/auth/register",
      {
        challengeId: begin.challengeId,
        username: "alice",
        credential: credentialResponse("browser-cred"),
      },
      { origin: "https://from-header.example" },
    ),
  );
  assertEquals(
    must(serverMock.lastVerifyRegistrationArgs).expectedOrigin,
    "https://from-header.example",
  );
});

Deno.test("Falls back to the request URL origin when no header is present", async () => {
  const store = new MemoryStore();
  const handler = build({ store });
  const begin = await (await handler(get("/api/auth/register?username=alice")))
    .json();
  // Build a POST with the Origin header explicitly stripped.
  const req = new Request(`${URL_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId: begin.challengeId,
      username: "alice",
      credential: credentialResponse("browser-cred"),
    }),
  });
  await handler(req);
  assertEquals(
    must(serverMock.lastVerifyRegistrationArgs).expectedOrigin,
    URL_BASE,
  );
});

// --- Custom paths ------------------------------------------------------------

Deno.test("custom base path and segment override are mounted", async () => {
  const handler = build({
    store: new MemoryStore(),
    basePath: "/auth",
    paths: { register: "/signup" },
  });
  const ok = await handler(get("/auth/signup?username=alice"));
  assertEquals(ok.status, 200);
  // The default path is no longer mounted.
  const missing = await handler(get("/api/auth/register?username=alice"));
  assertEquals(missing.status, 404);
});
