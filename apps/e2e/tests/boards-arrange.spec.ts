import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { waitForStableBox } from '../src/stable-box';

/**
 * Раскладка (15.4): выделить стикеры → «Разложить» → «По цвету» — кучка
 * уезжает во фрейм с заголовком «Жёлтые · 2», тост «Отменить» возвращает всё
 * как было одной отменой (фрейма нет, стикеры на месте).
 */
test('раскладка по цвету во фрейм и отмена из тоста', async ({ page, createUser, loginAs }) => {
  const owner = await createUser('board-arrange');
  await loginAs(page.context(), owner);
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Новая доска', exact: true }).click();
  await page
    .getByPlaceholder('Например, Ретро спринта 24')
    .fill(`${E2E_ROOM_PREFIX}Arrange ${randomUUID().slice(0, 8)}`);
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const board = boardLocators(page);
  await expect(board.pane).toBeVisible();

  // Два стикера (см. addTwoStickies в boards-voting.spec.ts)
  await board.pane.dblclick({ position: { x: 300, y: 300 } });
  await expect(board.stickyNodes).toHaveCount(1);
  await board.pane.click({ position: { x: 950, y: 450 } });
  const firstBox = await waitForStableBox(board.stickyNodes.first());
  await page.mouse.dblclick(firstBox.x + 400, firstBox.y + firstBox.height / 2 + 60);
  await expect(board.stickyNodes).toHaveCount(2);
  await board.pane.click({ position: { x: 950, y: 450 } });
  await page.keyboard.press('Escape');

  // Один стикер выделен — раскладывать нечего
  await board.stickyNodes.first().click();
  await expect(page.getByTestId('board-arrange-button')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+a');
  await page.getByTestId('board-arrange-button').click();
  await expect(page.getByTestId('board-arrange-menu')).toBeVisible();
  // Голосований не было — «По голосам» недоступно
  await expect(page.getByTestId('board-arrange-votes')).toBeDisabled();
  await page.getByTestId('board-arrange-color').click();

  await expect(board.frameNodes).toHaveCount(1);
  // Заголовок фрейма — поле ввода (правится на месте), не текст узла
  await expect(
    board.frameNodes.first().getByRole('textbox', { name: 'Заголовок фрейма' }),
  ).toHaveValue('Жёлтые · 2');
  await expect(board.stickyNodes).toHaveCount(2);
  // Тост Nuxt UI дублирует текст для скринридеров — берём его заголовок
  await expect(
    page.locator('[data-slot="title"]', { hasText: 'Разложено по цвету' }),
  ).toBeVisible();

  // «Отменить» есть и в панели управления доски (undo) — жмём именно в тосте
  await page
    .getByRole('region', { name: /Notifications/ })
    .getByRole('button', { name: 'Отменить' })
    .click();
  await expect(board.frameNodes).toHaveCount(0);
  await expect(board.stickyNodes).toHaveCount(2);
});
