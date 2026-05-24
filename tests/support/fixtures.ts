// Realistic WebAuthn credential shapes for verify-path tests. The faithful
// server mock (tests/mocks/simplewebauthn_server.ts) rejects a credential
// without an `id`, just as @simplewebauthn/server v13 does — so tests must feed
// a real-shaped object rather than `{}`.

export interface CredentialResponse {
  id: string;
  rawId: string;
  type: "public-key";
  response: Record<string, unknown>;
  clientExtensionResults: Record<string, unknown>;
}

/** A minimal but real-shaped signed credential carrying `id`. */
export function credentialResponse(id: string): CredentialResponse {
  return {
    id,
    rawId: id,
    type: "public-key",
    response: {},
    clientExtensionResults: {},
  };
}
