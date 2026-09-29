import { afterEach, describe, expect, it } from 'vitest';

import {
  GUEST_IDENTITY_STORAGE_KEYS,
  useGuestIdentity,
} from '../src/composables/use-guest-identity';

afterEach(() => {
  sessionStorage.clear();
});

describe('useGuestIdentity', () => {
  it('восстанавливает имя только в пределах своего скоупа', () => {
    sessionStorage.setItem(GUEST_IDENTITY_STORAGE_KEYS.room, 'Мария');
    sessionStorage.setItem(GUEST_IDENTITY_STORAGE_KEYS.board, 'Иван');

    expect(useGuestIdentity('room').name.value).toBe('Мария');
    expect(useGuestIdentity('board').name.value).toBe('Иван');
  });

  it('запоминает имя для следующего создания composable', () => {
    const identity = useGuestIdentity('room');

    identity.remember('Гость');

    expect(identity.name.value).toBe('Гость');
    expect(sessionStorage.getItem(GUEST_IDENTITY_STORAGE_KEYS.room)).toBe('Гость');
    expect(useGuestIdentity('room').name.value).toBe('Гость');
  });
});
