import { describe, expect, it, vi } from 'vitest';

import { useArchiveTab } from '../src/composables/use-archive-tab';

describe('useArchiveTab', () => {
  it('загружает архив один раз при повторном раскрытии', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const afterLoad = vi.fn();
    const archive = useArchiveTab(load, afterLoad);

    await archive.toggle();
    expect(archive.open).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(afterLoad).toHaveBeenCalledTimes(1);

    await archive.toggle();
    await archive.toggle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('не запускает второй запрос, пока первый ещё выполняется', async () => {
    let resolveLoad: (() => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const archive = useArchiveTab(load);

    const first = archive.activate();
    const second = archive.activate();
    expect(load).toHaveBeenCalledTimes(1);
    expect(archive.loading).toBe(true);

    resolveLoad?.();
    await Promise.all([first, second]);
    expect(archive.loading).toBe(false);
  });

  it('после ошибки позволяет повторить загрузку', async () => {
    const load = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const archive = useArchiveTab(load);

    await archive.activate();
    expect(archive.failed).toBe(true);

    await archive.activate();
    expect(load).toHaveBeenCalledTimes(2);
    expect(archive.failed).toBe(false);
  });

  it('reset отменяет UI-результат устаревшего запроса', async () => {
    let resolveLoad: (() => void) | undefined;
    const archive = useArchiveTab(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const loading = archive.activate();
    archive.reset();
    resolveLoad?.();
    await loading;

    expect(archive.open).toBe(false);
    expect(archive.loading).toBe(false);
    expect(archive.failed).toBe(false);
  });
});
