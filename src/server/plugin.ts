import { type App, createDefine, type Middleware } from "fresh";

import {
  beginAddPasskey,
  beginAuthentication,
  beginRegistration,
  type CeremonyOptions,
  finishAuthentication,
  verifyAddPasskey,
  verifyRegistration,
} from "./ceremonies.ts";
import { resolvePaths } from "../shared/constants.ts";
import type { PasskeyConfig } from "./types.ts";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Server error";
}

/** Maps ceremony-finish errors to the HTTP status the host previously returned. */
function finishStatus(message: string): number {
  if (message.includes("Invalid challenge")) return 400;
  if (message.includes("Unknown credential")) return 404;
  return 401;
}

async function readJson(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Registers the passkey ceremony endpoints on a Fresh 2.x app via per-verb
 * routing (`app.get`/`app.post`). Call before `app.fsRoutes()`, and after
 * whatever middleware populates the session the hooks read. Identity and
 * sessions are delegated to the config hooks.
 */
export function passkeyAuth<State>(
  app: App<State>,
  config: PasskeyConfig<State>,
): App<State> {
  const define = createDefine<State>();
  const paths = resolvePaths(config.basePath, config.paths);
  const ceremonyOptions: CeremonyOptions = {
    rpId: config.rpId,
    rpName: config.rpName,
    store: config.store,
  };
  const originOf = (request: Request): string => {
    if (config.expectedOrigin) return config.expectedOrigin(request);
    return request.headers.get("origin") ?? new URL(request.url).origin;
  };

  const beginRegister: Middleware<State> = async (context) => {
    const username = context.url.searchParams.get("username") ?? "";
    if (!username.trim()) return json({ error: "Username is required" }, 400);
    const validationError = config.validateUsername?.(username);
    if (validationError) return json({ error: validationError }, 400);
    try {
      return json(await beginRegistration(ceremonyOptions, username));
    } catch (error) {
      return json({ error: message(error) }, 500);
    }
  };

  const finishRegister: Middleware<State> = async (context) => {
    const body = await readJson(context.req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);
    if (
      !body.challengeId || body.credential === undefined ||
      body.username === undefined
    ) {
      return json(
        { error: "challengeId, username, and credential are required" },
        400,
      );
    }
    const username = String(body.username);
    const usernameError = config.validateUsername?.(username);
    if (usernameError) return json({ error: usernameError }, 400);
    try {
      const verified = await verifyRegistration(
        ceremonyOptions,
        String(body.challengeId),
        body.credential,
        originOf(context.req),
      );
      if (verified.username !== username.trim()) {
        return json({ error: "Username does not match registration" }, 400);
      }
      return await config.onRegistered(verified, context.state);
    } catch (error) {
      const errorMessage = message(error);
      return json({ error: errorMessage }, finishStatus(errorMessage));
    }
  };

  const beginAdd: Middleware<State> = async (context) => {
    const userId = config.getSessionUserId(context.state);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    try {
      return json(await beginAddPasskey(ceremonyOptions, userId));
    } catch (error) {
      return json({ error: message(error) }, 500);
    }
  };

  const finishAdd: Middleware<State> = async (context) => {
    const userId = config.getSessionUserId(context.state);
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const body = await readJson(context.req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);
    if (!body.challengeId || body.credential === undefined) {
      return json({ error: "challengeId and credential are required" }, 400);
    }
    try {
      const { credentialId } = await verifyAddPasskey(
        ceremonyOptions,
        String(body.challengeId),
        body.credential,
        originOf(context.req),
        userId,
      );
      return json({ ok: true, credentialId }, 201);
    } catch (error) {
      const errorMessage = message(error);
      return json({ error: errorMessage }, finishStatus(errorMessage));
    }
  };

  const beginAuth: Middleware<State> = async () => {
    try {
      return json(await beginAuthentication(ceremonyOptions));
    } catch (error) {
      const errorMessage = message(error);
      if (errorMessage.includes("No passkeys")) {
        return json({ error: "No passkeys registered" }, 404);
      }
      return json({ error: errorMessage }, 500);
    }
  };

  const finishAuth: Middleware<State> = async (context) => {
    const body = await readJson(context.req);
    if (!body) return json({ error: "Invalid JSON body" }, 400);
    if (!body.challengeId || body.credential === undefined) {
      return json({ error: "challengeId and credential are required" }, 400);
    }
    try {
      const { userId } = await finishAuthentication(
        ceremonyOptions,
        String(body.challengeId),
        body.credential,
        originOf(context.req),
      );
      return await config.onAuthenticated(userId, context.state);
    } catch (error) {
      const errorMessage = message(error);
      return json({ error: errorMessage }, finishStatus(errorMessage));
    }
  };

  app.get(paths.register, define.middleware(beginRegister));
  app.post(paths.register, define.middleware(finishRegister));
  app.get(paths.addPasskey, define.middleware(beginAdd));
  app.post(paths.addPasskey, define.middleware(finishAdd));
  app.get(paths.authenticate, define.middleware(beginAuth));
  app.post(paths.authenticate, define.middleware(finishAuth));

  return app;
}
