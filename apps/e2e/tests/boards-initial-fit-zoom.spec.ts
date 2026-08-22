import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Автофит при первом появлении содержимого доски (17.12): подгонка вида не
 * должна приближать зум БЛИЖЕ 100%, даже если единственный созданный элемент
 * (стикер 180×180) намного меньше viewport. Раньше (до 17.12) `fit-view-on-init`
 * у `<VueFlow>` вызывал библиотечный `fitView()` без опций, а он подгонял зум
 * вплоть до общего `:max-zoom="2"` — воспроизведено на этом же сценарии в
 * `boards-frames-groups.spec.ts` (зум 200% сразу после первого стикера).
 */
test('доска с одним маленьким стикером: автофит не уводит зум выше 100%', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();
  const owner = await createUser('board-init-zoom');
  const context = await newContext(browser);
  await loginAs(context, owner);
  const page = await context.newPage();

  await page.goto('/boards');
  await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
  await page
    .getByPlaceholder('Например, Ретро спринта 24')
    .fill(`${E2E_ROOM_PREFIX}InitZoom ${randomUUID().slice(0, 8)}`);
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);

  const board = boardLocators(page);
  await expect(board.pane).toBeVisible();

  await board.pane.dblclick({ position: { x: 350, y: 250 } });
  await expect(board.stickyNodes).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Автофит — одноразовый асинхронный побочный эффект (ResizeObserver → fitView()),
  // а не монотонное «в итоге станет верным» состояние: без 17.12 зум именно
  // ПРОСКАКИВАЕТ до 200% и там и остаётся — единственная проверка после
  // `toHaveText` в момент, когда авто-фит ещё не сработал, дала бы ложный
  // проход. Опрашиваем несколько раз с запасом по времени (авто-фит в проде
  // отрабатывает так же быстро — сразу после первого ResizeObserver-колбэка,
  // порядка одного кадра), а не полагаемся на один снимок значения.
  for (let i = 0; i < 8; i++) {
    await expect(board.zoom).toHaveText('100%');
    await page.waitForTimeout(150);
  }
});
