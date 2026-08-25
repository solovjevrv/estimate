/** jsdom не реализует matchMedia — им пользуется тема (system/light/dark) */
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
}

/**
 * jsdom не реализует IntersectionObserver — LottieSticker.vue (21.8) им пользуется для паузы
 * анимации вне вьюпорта. По умолчанию считаем элемент видимым сразу при observe() — как в
 * реальном браузере, где коллбэк стреляет с текущим состоянием сразу после подписки — чтобы
 * тесты, монтирующие анимированные стикеры, не должны были знать об этом нюансе. Тесты самого
 * LottieSticker.vue подменяют этот стаб своим управляемым через vi.stubGlobal.
 */
if (!window.IntersectionObserver) {
  class FakeIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element): void {
      this.callback(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
}
