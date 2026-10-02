import type { BoardTimerState } from '@estimate/shared';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import BoardTimer from '../src/components/board/BoardTimer.vue';
import {
  boardTimerPhase,
  type BoardTimerCommands,
} from '../src/features/boards/composables/use-board-timer';
import { createAppI18n } from '../src/i18n';

const toastAdd = vi.fn();
vi.mock('@nuxt/ui/composables', async () => {
  const actual =
    await vi.importActual<typeof import('@nuxt/ui/composables')>('@nuxt/ui/composables');
  return { ...actual, useToast: () => ({ add: toastAdd, remove: vi.fn() }) };
});

const NOW = new Date('2026-10-02T10:00:00.000Z').getTime();

function idle(durationSec = 300): BoardTimerState {
  return { durationSec, running: false, endsAt: null, remainingSec: durationSec };
}

function running(leftSec: number, durationSec = 300): BoardTimerState {
  return {
    durationSec,
    running: true,
    endsAt: new Date(NOW + leftSec * 1000).toISOString(),
    remainingSec: durationSec,
  };
}

function commands(): BoardTimerCommands & Record<string, ReturnType<typeof vi.fn>> {
  return {
    start: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    extend: vi.fn(async () => {}),
  };
}

function mountTimer(timer: BoardTimerState, canControl = true, cmds = commands()) {
  const wrapper = mount(BoardTimer, {
    attachTo: document.body,
    global: { plugins: [createAppI18n('ru')] },
    props: { timer, canControl, commands: cmds },
  });
  return { wrapper, cmds };
}

/** Поповер телепортируется в body — ищем в документе, а не в wrapper */
function inPopover(testId: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
}

async function openPopover(wrapper: ReturnType<typeof mountTimer>['wrapper']): Promise<void> {
  await wrapper.find('[data-testid="board-timer-open"]').trigger('click');
  await nextTick();
}

describe('boardTimerPhase', () => {
  it('различает исходный, бегущий, паузу и истёкший', () => {
    expect(boardTimerPhase(idle(), 300)).toBe('idle');
    expect(boardTimerPhase(running(120), 120)).toBe('running');
    expect(boardTimerPhase(running(0), 0)).toBe('expired');
    expect(boardTimerPhase({ ...idle(), remainingSec: 200 }, 200)).toBe('paused');
    // Пауза после «+1 мин» — остаток больше длительности, но это всё ещё пауза
    expect(boardTimerPhase({ ...idle(), remainingSec: 360 }, 360)).toBe('paused');
  });
});

describe('BoardTimer (15.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    toastAdd.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('зрителю исходный таймер не показывается, бегущий — без управления', async () => {
    const { wrapper } = mountTimer(idle(), false);
    expect(wrapper.find('[data-testid="board-timer"]').exists()).toBe(false);

    await wrapper.setProps({ timer: running(272) });

    expect(wrapper.find('[data-testid="board-timer"]').text()).toContain('4:32');
    expect(wrapper.find('[data-testid="board-timer-control"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="board-timer-open"]').exists()).toBe(false);
  });

  it('кнопка в пилюле: старт → пауза → сброс истёкшего', async () => {
    const { wrapper, cmds } = mountTimer(idle());
    await wrapper.find('[data-testid="board-timer-control"]').trigger('click');
    expect(cmds.start).toHaveBeenCalledOnce();

    await wrapper.setProps({ timer: running(100) });
    await wrapper.find('[data-testid="board-timer-control"]').trigger('click');
    await flushPromises();
    expect(cmds.pause).toHaveBeenCalledOnce();

    await wrapper.setProps({ timer: running(0) });
    expect(wrapper.find('[data-testid="board-timer"]').attributes('data-phase')).toBe('expired');
    await wrapper.find('[data-testid="board-timer-control"]').trigger('click');
    await flushPromises();
    expect(cmds.reset).toHaveBeenCalledWith(undefined);
  });

  it('время идёт от endsAt без событий сервера', async () => {
    const { wrapper } = mountTimer(running(65));
    expect(wrapper.find('[data-testid="board-timer"]').text()).toContain('1:05');

    vi.advanceTimersByTime(5_000);
    await nextTick();

    expect(wrapper.find('[data-testid="board-timer"]').text()).toContain('1:00');
  });

  it('до старта: пресеты и −/+ задают длительность, активный пресет — Primary', async () => {
    const { wrapper, cmds } = mountTimer(idle(300));
    await openPopover(wrapper);

    expect(inPopover('board-timer-preset-5')?.getAttribute('aria-pressed')).toBe('true');
    expect(inPopover('board-timer-preset-1')?.getAttribute('aria-pressed')).toBe('false');

    inPopover('board-timer-preset-1')!.click();
    await flushPromises();
    expect(cmds.reset).toHaveBeenLastCalledWith(60);

    inPopover('board-timer-increase')!.click();
    await flushPromises();
    expect(cmds.reset).toHaveBeenLastCalledWith(360);

    expect(inPopover('board-timer-extend')).toBeNull();
  });

  it('−/+ упираются в 1 и 120 минут', async () => {
    const { wrapper } = mountTimer(idle(60));
    await openPopover(wrapper);
    expect(inPopover('board-timer-decrease')?.disabled).toBe(true);

    await wrapper.setProps({ timer: idle(7200) });
    await nextTick();
    expect(inPopover('board-timer-increase')?.disabled).toBe(true);
    expect(inPopover('board-timer-dial')?.textContent).toContain('120:00');
  });

  it('во время отсчёта: без пресетов и −/+, есть «+1 мин» и пауза', async () => {
    const { wrapper, cmds } = mountTimer(running(200));
    await openPopover(wrapper);

    expect(inPopover('board-timer-preset-5')).toBeNull();
    expect(inPopover('board-timer-increase')).toBeNull();

    inPopover('board-timer-extend')!.click();
    await flushPromises();
    expect(cmds.extend).toHaveBeenCalledOnce();

    inPopover('board-timer-primary')!.click();
    await flushPromises();
    expect(cmds.pause).toHaveBeenCalledOnce();
  });

  it('по нулю — тост у всех, включая зрителя; вход на уже истёкший — без тоста', async () => {
    mountTimer(running(2), false);
    vi.advanceTimersByTime(2_500);
    await nextTick();

    expect(toastAdd).toHaveBeenCalledOnce();
    expect(toastAdd.mock.calls[0]![0]).toMatchObject({ title: 'Время вышло', color: 'error' });

    toastAdd.mockClear();
    mountTimer(running(0), false);
    await nextTick();
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it('выключатель звука запоминается в браузере', async () => {
    const { wrapper } = mountTimer(idle());
    await openPopover(wrapper);

    document
      .querySelector<HTMLButtonElement>('[data-testid="board-timer-popover"] [role="switch"]')!
      .click();
    await nextTick();

    expect(localStorage.getItem('estimate-board-timer-sound')).toBe('on');
  });
});
