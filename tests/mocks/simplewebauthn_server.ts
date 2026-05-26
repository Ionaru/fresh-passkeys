// Stand-in for `@simplewebauthn/server`, swapped in via tests/import-map.json.
// `ceremonies.ts` imports the four functions below; this module lets each test
// drive their outcome (verified true/false, the returned credential, the
// counter) and records the arguments the ceremony passed in for assertions.
//
// It models the real v13 contract on the axes the plugin depends on:
//   - verify* reject a credential with no `id` (real lib throws "Missing
//     credential ID"), so tests must feed a real-shaped credential;
//   - verifyAuthenticationResponse enforces the signature-counter rule, so a
//     non-advancing counter throws like the real lib (replay protection);
//   - generate*Options return a populated options object, not just a challenge.
//
// Tests import this file by relative path to configure `serverMock`; the
// ceremony code imports `@simplewebauthn/server`, which the import map resolves
// to this same file URL, so both share one module instance.

export type AuthenticatorTransportFuture =
  | "usb"
  | "nfc"
  | "ble"
  | "internal"
  | "hybrid";

/** Credential shape `verifyRegistrationResponse` reports back. */
export interface MockRegistrationCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
}

export interface ServerMockState {
  /** Value `generateRegistrationOptions` puts in `.challenge`. */
  regChallenge: string;
  /** Value `generateAuthenticationOptions` puts in `.challenge`. */
  authChallenge: string;
  /** `verifyRegistrationResponse().verified`. */
  registrationVerified: boolean;
  /** When false, `registrationInfo` is omitted from the result. */
  registrationInfoPresent: boolean;
  /** Credential returned inside `registrationInfo`. */
  registrationCredential: MockRegistrationCredential;
  /** `verifyAuthenticationResponse().verified`. */
  authenticationVerified: boolean;
  /** Counter the assertion claims; enforced against the stored counter. */
  newCounter: number;
  lastGenerateRegistrationArgs: Record<string, unknown> | undefined;
  lastGenerateAuthenticationArgs: Record<string, unknown> | undefined;
  lastVerifyRegistrationArgs: Record<string, unknown> | undefined;
  lastVerifyAuthenticationArgs: Record<string, unknown> | undefined;
}

function defaults(): ServerMockState {
  return {
    regChallenge: "reg-challenge",
    authChallenge: "auth-challenge",
    registrationVerified: true,
    registrationInfoPresent: true,
    registrationCredential: {
      id: "cred-id",
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      transports: ["internal", "hybrid"],
    },
    authenticationVerified: true,
    newCounter: 5,
    lastGenerateRegistrationArgs: undefined,
    lastGenerateAuthenticationArgs: undefined,
    lastVerifyRegistrationArgs: undefined,
    lastVerifyAuthenticationArgs: undefined,
  };
}

export const serverMock: ServerMockState = defaults();

/** Restore every field to its default; call between tests/steps. */
export function resetServerMock(): void {
  Object.assign(serverMock, defaults());
}

const PUB_KEY_CRED_PARAMS = [
  { alg: -7, type: "public-key" },
  { alg: -257, type: "public-key" },
];

export function generateRegistrationOptions(
  options: Record<string, unknown>,
): Promise<{ challenge: string; [key: string]: unknown }> {
  serverMock.lastGenerateRegistrationArgs = options;
  return Promise.resolve({
    challenge: serverMock.regChallenge,
    rp: { name: options.rpName, id: options.rpID },
    user: { name: options.userName, displayName: options.userDisplayName },
    pubKeyCredParams: PUB_KEY_CRED_PARAMS,
    excludeCredentials: options.excludeCredentials ?? [],
    authenticatorSelection: options.authenticatorSelection,
    attestation: options.attestationType ?? "none",
  });
}

export function generateAuthenticationOptions(
  options: Record<string, unknown>,
): Promise<{ challenge: string; [key: string]: unknown }> {
  serverMock.lastGenerateAuthenticationArgs = options;
  return Promise.resolve({
    challenge: serverMock.authChallenge,
    rpId: options.rpID,
    userVerification: options.userVerification,
    allowCredentials: [],
  });
}

function credentialId(args: Record<string, unknown>): string {
  const response = args.response as { id?: unknown } | undefined;
  if (!response || typeof response.id !== "string" || response.id === "") {
    throw new Error("Missing credential ID");
  }
  return response.id;
}

export function verifyRegistrationResponse(
  args: Record<string, unknown>,
): Promise<{
  verified: boolean;
  registrationInfo?: { credential: MockRegistrationCredential };
}> {
  serverMock.lastVerifyRegistrationArgs = args;
  credentialId(args); // real lib rejects a credential with no id
  if (!serverMock.registrationVerified || !serverMock.registrationInfoPresent) {
    return Promise.resolve({ verified: serverMock.registrationVerified });
  }
  return Promise.resolve({
    verified: true,
    registrationInfo: { credential: serverMock.registrationCredential },
  });
}

export function verifyAuthenticationResponse(
  args: Record<string, unknown>,
): Promise<{ verified: boolean; authenticationInfo: { newCounter: number } }> {
  serverMock.lastVerifyAuthenticationArgs = args;
  credentialId(args);
  const stored = args.credential as { counter: number };
  const prev = stored.counter;
  const next = serverMock.newCounter;
  // Real lib throws when a supported counter fails to strictly advance.
  if ((prev !== 0 || next !== 0) && next <= prev) {
    throw new Error(
      `Response counter value ${next} was lower than expected ${prev}`,
    );
  }
  return Promise.resolve({
    verified: serverMock.authenticationVerified,
    authenticationInfo: { newCounter: next },
  });
}
