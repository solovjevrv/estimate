import { describe, expect, it, vi } from 'vitest';
import { useAsyncAction } from '../src/composables/use-async-action';

describe('useAsyncAction', () => {
  it('начинает с pending=false, выставляет его синхронно и сбрасывает после успеха', async () => {
    let resolve!: () => void;
    const { pending, execute } = useAsyncAction({
      run: () => new Promise<void>((r) => (resolve = r)),
    });

    expect(pending.value).toBe(false);
    const promise = execute();
    // pending выставляется синхронно, до первого await в run
    expect(pending.value).toBe(true);
    resolve();
    await promise;
    expect(pending.value).toBe(false);
  });

  it('передаёт аргументы в run, затем result и те же аргументы в success', async () => {
    const run = (a: number, b: string) => Promise.resolve(`${b}:${a}`);
    let receivedResult: unknown;
    let receivedArgs: unknown[] = [];
    const { execute } = useAsyncAction({
      run,
      success: (result, ...args) => {
        receivedResult = result;
        receivedArgs = args;
      },
    });

    const result = await execute(42, 'x');
    expect(result).toBe('x:42');
    expect(receivedResult).toBe('x:42');
    expect(receivedArgs).toEqual([42, 'x']);
  });

  it('на ошибке run вызывает error с unknown-ошибкой и возвращает undefined', async () => {
    const boom = new Error('boom');
    let receivedError: unknown;
    let receivedArgs: unknown[] = [];
    const { execute } = useAsyncAction({
      run: (arg: string) => {
        void arg;
        return Promise.reject(boom);
      },
      error: (error, ...args) => {
        receivedError = error;
        receivedArgs = args;
      },
    });

    const result = await execute('arg');
    expect(result).toBeUndefined();
    expect(receivedError).toBe(boom);
    expect(receivedArgs).toEqual(['arg']);
  });

  it('сбрасывает pending после ошибки run', async () => {
    const { pending, execute } = useAsyncAction({
      run: () => Promise.reject(new Error('boom')),
    });

    const promise = execute();
    expect(pending.value).toBe(true);
    await promise;
    expect(pending.value).toBe(false);
  });

  it('не запускает вторую операцию, пока первая не завершилась', async () => {
    let resolveFirst!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((r) => {
          if (!resolveFirst) resolveFirst = r;
        }),
    );
    const { pending, execute } = useAsyncAction({ run });

    const first = execute();
    expect(pending.value).toBe(true);

    const second = execute();
    // run не должен быть вызван повторно, пока первый промис не завершён
    expect(run).toHaveBeenCalledTimes(1);
    const secondResult = await second;
    expect(secondResult).toBeUndefined();

    resolveFirst();
    await first;
    expect(pending.value).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('обрабатывает ошибку success callback как ошибку операции и сбрасывает pending', async () => {
    const successError = new Error('success boom');
    const error = vi.fn();
    const { pending, execute } = useAsyncAction({
      run: () => Promise.resolve(1),
      success: () => {
        throw successError;
      },
      error,
    });

    await expect(execute()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(successError);
    expect(pending.value).toBe(false);
  });

  it('сбрасывает pending, если error callback выбросил исключение', async () => {
    const errorCallbackError = new Error('error boom');
    const { pending, execute } = useAsyncAction({
      run: () => Promise.reject(new Error('run boom')),
      error: () => {
        throw errorCallbackError;
      },
    });

    await expect(execute()).rejects.toBe(errorCallbackError);
    expect(pending.value).toBe(false);
  });
});
