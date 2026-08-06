/**
 * Простейший throttle с гарантированным финальным вызовом (trailing edge) —
 * для драг-рассылки на холсте доски (12.6): кадры перетаскивания идут гораздо
 * чаще, чем стоит слать по сети, но последняя позиция должна дойти всегда,
 * иначе о ней «забудут» до следующего движения.
 */
export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  const invoke = (args: Args): void => {
    lastCall = Date.now();
    fn(...args);
  };

  return (...args: Args) => {
    const remaining = waitMs - (Date.now() - lastCall);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      invoke(args);
      return;
    }
    pendingArgs = args;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (pendingArgs) invoke(pendingArgs);
        pendingArgs = null;
      }, remaining);
    }
  };
}
