import { assertExists } from "@std/assert";

import * as server from "../src/server/mod.ts";
import * as client from "../src/client/mod.ts";

Deno.test("server barrel exports passkeyAuth", () => {
  assertExists(server.passkeyAuth);
});

Deno.test("client barrel exports createPasskeyClient and WebAuthnError", () => {
  assertExists(client.createPasskeyClient);
  assertExists(client.WebAuthnError);
});
