import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isSafeInternalPath, rememberRedirect, takeRedirect } from '../src/lib/auth-redirect';

describe('безопасность внутреннего адреса', () => {
  it('принимает обычные внутренние пути', () => {
    expect(isSafeInternalPath('/teams')).toBe(true);
    expect(isSafeInternalPath('/rooms/abc?tab=1')).toBe(true);
  });

  it('отсекает внешние и хитрые адреса', () => {
    expect(isSafeInternalPath('//evil.com')).toBe(false);
    expect(isSafeInternalPath('/\\evil.com')).toBe(false);
    expect(isSafeInternalPath('https://evil.com')).toBe(false);
    expect(isSafeInternalPath('javascript:alert(1)')).toBe(false);
    expect(isSafeInternalPath('teams')).toBe(false);
    expect(isSafeInternalPath('')).toBe(false);
  });
});

describe('запоминание цели входа', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('сохраняет безопасный адрес и отдаёт его один раз', () => {
    rememberRedirect('/teams');

    expect(takeRedirect()).toBe('/teams');
    // Второй раз цели уже нет — возврат разовый
    expect(takeRedirect()).toBeNull();
  });

  it('не сохраняет небезопасный или пустой адрес', () => {
    rememberRedirect('//evil.com');
    rememberRedirect(null);
    rememberRedirect(undefined);

    expect(takeRedirect()).toBeNull();
  });

  it('не отдаёт адрес, если в хранилище оказался небезопасный', () => {
    sessionStorage.setItem('poker:post-login-redirect', 'https://evil.com');

    expect(takeRedirect()).toBeNull();
  });
});
