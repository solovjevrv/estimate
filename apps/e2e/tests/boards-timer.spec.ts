import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Таймер доски (15.3) сквозь настоящие WS-соединения: два независимых
 * контекста одного владельца на одной личной доске (как в
 * `boards-realtime-sync.spec.ts`). A выбирает пресет и запускает — B видит
 * отсчёт; B ставит паузу — A видит паузу. Сигнал по нулю проверяется в B
 * часами страницы (`page.clock`): ждать минуту реального времени незачем,
 * остаток клиент и так считает сам от `endsAt`.
 */
test('таймер доски синхронизируется между участниками и сигналит по нулю', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('board-timer');
  const contextA = await newContext(browser);
  await loginAs(contextA, owner);
  const pageA = await contextA.newPage();
  await pageA.goto('/boards');

  await pageA.getByRole('button', { name: 'Новая доска', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}Timer ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardUrl = pageA.url();
  await expect(boardLocators(pageA).pane).toBeVisible();

  const contextB = await newContext(browser);
  await loginAs(contextB, owner);
  const pageB = await contextB.newPage();
  await pageB.clock.install();
  await pageB.goto(boardUrl);
  await expect(boardLocators(pageB).pane).toBeVisible();

  const timerA = pageA.getByTestId('board-timer');
  const timerB = pageB.getByTestId('board-timer');
  await expect(timerA).toHaveAttribute('data-phase', 'idle');
  await expect(timerA).toContainText('5:00');

  // A: пресет «1 мин» в поповере — B видит новую длительность
  await pageA.getByTestId('board-timer-open').click();
  await pageA.getByTestId('board-timer-preset-1').click();
  await expect(pageA.getByTestId('board-timer-preset-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(timerB).toContainText('1:00');

  // A запускает — у B идёт отсчёт
  await pageA.getByTestId('board-timer-primary').click();
  await expect(timerB).toHaveAttribute('data-phase', 'running');
  await expect(timerA).toHaveAttribute('data-phase', 'running');
  await pageA.keyboard.press('Escape');

  // B ставит на паузу кнопкой в пилюле — у A пауза. Сначала дожидаемся, что
  // отсчёт сдвинулся: пауза с остатком, равным длительности, неотличима от
  // исходного состояния (и показывается как оно)
  await expect(timerA).toContainText('0:5');
  await pageB.getByTestId('board-timer-control').click();
  await expect(timerA).toHaveAttribute('data-phase', 'paused');

  // B продолжает и проматывает свои часы за ноль — красное состояние и тост
  await pageB.getByTestId('board-timer-control').click();
  await expect(timerB).toHaveAttribute('data-phase', 'running');
  await pageB.clock.fastForward('01:05');
  await expect(timerB).toHaveAttribute('data-phase', 'expired');
  await expect(timerB).toContainText('0:00');
  // exact: у тоста есть скрытый дубль для скринридеров (role=alert) — он не нужен
  await expect(pageB.getByText('Время вышло', { exact: true })).toBeVisible();

  // A сбрасывает из поповера — у обоих снова исходные 1:00. Сбрасывает именно
  // A: промотка часов B на минуту рвёт у B heartbeat сокета, и B переподключается
  await pageA.getByTestId('board-timer-open').click();
  await pageA.getByTestId('board-timer-reset').click();
  await expect(timerA).toHaveAttribute('data-phase', 'idle');
  await expect(timerA).toContainText('1:00');
  await expect(timerB).toHaveAttribute('data-phase', 'idle');
});
