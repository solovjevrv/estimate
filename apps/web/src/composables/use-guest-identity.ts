import { ref, type Ref } from 'vue';

export const GUEST_IDENTITY_STORAGE_KEYS = {
  room: 'estimate:guest-name',
  board: 'estimate:board-guest-name',
} as const;

export type GuestIdentityScope = keyof typeof GUEST_IDENTITY_STORAGE_KEYS;

export interface GuestIdentity {
  /** Имя, восстановленное для формы гостевого входа в этой вкладке. */
  name: Ref<string>;
  /** Запоминает уже нормализованное страницей имя; ошибки storage не блокируют вход. */
  remember: (name: string) => void;
}

/**
 * Имя гостя живёт лишь в sessionStorage: переживает перезагрузку вкладки, но
 * не её закрытие. У комнат и досок разные ключи сознательно — это независимые
 * realtime-идентичности с разными UX-контекстами; список скоупов закрыт типом.
 */
export function useGuestIdentity(scope: GuestIdentityScope): GuestIdentity {
  const key = GUEST_IDENTITY_STORAGE_KEYS[scope];
  const name = ref(read(key));

  function remember(value: string): void {
    name.value = value;
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Приватный режим или заблокированное хранилище не должны мешать входу гостя.
    }
  }

  return { name, remember };
}

function read(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
