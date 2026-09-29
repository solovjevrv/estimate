/**
 * Тесты LottieSticker.vue (21.8): рендер через renderer: 'canvas' и пауза/
 * возобновление анимации по IntersectionObserver (см. docs/sticker-animation-perf-report.md).
 * lottie-web подменяется через vi.mock — тестируем логику компонента, а не саму библиотеку.
 * IntersectionObserver подменяется управляемым стабом (глобальный из test/setup.ts не годится —
 * он всегда стреляет isIntersecting: true сразу).
 */
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAnim = vi.hoisted(() => ({
  play: vi.fn(),
  pause: vi.fn(),
  destroy: vi.fn(),
}));
const loadAnimation = vi.hoisted(() => vi.fn(() => mockAnim));

vi.mock('lottie-web', () => ({ default: { loadAnimation } }));

type ObserverCallback = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;

let observeSpy: ReturnType<typeof vi.fn>;
let disconnectSpy: ReturnType<typeof vi.fn>;
let observerCallback: ObserverCallback | null = null;

class ControllableIntersectionObserver {
  constructor(callback: ObserverCallback) {
    observerCallback = callback;
  }
  observe = observeSpy;
  disconnect = disconnectSpy;
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];
}

function fireIntersection(isIntersecting: boolean): void {
  observerCallback?.([{ target: document.createElement('div'), isIntersecting }]);
}

describe('LottieSticker', () => {
  beforeEach(() => {
    loadAnimation.mockClear();
    mockAnim.play.mockClear();
    mockAnim.pause.mockClear();
    mockAnim.destroy.mockClear();
    observeSpy = vi.fn();
    disconnectSpy = vi.fn();
    observerCallback = null;
    vi.stubGlobal('IntersectionObserver', ControllableIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function mountSticker() {
    const { default: LottieSticker } = await import('../src/components/board/LottieSticker.vue');
    const wrapper = mount(LottieSticker, { props: { src: 'https://example.test/sticker.json' } });
    // дать резолвиться await import('lottie-web') внутри load()
    await new Promise((resolve) => setTimeout(resolve, 10));
    await wrapper.vm.$nextTick();
    return wrapper;
  }

  it('рендерит через renderer: canvas (не svg — 21.8, снижает CPU/DOM-стоимость)', async () => {
    await mountSticker();
    expect(loadAnimation).toHaveBeenCalledWith(expect.objectContaining({ renderer: 'canvas' }));
  });

  it('подписывается на IntersectionObserver при монтировании', async () => {
    await mountSticker();
    expect(observeSpy).toHaveBeenCalledTimes(1);
  });

  it('ставит анимацию на паузу, когда стикер уходит за пределы экрана', async () => {
    await mountSticker();
    fireIntersection(false);
    expect(mockAnim.pause).toHaveBeenCalled();
    expect(mockAnim.play).not.toHaveBeenCalled();
  });

  it('возобновляет анимацию, когда стикер возвращается в видимую область', async () => {
    await mountSticker();
    fireIntersection(false);
    fireIntersection(true);
    expect(mockAnim.play).toHaveBeenCalled();
  });

  it('изначально не видим (isVisible=false до первого срабатывания observer) — создаётся без autoplay', async () => {
    await mountSticker();
    expect(loadAnimation).toHaveBeenCalledWith(expect.objectContaining({ autoplay: false }));
  });

  it('отписывается от observer и уничтожает анимацию при размонтировании', async () => {
    const wrapper = await mountSticker();
    wrapper.unmount();
    expect(disconnectSpy).toHaveBeenCalled();
    expect(mockAnim.destroy).toHaveBeenCalled();
  });
});
