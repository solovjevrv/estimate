/**
 * UUID utility to replace repeated globalThis.crypto.randomUUID() calls
 */
export function uuid(): string {
  return globalThis.crypto.randomUUID();
}