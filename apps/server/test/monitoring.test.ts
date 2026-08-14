import { describe, expect, it } from 'vitest';

import { initSentry } from '../src/monitoring';

describe('initSentry', () => {
  it('не включается без DSN', () => {
    expect(initSentry(undefined)).toBe(false);
    expect(initSentry('')).toBe(false);
  });

  it('включается при заданном DSN', () => {
    expect(initSentry('https://key@o0.ingest.sentry.io/0')).toBe(true);
  });
});
