import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Многострочные подписи связей (12.15).
 *
 * Подпись стрелки хранится одной строкой `BoardEdge.label`, но редактируется через
 * `<textarea>`: обычный Enter вставляет `\n` (перенос строки, а не коммит),
 * Ctrl+Enter / Cmd+Enter — сохраняют. Проверяем end-to-end через два браузерных
 * контекста одного пользователя:
 *
 * 1. Подпись с `\n` долетает от редактора первого клиента ко второму через живой WS.
 * 2. Read-only подпись рендерится с `white-space: pre-wrap` и растягивается на 2 строки.
 * 3. После перезагрузки второй клиент получает подпись из снимка доски (не из WS).
 *
 * Редактор открывается двойным кликом по SVG-пути стрелки — прямой `@dblclick`
 * на `<g data-testid="board-edge">` в `BoardFloatingEdge.vue` (не через
 * Vue Flow-нативное `@edge-double-click`, тот путь ненадёжен). Чтобы путь
 * был свободен для клика, стикеры раскладываются в ширину (влево/вправо) с зазором
 * посередине — fit-view-on-init на пустой доске и диагональный драг из realtime-sync
 * иначе заставляют стикеры перекрываться и покрывать короткий путь.
 */
test.describe('Доски: многострочные подписи связей', () => {
  test('Enter переносит строку, Ctrl+Enter сохраняет, подпись синхронизируется и перезагружается из снимка', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();

    const owner = await createUser('board-edge-label');
    const contextA = await newContext(browser);
    await loginAs(contextA, owner);
    const pageA = await contextA.newPage();
    await pageA.goto('/boards');

    await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}EdgeLabel ${randomUUID().slice(0, 8)}`;
    await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const boardA = boardLocators(pageA);

    await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    const boardUrl = pageA.url();
    await expect(boardA.pane).toBeVisible();

    // fit-view-on-init на пустой доске масштабирует до 200% (см. комментарий в
    // boards-realtime-sync.spec.ts); Ctrl+0 в headless Chromium не держит масштаб —
    // `ControlOrMeta+0` сбрасывает браузерный page-zoom, а приложение его не
    // перехватывает надёжно. Работаем на 200%: стикеры 180×180 flow (360×360px
    // rendered), safe-zone x:110-1080, y:190-580 — не задевая тулбар/миникарту/
    // контролы зума.
    //
    // Чтобы путь стрелки между стикерами был свободен для двойного клика, раскладываем
    // стикеры в ширину (влево / вправо) с зазором посередине — иначе fit-view-on-init
    // на пустой доске и диагональный драг из realtime-sync заставляют стикеры
    // перекрываться, а центр короткого пути оказывается на теле стикера.

    const contextB = await newContext(browser);
    await loginAs(contextB, owner);
    const pageB = await contextB.newPage();
    await pageB.goto(boardUrl);
    const boardB = boardLocators(pageB);
    await expect(boardB.pane).toBeVisible();

    // --- Стикер 1: создаём и раскладываем в левую часть холста ---
    await boardA.pane.dblclick({ position: { x: 300, y: 300 } });
    await expect(boardA.stickyNodes).toHaveCount(1);
    const stickyId = await boardA.stickyNodes.getAttribute('data-node-id');
    // редактор стикера открывается автоматически (pendingEditId). Escape на
    // contenteditable вызывает cancelEditing (BoardStickyNode
    // `@keydown.esc.stop.prevent="cancelEditing"`) — для пустого текста это безопасно:
    // commit не нужен, а `pane.click` в промзону зависит от координат rendera.
    const textareaA = pageA.locator(`[data-node-id="${stickyId}"] [contenteditable="true"]`);
    await textareaA.click();
    await pageA.keyboard.press('Escape');
    const nodeBLocator = pageB.locator(`[data-node-id="${stickyId}"]`);
    await expect(nodeBLocator).toBeVisible();

    // Абсолютный драг: зажимаем центр стикера и тащим к целевой точке — центр
    // оказывается ровно в целевой точке (offset захвата = 0). Это раскладывает
    // стикеры в ширину с зазором посередине, чтобы путь стрелки был свободен
    // для двойного клика (иначе fit-view-on-init + короткая связь покрывают путь).
    const nodeALocator = pageA.locator(`[data-node-id="${stickyId}"]`);
    const boxA = await nodeALocator.boundingBox();
    expect(boxA).not.toBeNull();
    await pageA.mouse.move(boxA!.x + boxA!.width / 2, boxA!.y + boxA!.height / 2);
    await pageA.mouse.down();
    await pageA.mouse.move(260, 420, { steps: 10 });
    await pageA.mouse.up();
    await pageA.keyboard.press('Escape');

    // --- Стикер 2: создаём в правой части холста ---
    await boardA.pane.dblclick({ position: { x: 1000, y: 300 } });
    await expect(boardA.stickyNodes).toHaveCount(2);
    const secondId = await boardA.stickyNodes
      .locator(`:scope:not([data-node-id="${stickyId}"])`)
      .getAttribute('data-node-id');
    const textareaA2 = pageA.locator(`[data-node-id="${secondId}"] [contenteditable="true"]`);
    await textareaA2.click();
    await pageA.keyboard.press('Escape');
    await expect(boardB.stickyNodes).toHaveCount(2);

    // Раскладываем стикер 2 в правую часть (центр → целевая точка):
    const nodeA2Locator = pageA.locator(`[data-node-id="${secondId}"]`);
    const boxA2 = await nodeA2Locator.boundingBox();
    expect(boxA2).not.toBeNull();
    await pageA.mouse.move(boxA2!.x + boxA2!.width / 2, boxA2!.y + boxA2!.height / 2);
    await pageA.mouse.down();
    await pageA.mouse.move(880, 420, { steps: 10 });
    await pageA.mouse.up();
    await pageA.keyboard.press('Escape');

    // --- Соединяем стрелкой через handles (right → left) ---
    const sourceHandle = pageA.locator(
      `[data-testid="board-handle"][data-nodeid="${stickyId}"][data-handleid="right"]`,
    );
    const targetHandle = pageA.locator(
      `[data-testid="board-handle"][data-nodeid="${secondId}"][data-handleid="left"]`,
    );
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await pageA.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await pageA.mouse.down();
    await pageA.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 },
    );
    await pageA.mouse.up();

    await expect(boardA.edges).toHaveCount(1);
    await expect(boardB.edges).toHaveCount(1);

    // --- Открываем редактор подписи двойным кликом по свободному участку пути ---
    // Cтикеры раскинуты в ширину с зазором — центр пути стрелки попадает в пустую
    // зону между ними. Для пустой связи HTML-оверлей подписи не рендерится
    // (v-if="editing || data.label"), клик доходит до SVG-пути и Vue Flow эмиттит
    // `@edge-double-click` → pendingEdgeEditId → startEditing() в BoardFloatingEdge.
    const edgePath = pageA.locator('[data-testid="board-edge"] path').first();
    // only-render-visible-elements: после перетаскивания связь могла уйти за план,
    // — подгоняем viewport к содержимому (Ctrl/Cmd+1 → fitView).
    await pageA.keyboard.press('ControlOrMeta+1');
    const pathBox = await edgePath.boundingBox();
    expect(pathBox).not.toBeNull();
    // Путь — тонкий stroked <path> без площади bbox (h=0), locator.dblclick требует
    // visible и отказывается. Кликаем координатами page.mouse — попадаем ровно в центр
    // пути, который (благодаря раскладке в ширину) находится в свободном зазоре.
    await pageA.keyboard.press('Escape');
    await pageA.mouse.dblclick(pathBox!.x + pathBox!.width / 2, pathBox!.y + pathBox!.height / 2);
    await expect(boardA.edgeLabelInput).toBeVisible();
    expect(await boardA.edgeLabelInput.evaluate((el) => el.tagName)).toBe('TEXTAREA');

    // --- Enter — это перенос строки, редактор НЕ закрывается ---
    await boardA.edgeLabelInput.fill('Первая строка\nВторая строка');
    await boardA.edgeLabelInput.press('Enter');
    await expect(boardA.edgeLabelInput).toBeVisible();
    const inputValue = await boardA.edgeLabelInput.inputValue();
    expect(inputValue.split('\n').length).toBe(3);

    // --- Ctrl+Enter / Cmd+Enter — commit через blur ---
    await pageA.keyboard.press('ControlOrMeta+Enter');
    await expect(boardA.edgeLabelText).toBeVisible();
    expect(await boardA.edgeLabelText.textContent()).toBe('Первая строка\nВторая строка');

    // --- Live-синхронизация на втором клиенте ---
    await expect(boardB.edgeLabelText).toBeVisible();
    expect(await boardB.edgeLabelText.textContent()).toBe('Первая строка\nВторая строка');

    // --- Read-only подпись растягивается на 2 строки через pre-wrap ---
    const readOnlyText = boardA.edgeLabelText;
    expect(await readOnlyText.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
    const box = await readOnlyText.boundingBox();
    const fontSize = parseFloat(await readOnlyText.evaluate((el) => getComputedStyle(el).fontSize));
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(fontSize * 2);

    // --- Перезагрузка второго клиента: подпись приходит из снимка, а не из WS ---
    await pageB.reload();
    await expect(boardB.pane).toBeVisible();
    await expect(boardB.edges).toHaveCount(1);
    await expect(boardB.edgeLabelText).toBeVisible();
    expect(await boardB.edgeLabelText.textContent()).toBe('Первая строка\nВторая строка');
  });
});
