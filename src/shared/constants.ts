// Shared between the server plugin (`plugin.ts`) and the island-safe browser
// client (`client.ts`), so it imports no server code. Single source of truth
// for the default endpoint prefix.
export const DEFAULT_BASE_PATH = "/api/auth";
