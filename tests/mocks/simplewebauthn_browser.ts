// Stand-in for `@simplewebauthn/browser`, swapped in via tests/import-map.json.
// `client.ts` calls `startRegistration` / `startAuthentication`; `client/mod.ts`
// re-exports the `WebAuthnError` value and `WebAuthnErrorCode` type. Tests import
// this file by relative path to read recorded args and set the returned
// credential.

// deno-lint-ignore no-explicit-any
export type PublicKeyCredentialCreationOptionsJSON = any;
// deno-lint-ignore no-explicit-any
export type PublicKeyCredentialRequestOptionsJSON = any;
export type WebAuthnErrorCode = string;

/** Browser-only error class host apps catch; mirrors the real export. */
export class WebAuthnError extends Error {
  code: WebAuthnErrorCode;
  constructor(message: string, code: WebAuthnErrorCode = "ERROR") {
    super(message);
    this.name = "WebAuthnError";
    this.code = code;
  }
}

export interface BrowserMockState {
  /** Credential `startRegistration` resolves to. */
  registrationCredential: unknown;
  /** Credential `startAuthentication` resolves to. */
  authenticationCredential: unknown;
  /** When set, `startRegistration` rejects with this instead of resolving. */
  registrationError: unknown;
  /** When set, `startAuthentication` rejects with this instead of resolving. */
  authenticationError: unknown;
  lastRegistrationArgs: unknown;
  lastAuthenticationArgs: unknown;
}

function defaults(): BrowserMockState {
  return {
    registrationCredential: { id: "browser-reg-cred", type: "public-key" },
    authenticationCredential: { id: "browser-auth-cred", type: "public-key" },
    registrationError: undefined,
    authenticationError: undefined,
    lastRegistrationArgs: undefined,
    lastAuthenticationArgs: undefined,
  };
}

export const browserMock: BrowserMockState = defaults();

export function resetBrowserMock(): void {
  Object.assign(browserMock, defaults());
}

export function startRegistration(args: unknown): Promise<unknown> {
  browserMock.lastRegistrationArgs = args;
  if (browserMock.registrationError) {
    return Promise.reject(browserMock.registrationError);
  }
  return Promise.resolve(browserMock.registrationCredential);
}

export function startAuthentication(args: unknown): Promise<unknown> {
  browserMock.lastAuthenticationArgs = args;
  if (browserMock.authenticationError) {
    return Promise.reject(browserMock.authenticationError);
  }
  return Promise.resolve(browserMock.authenticationCredential);
}
