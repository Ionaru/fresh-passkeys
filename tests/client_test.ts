import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";

import { createPasskeyClient } from "../src/client/client.ts";
import { must } from "./support/must.ts";
import {
  browserMock,
  resetBrowserMock,
  WebAuthnError,
} from "./mocks/simplewebauthn_browser.ts";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

type FetchImpl = (call: FetchCall) => Response;

/** Run `fn` with `globalThis.fetch` stubbed; records every call. */
async function withFetch(
  impl: FetchImpl,
  fn: (calls: FetchCall[]) => Promise<void>,
): Promise<void> {
  resetBrowserMock();
  const calls: FetchCall[] = [];
  const fetchStub = stub(
    globalThis,
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const call: FetchCall = { url: String(input), init };
      calls.push(call);
      return Promise.resolve(impl(call));
    },
  );
  try {
    await fn(calls);
  } finally {
    fetchStub.restore();
  }
}

function isGet(call: FetchCall): boolean {
  return (call.init?.method ?? "GET") === "GET";
}

// --- register ----------------------------------------------------------------

Deno.test("register: drives begin GET then finish POST and returns userId", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch1", options: { a: 1 } })
        : Response.json({ userId: "user-123" }),
    async (calls) => {
      const client = createPasskeyClient();
      const result = await client.register("ann e");

      assertEquals(result, { userId: "user-123" });
      // Begin GET with URL-encoded username.
      assertEquals(must(calls[0]).url, "/api/auth/register?username=ann%20e");
      assertEquals(isGet(must(calls[0])), true);
      // Options were handed to the browser layer.
      assertEquals(
        (browserMock.lastRegistrationArgs as { optionsJSON: unknown })
          .optionsJSON,
        { a: 1 },
      );
      // Finish POST carries challengeId + username + the browser credential.
      const finish = must(calls[1]);
      assertEquals(finish.init?.method, "POST");
      assertEquals(finish.init?.credentials, "same-origin");
      assertEquals(JSON.parse(must(finish.init).body as string), {
        challengeId: "ch1",
        username: "ann e",
        credential: browserMock.registrationCredential,
      });
    },
  );
});

Deno.test("register: begin failure surfaces the server error message", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ error: "username taken" }, { status: 400 })
        : Response.json({}),
    async () => {
      const client = createPasskeyClient();
      await assertRejects(
        () => client.register("ann"),
        Error,
        "username taken",
      );
    },
  );
});

Deno.test("register: finish failure with no body uses the status fallback", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch1", options: {} })
        : Response.json({}, { status: 418 }),
    async () => {
      const client = createPasskeyClient();
      const error = await assertRejects(() => client.register("ann"), Error);
      assertStringIncludes(error.message, "Registration failed");
      assertStringIncludes(error.message, "(418)");
    },
  );
});

Deno.test("register: begin failure with no body uses the status fallback", async () => {
  await withFetch(
    () => Response.json({}, { status: 503 }),
    async () => {
      const client = createPasskeyClient();
      const error = await assertRejects(() => client.register("ann"), Error);
      assertStringIncludes(error.message, "Could not start registration");
      assertStringIncludes(error.message, "(503)");
    },
  );
});

// --- login -------------------------------------------------------------------

Deno.test("login: drives begin then finish and returns the user", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch2", options: { b: 2 } })
        : Response.json({ user: { id: "u9", name: "ann" } }),
    async (calls) => {
      const client = createPasskeyClient();
      const result = await client.login<{ id: string; name: string }>();

      assertEquals(result, { user: { id: "u9", name: "ann" } });
      assertEquals(must(calls[0]).url, "/api/auth/authenticate");
      const finish = must(calls[1]);
      assertEquals(finish.init?.method, "POST");
      assertEquals(finish.init?.credentials, "same-origin");
      assertEquals(JSON.parse(must(finish.init).body as string), {
        challengeId: "ch2",
        credential: browserMock.authenticationCredential,
      });
    },
  );
});

Deno.test("login: begin failure uses the status fallback when no error body", async () => {
  await withFetch(
    () => Response.json({}, { status: 500 }),
    async () => {
      const client = createPasskeyClient();
      const error = await assertRejects(() => client.login(), Error);
      assertStringIncludes(error.message, "Login failed");
      assertStringIncludes(error.message, "(500)");
    },
  );
});

Deno.test("login: finish failure surfaces the server error message", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch2", options: {} })
        : Response.json({ error: "counter regressed" }, { status: 401 }),
    async () => {
      const client = createPasskeyClient();
      await assertRejects(() => client.login(), Error, "counter regressed");
    },
  );
});

Deno.test("login: finish failure with no body uses the status fallback", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch2", options: {} })
        : Response.json({}, { status: 401 }),
    async () => {
      const client = createPasskeyClient();
      const error = await assertRejects(() => client.login(), Error);
      assertStringIncludes(error.message, "Verify failed");
      assertStringIncludes(error.message, "(401)");
    },
  );
});

// --- addPasskey --------------------------------------------------------------

Deno.test("addPasskey: begin failure uses the status fallback", async () => {
  await withFetch(
    () => Response.json({}, { status: 401 }),
    async () => {
      const client = createPasskeyClient();
      const error = await assertRejects(() => client.addPasskey(), Error);
      assertStringIncludes(error.message, "Could not start");
      assertStringIncludes(error.message, "(401)");
    },
  );
});

Deno.test("addPasskey: drives begin then finish and returns credentialId", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch3", options: { c: 3 } })
        : Response.json({ credentialId: "new-cred" }),
    async (calls) => {
      const client = createPasskeyClient();
      const result = await client.addPasskey();

      assertEquals(result, { credentialId: "new-cred" });
      assertEquals(must(calls[0]).url, "/api/auth/add-passkey");
      assertEquals(must(calls[0]).init?.credentials, "same-origin");
      const finish = must(calls[1]);
      assertEquals(finish.init?.method, "POST");
      assertEquals(JSON.parse(must(finish.init).body as string), {
        challengeId: "ch3",
        credential: browserMock.registrationCredential,
      });
    },
  );
});

Deno.test("addPasskey: finish failure surfaces the server error message", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch3", options: {} })
        : Response.json({ error: "duplicate" }, { status: 401 }),
    async () => {
      const client = createPasskeyClient();
      await assertRejects(() => client.addPasskey(), Error, "duplicate");
    },
  );
});

// --- authenticator-level errors ----------------------------------------------

Deno.test("register: a WebAuthnError from the browser propagates unwrapped", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch1", options: {} })
        : Response.json({ userId: "u" }),
    async (calls) => {
      // The host must be able to tell an authenticator-level failure (e.g. the
      // user dismissing the prompt) from a server error, so the client must let
      // the typed WebAuthnError bubble rather than wrapping it in a plain Error.
      browserMock.registrationError = new WebAuthnError(
        "The operation was aborted.",
        "ERROR_CEREMONY_ABORTED",
      );
      const client = createPasskeyClient();
      const error = await assertRejects(
        () => client.register("ann"),
        WebAuthnError,
        "The operation was aborted.",
      );
      assertEquals((error as WebAuthnError).code, "ERROR_CEREMONY_ABORTED");
      // It failed at the browser step, so no finish POST was ever sent.
      assertEquals(calls.length, 1);
    },
  );
});

Deno.test("login: a WebAuthnError from the browser propagates unwrapped", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch2", options: {} })
        : Response.json({ user: {} }),
    async (calls) => {
      browserMock.authenticationError = new WebAuthnError("denied");
      const client = createPasskeyClient();
      await assertRejects(() => client.login(), WebAuthnError, "denied");
      assertEquals(calls.length, 1);
    },
  );
});

Deno.test("addPasskey: a WebAuthnError from the browser propagates unwrapped", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch3", options: {} })
        : Response.json({ credentialId: "x" }),
    async (calls) => {
      browserMock.registrationError = new WebAuthnError("denied");
      const client = createPasskeyClient();
      await assertRejects(() => client.addPasskey(), WebAuthnError, "denied");
      assertEquals(calls.length, 1);
    },
  );
});

// --- custom paths ------------------------------------------------------------

Deno.test("createPasskeyClient honours basePath and segment overrides", async () => {
  await withFetch(
    (call) =>
      isGet(call)
        ? Response.json({ challengeId: "ch", options: {} })
        : Response.json({ userId: "u" }),
    async (calls) => {
      const client = createPasskeyClient({
        basePath: "/auth",
        paths: { register: "/signup" },
      });
      await client.register("ann");
      assertStringIncludes(must(calls[0]).url, "/auth/signup?username=ann");
    },
  );
});
