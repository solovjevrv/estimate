import type { Locator } from '@playwright/test';

import { expect } from './fixtures';

/**
 * Ждёт, пока `boundingBox()` локатора не перестанет меняться между двумя
 * последовательными опросами, и возвращает финальное значение (17.12).
 *
 * Нужен там, где сразу после создания/фита элемента координаты кликов
 * считаются от его текущего положения на экране: автофит доски (одноразовый,
 * по первому появившемуся узлу) срабатывает асинхронно — ResizeObserver
 * колбэк может выполниться и до, и после следующей строчки теста. Проверка
 * одного лишь текста зума («100%») этого не ловит: если фит ещё не сработал,
 * зум и так уже 100% по умолчанию — ассерт пройдёт, не дождавшись
 * последующего сдвига pan/zoom, и координаты клика окажутся устаревшими.
 */
export async function waitForStableBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  let previousKey: string | null = null;
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      const key = box ? `${box.x},${box.y},${box.width},${box.height}` : null;
      const stable = key !== null && key === previousKey;
      previousKey = key;
      return stable;
    })
    .toBe(true);
  const box = await locator.boundingBox();
  if (!box) throw new Error('waitForStableBox: элемент исчез после стабилизации');
  return box;
}
