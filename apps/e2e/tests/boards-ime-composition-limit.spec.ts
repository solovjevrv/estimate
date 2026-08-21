import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

const MAX_LENGTH = 2000;

/**
 * IME-композиция на границе лимита длины текста (12.24). `onEditableBeforeInput`
 * (`use-rich-text-editing.ts`) раньше проверял лимит `BOARD_ITEM_TEXT_MAX_LENGTH`
 * безусловно, в том числе для `insertCompositionText` — отмена `beforeinput`
 * ПОСРЕДИ активной IME-композиции (иероглифический ввод) может испортить/
 * рассинхронизировать UI самой композиции в некоторых браузерах (известная
 * особенность Chromium/WebKit). Теперь во время композиции лимит не
 * проверяется вовсе, а обрезка происходит по факту `compositionend`.
 *
 * Реальную IME-композицию Playwright не может запустить (это OS-уровневая
 * функциональность), поэтому тест эмулирует её тем же событийным контрактом,
 * который реально слушают шаблоны узлов (`@compositionstart`/`@compositionend`/
 * `@beforeinput`) — это отличает проверку от юнит-теста в
 * `use-rich-text-editing.test.ts`, вызывающего обработчики напрямую в обход
 * реальной DOM-привязки в `.vue`-шаблонах.
 */
test('IME-композиция на границе лимита длины не блокируется посреди композиции (12.24)', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('board-ime-composition');
  const context = await newContext(browser);
  await loginAs(context, owner);
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/boards');
  await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}Ime ${randomUUID().slice(0, 8)}`;
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

  // Наполняем текст ровно до лимита (без IME, напрямую в DOM — быстро)
  await el.evaluate((node, max) => {
    node.textContent = 'x'.repeat(max);
  }, MAX_LENGTH);

  // compositionstart -> insertCompositionText через beforeinput/input,
  // растящие contenteditable ЗА пределы лимита (в реальном браузере IME сам
  // вставляет кандидата ДО commitа композиции) -> compositionend.
  const result = await el.evaluate((node, max) => {
    node.dispatchEvent(new CompositionEvent('compositionstart'));
    const beforeInputEvent = new InputEvent('beforeinput', {
      inputType: 'insertCompositionText',
      cancelable: true,
      bubbles: true,
    });
    node.dispatchEvent(beforeInputEvent);
    const blockedDuringComposition = beforeInputEvent.defaultPrevented;
    node.textContent = 'x'.repeat(max) + 'あ';
    node.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText' }));
    node.dispatchEvent(new CompositionEvent('compositionend'));
    return { blockedDuringComposition, lengthAfterEnd: (node.textContent ?? '').length };
  }, MAX_LENGTH);

  expect(result.blockedDuringComposition, 'beforeinput must NOT be blocked mid-composition').toBe(
    false,
  );
  expect(
    result.lengthAfterEnd,
    'text must be truncated back to the limit after compositionend',
  ).toBe(MAX_LENGTH);

  await expect(page.locator(`[data-node-id="${id}"] [contenteditable="true"]`)).toHaveText(
    'x'.repeat(MAX_LENGTH),
  );

  const relevantConsoleErrors = consoleErrors.filter((e) => !e.includes('favicon'));
  expect(
    relevantConsoleErrors,
    `unexpected console errors: ${relevantConsoleErrors.join('\n')}`,
  ).toEqual([]);
});
