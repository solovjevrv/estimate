/** Утилита вместо повторяющегося globalThis.crypto.randomUUID() по всему модулю досок */
export function uuid(): string {
  return globalThis.crypto.randomUUID();
}
