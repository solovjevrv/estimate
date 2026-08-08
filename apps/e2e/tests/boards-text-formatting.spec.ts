import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Форматирование текста стикера/фигуры по выделению (12.13) — начертание
 * (жирный/курсив), маркер и ссылка через тулбар выделения, плюс регрессия,
 * найденная ревью (не живой проверкой): более ранняя версия защиты фокуса
 * ошибочно матчила ВЕСЬ `.board-selection-toolbar`, из-за чего клик
 * «Дублировать» посреди набора текста переставал коммитить черновик — тест
 * «регрессия: Дублировать» ниже целится ровно в этот сценарий.
 *
 * Выделение текста реальным драгом мыши в headless Chromium ненадёжно
 * (Selection API не всегда честно повторяет драг) — выделяем программно через
 * Range API и синтетический `mouseup` (тот же ивент, на который вешается
 * `refreshActiveMarks` в `use-rich-text-editing.ts`), как и в живой отладке
 * этой задачи.
 */
test.describe('Доски: форматирование текста', () => {
  test('начертание, маркер и ссылка применяются по выделению и переживают перезагрузку', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('text-format');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Format ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    await page.locator('.vue-flow__pane').dblclick({ position: { x: 400, y: 300 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
    const editable = page.locator('.vue-flow__node-sticky [contenteditable="true"]');
    await editable.click();
    await editable.fill('Hello world');

    async function selectWord(): Promise<void> {
      await page.evaluate(() => {
        const el = document.querySelector(
          '.vue-flow__node-sticky [contenteditable="true"]',
        ) as HTMLElement;
        function locate(node: Node, pos: number): { node: Node; offset: number } | null {
          if (node.nodeType === Node.TEXT_NODE) {
            const len = (node.textContent ?? '').length;
            return pos <= len ? { node, offset: pos } : null;
          }
          let acc = pos;
          for (const child of Array.from(node.childNodes)) {
            const len = (child.textContent ?? '').length;
            if (acc <= len) {
              const found = locate(child, acc);
              if (found) return found;
            }
            acc -= len;
          }
          return null;
        }
        const start = locate(el, 0)!;
        const end = locate(el, 5)!; // "Hello"
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(new Event('mouseup', { bubbles: true }));
      });
    }

    await selectWord();
    const toolbar = page.locator('.board-selection-toolbar');
    await expect(toolbar).toBeVisible();

    // Начертание — жирный + курсив одним и тем же выделением, без повторного
    // выделения между кликами (регрессия: клик по кнопке не должен терять lastOffsets)
    await toolbar.locator('button[aria-label="Начертание"]').click();
    const boldBtn = page.locator('button[aria-label="Жирный"]');
    await expect(boldBtn).toBeEnabled();
    await boldBtn.click();
    await page.locator('button[aria-label="Курсив"]').click();

    // Маркер — та же самая закэшированная область выделения
    await toolbar.locator('button[aria-label="Маркер"]').click();
    await page.locator('button.board-highlight-swatch').first().click();

    // Ссылка — единственный переход, где фокус реально уходит в поле URL
    await toolbar.locator('button[aria-label="Ссылка"]').click();
    const linkInput = page.locator('input.board-link-input');
    await expect(linkInput).toBeVisible();
    await linkInput.fill('https://example.com');
    await page.locator('button.board-link-apply-btn').click();

    await page.locator('.vue-flow__pane').click({ position: { x: 900, y: 500 } });

    const viewLink = page.locator('.vue-flow__node-sticky a[href="https://example.com"]');
    await expect(viewLink).toBeVisible();
    await expect(viewLink).toHaveText('Hello');
    await expect(viewLink).toHaveCSS('font-weight', '800');
    await expect(viewLink).toHaveCSS('font-style', 'italic');

    // Переживает перезагрузку — реально ушло на сервер, не только в локальный DOM
    await page.reload();
    await expect(page.locator('.vue-flow__node-sticky')).toBeVisible();
    const reloadedLink = page.locator('.vue-flow__node-sticky a[href="https://example.com"]');
    await expect(reloadedLink).toBeVisible();
    await expect(reloadedLink).toHaveText('Hello');
  });

  test('регрессия: клик «Дублировать» посреди набора текста коммитит черновик, а не теряет его', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('text-format-dup');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}FormatDup ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    await page.locator('.vue-flow__pane').dblclick({ position: { x: 400, y: 300 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
    const editable = page.locator('.vue-flow__node-sticky [contenteditable="true"]');
    await editable.click();
    await editable.fill('Черновик');

    // Не блюримся явно — сразу кликаем «Дублировать», всё ещё в режиме
    // редактирования. Кнопка не гасит mousedown (ей не нужен editableEl,
    // клик должен обычным образом закоммитить черновик перед копированием)
    await page.locator('.board-selection-toolbar button[aria-label="Дублировать"]').click();

    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(2);
    // toContainText сама повторяет попытки (WS round-trip дубликата не мгновенен) —
    // однократный allInnerTexts() снимал бы кадр до того, как текст успел долететь
    const stickies = page.locator('.vue-flow__node-sticky');
    await expect(stickies.nth(0)).toContainText('Черновик');
    await expect(stickies.nth(1)).toContainText('Черновик');
  });
});
