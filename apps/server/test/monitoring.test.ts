import { getClient, type ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';

import { ConflictError, UnauthorizedError } from '../src/errors';
import { initSentry, isClientError } from '../src/monitoring';

describe('initSentry', () => {
  it('не включается без DSN', () => {
    expect(initSentry(undefined)).toBe(false);
    expect(initSentry('')).toBe(false);
  });

  it('включается при заданном DSN', () => {
    expect(initSentry('https://key@o0.ingest.sentry.io/0')).toBe(true);
  });

  it('beforeSend отбрасывает событие по 4xx и пропускает остальные', () => {
    initSentry('https://key@o0.ingest.sentry.io/0');
    const beforeSend = getClient()?.getOptions().beforeSend;
    expect(beforeSend).toBeTypeOf('function');

    const event = { event_id: 'id' } as ErrorEvent;
    const mediaType = Object.assign(new Error('Unsupported Media Type'), { statusCode: 415 });

    expect(beforeSend?.(event, { originalException: mediaType })).toBeNull();
    expect(beforeSend?.(event, { originalException: new Error('упало') })).toBe(event);
  });
});

describe('isClientError', () => {
  it('считает клиентскими ошибки приложения с кодом 4xx', () => {
    expect(isClientError(new UnauthorizedError())).toBe(true);
    expect(isClientError(new ConflictError('Передайте владение'))).toBe(true);
  });

  it('узнаёт FastifyError по statusCode (415 от бота с посторонним content-type)', () => {
    const fastifyError = Object.assign(new Error('Unsupported Media Type'), {
      code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE',
      statusCode: 415,
    });

    expect(isClientError(fastifyError)).toBe(true);
  });

  it('узнаёт ошибки сторонних библиотек по полю status', () => {
    expect(isClientError(Object.assign(new Error('too many requests'), { status: 429 }))).toBe(
      true,
    );
  });

  it('не прячет 5xx и ошибки без кода — такие должны доходить до Sentry', () => {
    expect(isClientError(new Error('select * from users упал'))).toBe(false);
    expect(isClientError(Object.assign(new Error('bad gateway'), { statusCode: 502 }))).toBe(false);
    expect(isClientError(Object.assign(new Error('ok?'), { statusCode: 200 }))).toBe(false);
    expect(isClientError(Object.assign(new Error('строкой'), { statusCode: '404' }))).toBe(false);
    expect(isClientError(undefined)).toBe(false);
    expect(isClientError('404')).toBe(false);
  });
});
