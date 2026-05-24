// Shared between the server plugin (`plugin.ts`) and the island-safe browser
// client (`client.ts`), so it imports no server code. Single source of truth
// for the default endpoint prefix.
export const DEFAULT_BASE_PATH = "/api/auth";

/**
 * Endpoint segments appended to the base path. Each value begins with a slash
 * and is concatenated onto the resolved base (e.g. `/api/auth` + `/register`).
 */
export interface PasskeyPaths {
  /** Registration ceremony (GET begin, POST finish). */
  register: string;
  /** Add-a-passkey ceremony for a signed-in user (GET begin, POST finish). */
  addPasskey: string;
  /** Authentication ceremony (GET begin, POST finish). */
  authenticate: string;
}

/**
 * Endpoint-location options shared by the server plugin config and the browser
 * client config, so both describe where the ceremony URLs live the same way.
 */
export interface PasskeyEndpointConfig {
  /** Endpoint prefix; defaults to `/api/auth`. */
  basePath?: string;
  /** Override individual endpoint segments; defaults to `DEFAULT_PATHS`. */
  paths?: Partial<PasskeyPaths>;
}

/** Default endpoint segments, used when the host overrides none. */
export const DEFAULT_PATHS: PasskeyPaths = {
  register: "/register",
  addPasskey: "/add-passkey",
  authenticate: "/authenticate",
};

/**
 * Resolve fully-qualified endpoint paths from an optional base path and
 * optional per-endpoint segment overrides. Both client and server call this
 * with identical defaults so their URLs always line up.
 */
export function resolvePaths(
  basePath?: string,
  overrides?: Partial<PasskeyPaths>,
): PasskeyPaths {
  const base = basePath ?? DEFAULT_BASE_PATH;
  return {
    register: `${base}${overrides?.register ?? DEFAULT_PATHS.register}`,
    addPasskey: `${base}${overrides?.addPasskey ?? DEFAULT_PATHS.addPasskey}`,
    authenticate: `${base}${
      overrides?.authenticate ?? DEFAULT_PATHS.authenticate
    }`,
  };
}
