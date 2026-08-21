import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

const MAX_LENGTH = 2000;

/**
 * Drag&drop чужого текста в contenteditable стикера (12.25). До сих пор
 * блокировался только через `onEditableBeforeInput` (тип `insertFromDrop` не
 * входит в разрешённые `GROWING_INPUT_TYPES`) — на движках/версиях, где
 * `beforeinput` не летит для перетаскивания, это единственная линия защиты
 * пропадала. Теперь есть явный `@drop="onEditableDrop"`, обрезающий вставку
 * по тому же бюджету длины, что и `onEditablePaste`.
 *
 * Реальный HTML5 drag&drop через `page.mouse` ненадёжен в Playwright (та же
 * гоча, что и с IME-композицией — см. `boards-ime-composition-limit.spec.ts`),
 * поэтому тест эмулирует событийный контракт, который реально слушает
 * `@drop="onEditableDrop"` — включая настоящий `document.caretRangeFromPoint`,
 * который jsdom (юнит-тесты в `use-rich-text-editing.test.ts`) не реализует,
 * а Chromium — реализует, поэтому эта проверка живая, не дубль юнит-теста.
 */
test('drop чужого текста в contenteditable обрезается по лимиту длины (12.25)', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('board-drop-limit');
  const context = await newContext(browser);
  await loginAs(context, owner);
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/boards');
  await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}Drop ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  const board = boardLocators(page);

  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  await expect(board.pane).toBeVisible();

  await board.pane.dblclick({ position: { x: 300, y: 300 } });
  await expect(board.stickyNodes).toHaveCount(1);
  const id = await board.stickyNodes.getAttribute('data-node-id');
  const el = page.locator(`[data-node-id="${id}"] [contenteditable="true"]`);
  await el.click();

  await el.evaluate((node, max) => {
    node.textContent = 'x'.repeat(max - 3);
  }, MAX_LENGTH);

  const box = await el.boundingBox();
  expect(box).not.toBeNull();

  const result = await el.evaluate(
    (node, { x, y, longText }) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', longText);
      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer: dt,
      });
      node.dispatchEvent(dropEvent);
      return {
        defaultPrevented: dropEvent.defaultPrevented,
        length: (node.textContent ?? '').length,
      };
    },
    { x: box!.x + box!.width - 2, y: box!.y + box!.height / 2, longText: 'abcdefghij' },
  );

  expect(result.defaultPrevented).toBe(true);
  expect(result.length).toBe(MAX_LENGTH);
  await expect(el).toContainText('abc');

  const relevantConsoleErrors = consoleErrors.filter((e) => !e.includes('favicon'));
  expect(
    relevantConsoleErrors,
    `unexpected console errors: ${relevantConsoleErrors.join('\n')}`,
  ).toEqual([]);
});
