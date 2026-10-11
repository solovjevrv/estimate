import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { expectVoted } from '../src/room-helpers';

/**
 * Оценка в покере с доски (15.6): стикер → «Оценить в покере» → комната с
 * текстом стикера в новой вкладке, в шапке — «Из доски «…»»; на стикере бейдж
 * «♠ —», после вскрытия карт — «♠ 8». Повторно — «Открыть комнату», без дублей.
 */
test('стикер → комната оценки → оценка вернулась на доску', async ({
  page,
  createUser,
  loginAs,
}) => {
  test.slow();
  const owner = await createUser('board-estimate');
  await loginAs(page.context(), owner);
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Новая доска', exact: true }).click();
  const boardTitle = `${E2E_ROOM_PREFIX}Estimate ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardTitle);
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const board = boardLocators(page);
  await expect(board.joined).toBeVisible();

  // Текст стикера станет названием комнаты — с префиксом, чтобы e2e-уборка её нашла
  const task = `${E2E_ROOM_PREFIX}Экспорт доски ${randomUUID().slice(0, 6)}`;
  await board.pane.dblclick({ position: { x: 400, y: 300 } });
  await expect(board.stickyNodes).toHaveCount(1);
  await page.keyboard.type(task);
  await board.pane.click({ position: { x: 950, y: 450 } });
  await expect(board.stickyNodes.first()).toContainText(task);

  await board.stickyNodes.first().click();
  const button = page.getByTestId('board-estimate-button');
  await expect(button).toHaveAttribute('data-action', 'create');
  const [room] = await Promise.all([page.waitForEvent('popup'), button.click()]);
  await room.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const roomUrl = room.url();

  // Комната названа текстом стикера и знает, откуда она
  await expect(room.getByRole('heading', { level: 1 })).toHaveText(task);
  await expect(room.getByTestId('room-from-board')).toHaveText(`«${boardTitle}»`);

  // На доске — бейдж «карты ещё не вскрыты», кнопка теперь открывает ту же комнату
  const badge = board.stickyNodes.first().getByTestId('board-estimate-badge');
  await expect(badge).toHaveAttribute('data-pending', 'true');
  await board.stickyNodes.first().click();
  await expect(button).toHaveAttribute('data-action', 'open');

  // Раунд в комнате: голос 8 → вскрытие → «♠ 8» на доске без перезагрузки
  await room.getByRole('button', { name: 'Начать раунд' }).click();
  await room.getByRole('button', { name: '8', exact: true }).click();
  await expectVoted(room, 1, 1);
  await room.getByRole('button', { name: 'Вскрыть карты' }).click();
  await expect(room.getByText('Результаты раунда')).toBeVisible();

  await expect(badge).toHaveAttribute('data-pending', 'false');
  await expect(badge).toHaveText('8');
  expect(await badge.getAttribute('href')).toBe(new URL(roomUrl).pathname);
});
