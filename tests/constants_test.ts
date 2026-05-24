import { assertEquals } from "@std/assert";

import {
  DEFAULT_BASE_PATH,
  DEFAULT_PATHS,
  resolvePaths,
} from "../src/shared/constants.ts";

Deno.test("resolvePaths defaults to /api/auth + default segments", () => {
  assertEquals(resolvePaths(), {
    register: "/api/auth/register",
    addPasskey: "/api/auth/add-passkey",
    authenticate: "/api/auth/authenticate",
  });
});

Deno.test("resolvePaths appends default segments to a custom base path", () => {
  assertEquals(resolvePaths("/auth"), {
    register: "/auth/register",
    addPasskey: "/auth/add-passkey",
    authenticate: "/auth/authenticate",
  });
});

Deno.test("resolvePaths overrides individual segments, keeps the rest", () => {
  assertEquals(resolvePaths(undefined, { register: "/signup" }), {
    register: "/api/auth/signup",
    addPasskey: "/api/auth/add-passkey",
    authenticate: "/api/auth/authenticate",
  });
});

Deno.test("resolvePaths composes a custom base with a segment override", () => {
  assertEquals(
    resolvePaths("/auth", {
      addPasskey: "/enroll",
      authenticate: "/login",
    }),
    {
      register: "/auth/register",
      addPasskey: "/auth/enroll",
      authenticate: "/auth/login",
    },
  );
});

Deno.test("default constants have the documented values", () => {
  assertEquals(DEFAULT_BASE_PATH, "/api/auth");
  assertEquals(DEFAULT_PATHS, {
    register: "/register",
    addPasskey: "/add-passkey",
    authenticate: "/authenticate",
  });
});
