import { describe, expect, it } from 'vitest';

import { PerSocketQueue } from '../src/platform/realtime';

describe('PerSocketQueue', () => {
  it('задачи одного сокета — по очереди, даже если первая дольше', async () => {
    const queue = new PerSocketQueue();
    const socket = {};
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));

    const first = queue.run(socket, async () => {
      await gate;
      order.push('первая');
    });
    const second = queue.run(socket, async () => {
      order.push('вторая');
    });
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['первая', 'вторая']);
  });

  it('отказ задачи не отменяет следующую; разные сокеты друг друга не ждут', async () => {
    const queue = new PerSocketQueue();
    const socket = {};
    const failed = queue.run(socket, async () => {
      throw new Error('нет доступа');
    });
    const next = queue.run(socket, async () => 'вошёл');

    await expect(failed).rejects.toThrow('нет доступа');
    await expect(next).resolves.toBe('вошёл');

    let neverRelease: () => void = () => {};
    void queue.run(socket, () => new Promise<void>((resolve) => (neverRelease = resolve)));
    await expect(queue.run({}, async () => 'другой сокет')).resolves.toBe('другой сокет');
    neverRelease();
  });
});
