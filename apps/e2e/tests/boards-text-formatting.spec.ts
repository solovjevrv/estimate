import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Форматирование текста стикера/фигуры по выделению (12.13) — начертание
 * (жирный/курсив), маркер и ссылка через тулбар выделения, плюс регрессия,
 * найденная ревью (не живой проверкой): более ранняя версия защиты фокуса
 * ошибочно матчила ВЕСЬ `[data-testid="board-selection-toolbar"]`, из-за чего клик
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.pane.dblclick({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(1);
    const editable = board.stickyNodes.locator('[contenteditable="true"]');
    await editable.click();
    await editable.fill('Hello world');

    async function selectWord(): Promise<void> {
      await page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="board-node-sticky"] [contenteditable="true"]',
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
    const toolbar = board.selectionToolbar;
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
    await board.highlightSwatch.first().click();

    // Ссылка — единственный переход, где фокус реально уходит в поле URL
    await toolbar.locator('button[aria-label="Ссылка"]').click();
    await expect(board.linkInput).toBeVisible();
    await board.linkInput.fill('https://example.com');
    await board.linkApplyBtn.click();

    await board.pane.click({ position: { x: 900, y: 500 } });

    const viewLink = board.stickyNodes.locator('a[href="https://example.com"]');
    await expect(viewLink).toBeVisible();
    await expect(viewLink).toHaveText('Hello');
    await expect(viewLink).toHaveCSS('font-weight', '800');
    await expect(viewLink).toHaveCSS('font-style', 'italic');

    // Переживает перезагрузку — реально ушло на сервер, не только в локальный DOM
    await page.reload();
    await expect(board.stickyNodes).toBeVisible();
    const reloadedLink = board.stickyNodes.locator('a[href="https://example.com"]');
    await expect(reloadedLink).toBeVisible();
    await expect(reloadedLink).toHaveText('Hello');
  });

  test('форматирование без выделения (18.7): bold и маркер применяются ко всему тексту, ссылка — только подсказка', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('text-format-focus');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}FormatFocus ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.pane.dblclick({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(1);
    const editable = board.stickyNodes.locator('[contenteditable="true"]');
    await editable.click();
    await editable.fill('Hello world');

    // Поставим cursor внутрь текста без выделения (схлопнутая selection)
    await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="board-node-sticky"] [contenteditable="true"]',
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
      const loc = locate(el, 5)!; // cursor в середине "Hello world"
      const range = document.createRange();
      range.setStart(loc.node, loc.offset);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new Event('mouseup', { bubbles: true }));
    });

    const toolbar = board.selectionToolbar;
    await expect(toolbar).toBeVisible();

    // Жирность — применяется ко всему тексту при схлопнутом cursor (18.7)
    await toolbar.locator('button[aria-label="Начертание"]').click();
    const boldBtn = page.locator('button[aria-label="Жирный"]');
    await expect(boldBtn).toBeEnabled();
    await boldBtn.click();

    // Маркер — та же логика, применяется ко всему тексту
    await toolbar.locator('button[aria-label="Маркер"]').click();
    await board.highlightSwatch.first().click();

    // Ссылка без выделения — подсказка, а не форма (18.7)
    await toolbar.locator('button[aria-label="Ссылка"]').click();
    await expect(page.locator('.board-link-hint')).toBeVisible();
    await expect(page.locator('.board-link-form')).toHaveCount(0);

    // Фиксируем изменения — клик вне текста
    await board.pane.click({ position: { x: 900, y: 500 } });

    // Текст целиком стал жирным — BoardRichText рендерит <span style="font-weight: 800">
    // внутри wrapper-<span>, поэтому таргетим span с font-weight в inline style
    const boldSpan = board.stickyNodes.nth(0).locator('span[style*="font-weight"]');
    await expect(boldSpan).toHaveCSS('font-weight', '800');
    await expect(boldSpan).toHaveText('Hello world');
    const highlightedSpan = board.stickyNodes.nth(0).locator('span[style*="background-color"]');
    await expect(highlightedSpan).toHaveCSS('background-color', /^(rgb|rgba)\(255, 209, 26/);
    await expect(highlightedSpan).toHaveText('Hello world');

    // Переживает перезагрузку — реально ушло на сервер, не только в локальный DOM
    await page.reload();
    await expect(board.stickyNodes).toBeVisible();
    const reloadedSpan = board.stickyNodes.nth(0).locator('span[style*="font-weight"]');
    await expect(reloadedSpan).toHaveCSS('font-weight', '800');
    await expect(reloadedSpan).toHaveText('Hello world');
    const reloadedHighlightedSpan = board.stickyNodes
      .nth(0)
      .locator('span[style*="background-color"]');
    await expect(reloadedHighlightedSpan).toHaveCSS(
      'background-color',
      /^(rgb|rgba)\(255, 209, 26/,
    );
    await expect(reloadedHighlightedSpan).toHaveText('Hello world');
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.pane.dblclick({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(1);
    const editable = board.stickyNodes.locator('[contenteditable="true"]');
    await editable.click();
    await editable.fill('Черновик');

    // Не блюримся явно — сразу кликаем «Дублировать», всё ещё в режиме
    // редактирования. Кнопка не гасит mousedown (ей не нужен editableEl,
    // клик должен обычным образом закоммитить черновик перед копированием)
    await board.selectionToolbarButton('Дублировать').click();

    await expect(board.stickyNodes).toHaveCount(2);
    // toContainText сама повторяет попытки (WS round-trip дубликата не мгновенен) —
    // однократный allInnerTexts() снимал бы кадр до того, как текст успел долететь
    const stickies = board.stickyNodes;
    await expect(stickies.nth(0)).toContainText('Черновик');
    await expect(stickies.nth(1)).toContainText('Черновик');
  });

  test('быстрый clickaway после создания отменяет автопереход в редактирование', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('clickaway');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Clickaway ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Выбираем инструмент «Стикер»
    await board.toolbarButton('Стикер').click();
    await expect(board.toolbarButton('Стикер')).toHaveAttribute('aria-pressed', 'true');

    // Синхронно отправляем два клика на панель: первый создаёт стикер
    // (выставляет pendingEditId), второй — clickaway до Vue mount/microtask,
    // воспроизводя гонку 12.26, при которной onMounted ранний startEditing.
    // page.mouse.click ждёт завершения каждого клика, из-за чего onMounted
    // первого узла уже отработал — нужно послать оба клика синхронно.
    // Vue Flow pane onClick эмулирует через pointerdown→pointerup→click,
    // поэтому эмулируем через PointerEvent с моком setPointerCapture
    // (иначе бросается DOMException для non-trusted событий).
    await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="board-pane"]') as HTMLElement;
      // Мокаем setPointerCapture/releasePointerCapture — Vue Flow вызывает их
      // на target, но synthetic PointerEvent не проходит проверку trusted
      pane.setPointerCapture = () => {};
      pane.releasePointerCapture = () => {};
      const opts = (x: number, y: number) => ({
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      // Первый клик — создаёт стикер
      pane.dispatchEvent(new PointerEvent('pointerdown', opts(300, 200)));
      pane.dispatchEvent(new PointerEvent('pointerup', opts(300, 200)));
      pane.dispatchEvent(new MouseEvent('click', opts(300, 200)));
      // Второй клик — clickaway, синхронно, до Vue mount/microtask
      pane.dispatchEvent(new PointerEvent('pointerdown', opts(600, 400)));
      pane.dispatchEvent(new PointerEvent('pointerup', opts(600, 400)));
      pane.dispatchEvent(new MouseEvent('click', opts(600, 400)));
    });

    // Дожидаемся одного стикера
    await expect(board.stickyNodes).toHaveCount(1);

    // Автопереход в редактирование отменён — contenteditable не появляется
    await expect(board.stickyNodes.locator('[contenteditable="true"]')).toHaveCount(0);

    // Ручной dblclick по содержимому стикера открывает редактор — узел не «залип»
    await board.stickyNodes.locator('[data-testid="board-sticky-content"]').first().dblclick();
    await expect(board.stickyNodes.locator('[contenteditable="true"]')).toHaveCount(1);
  });
});
