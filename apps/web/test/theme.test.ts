import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Простая замена matchMedia: сообщает заданный признак и запоминает подписчиков */
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners: Array<() => void> = [];
  window.matchMedia = vi.fn().mockReturnValue({
    get matches() {
      return matches;
    },
    addEventListener: (_: string, handler: () => void) => listeners.push(handler),
    removeEventListener: () => {},
  }) as unknown as typeof window.matchMedia;

  return {
    setMatches: (next: boolean) => {
      matches = next;
      listeners.forEach((h) => h());
    },
  };
}

describe('тема оформления', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('без сохранённого выбора работает по системному признаку', async () => {
    stubMatchMedia(true);
    const { initTheme, theme } = await import('../src/lib/theme');

    initTheme();

    expect(theme.value).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('запоминает явный выбор в localStorage и переживает перезагрузку модуля', async () => {
    stubMatchMedia(false);
    const first = await import('../src/lib/theme');
    first.initTheme();

    first.theme.value = 'dark';
    await Promise.resolve();

    expect(localStorage.getItem('poker:theme')).toBe('dark');

    vi.resetModules();
    stubMatchMedia(false);
    const second = await import('../src/lib/theme');
    expect(second.theme.value).toBe('dark');
  });

  it('светлая тема снимает класс dark даже при тёмной системной', async () => {
    stubMatchMedia(true);
    const { initTheme, theme } = await import('../src/lib/theme');
    initTheme();

    theme.value = 'light';
    await Promise.resolve();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('в системном режиме реагирует на смену системного признака', async () => {
    const media = stubMatchMedia(false);
    const { initTheme, theme } = await import('../src/lib/theme');
    initTheme();
    expect(theme.value).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    media.setMatches(true);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('недоступное хранилище не мешает работать на системной теме', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('хранилище недоступно');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('хранилище недоступно');
    });
    stubMatchMedia(false);
    const { initTheme, theme } = await import('../src/lib/theme');

    initTheme();
    theme.value = 'dark';
    await Promise.resolve();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
