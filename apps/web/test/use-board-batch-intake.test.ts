import type { BoardOpsBatch } from '@estimate/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  useBoardBatchIntake,
  type BatchApplyResult,
} from '../src/features/boards/composables/use-board-batch-intake';

const batch = (revision: number): BoardOpsBatch => ({ revision, ops: [] });

function setup(start = 1) {
  let revision = start;
  const applied: number[] = [];
  const apply = vi.fn((b: BoardOpsBatch): BatchApplyResult => {
    if (b.revision <= revision) return 'stale';
    if (b.revision !== revision + 1) return 'gap';
    revision = b.revision;
    applied.push(b.revision);
    return 'applied';
  });
  let finishResync: () => void = () => {};
  const resync = vi.fn(() => new Promise<void>((resolve) => (finishResync = resolve)));
  const intake = useBoardBatchIntake({ apply, resync });
  return { intake, applied, resync, finish: () => finishResync() };
}

describe('useBoardBatchIntake (10.18)', () => {
  it('пока вход в полёте — копит, потом применяет по возрастанию ревизий', () => {
    const { intake, applied } = setup();
    const started = intake.joinStarted();
    intake.receive(batch(3));
    intake.receive(batch(2));
    expect(applied).toEqual([]);

    intake.joinFinished(started, true);
    expect(applied).toEqual([2, 3]);
  });

  it('вход не дошёл до снимка — отложенное выбрасывается', () => {
    const { intake, applied } = setup();
    const started = intake.joinStarted();
    intake.receive(batch(2));
    intake.joinFinished(started, false);

    intake.receive(batch(3));
    expect(applied).toEqual([]);
  });

  it('дыра — один перезаход, пока он идёт, новых не начинает', async () => {
    const { intake, resync, finish } = setup();
    intake.receive(batch(3));
    intake.receive(batch(4));
    expect(resync).toHaveBeenCalledTimes(1);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    intake.receive(batch(5));
    expect(resync).toHaveBeenCalledTimes(2);
  });

  it('смена доски — вход прежней, завершившийся позже, не проигрывает своё отложенное', () => {
    const { intake, applied } = setup(0);
    const oldJoin = intake.joinStarted();
    intake.receive(batch(1)); // батч доски A, отложен
    intake.reset(); // переход на доску B
    const newJoin = intake.joinStarted();

    intake.joinFinished(newJoin, true); // вход на B: снимок, ревизия 0
    intake.joinFinished(oldJoin, false); // запоздавший вход на A
    expect(applied).toEqual([]);
  });
});
