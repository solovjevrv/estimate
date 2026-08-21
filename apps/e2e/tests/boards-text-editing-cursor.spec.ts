import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * При редактировании курсор должен сообщать о вводе текста, а не наследовать
 * `grabbing` от draggable-узла Vue Flow. Каждый тип создаём на чистой доске:
 * плавающий тулбар предыдущего выделения не может перекрыть следующий клик.
 */
for (const scenario of [
  { name: 'стикер', node: 'sticky', tool: null },
  { name: 'фигура', node: 'shape', tool: 'Фигура' },
  { name: 'свободный текст', node: 'text', tool: 'Текст' },
] as const) {
  test(`${scenario.name}: редактируемый текст использует текстовый курсор`, async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-text-cursor');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await page
      .getByPlaceholder('Например, Ретро спринта 24')
      .fill(`${E2E_ROOM_PREFIX} Text cursor ${randomUUID().slice(0, 8)}`);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);

    const board = boardLocators(page);
    const pane = board.pane;
    await expect(pane).toBeVisible();

    if (scenario.tool) {
      await board.toolbarButton(scenario.tool).click();
      await pane.click({ position: { x: 650, y: 350 } });
    } else {
      // Стикер создаётся двойным кликом, как основной пользовательский сценарий.
      await pane.dblclick({ position: { x: 350, y: 250 } });
    }

    await expect(board.nodeByType(scenario.node).locator('[contenteditable="true"]')).toHaveCSS(
      'cursor',
      'text',
    );
  });
}
