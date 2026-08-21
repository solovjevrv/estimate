import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Копирование/вставка (13.5) — Ctrl/Cmd+C сериализует выделение в системный
 * буфер (наш JSON-формат с маркером source/version, `board-clipboard.ts`),
 * Ctrl/Cmd+V создаёт копии в центре вьюпорта, сохраняя взаимное расположение.
 * Дублирование (Ctrl/Cmd+D, без буфера) уже покрыто отдельно с 12.9.
 *
 * Картинка на сервере board-scoped (URL содержит id доски), поэтому при
 * копировании сразу тянутся байты (base64) — при вставке на ДРУГУЮ доску они
 * перезаливаются как новый ассет именно целевой доски, а не ссылка на старую.
 *
 * `fit-view-on-init` у `<VueFlow>` подгоняет зум под содержимое при переходе
 * списка узлов из пустого в непустой (создание первой карточки на доске) —
 * сбрасываем зум через Ctrl+0 (`resetZoom`) ПОСЛЕ создания нужных элементов,
 * а не только один раз на пустой доске, иначе более ранний сброс перетирается
 * автоподгонкой. Выход из режима правки текста и снятие выделения — через
 * Escape (обрабатывается в каждом текстовом поле и глобально, см.
 * `use-board-hotkeys.ts`), а не клик в «пустое место» холста.
 *
 * Заодно (по итогам ручной проверки после 13.5) поправлены три смежных бага
 * мульти-выбора: 1) рамка выделения тянулась только с зажатым Shift и была
 * не видна визуально — `selectionKeyCode`/CSS; 2) групповой драг «дёргал»
 * элементы друг относительно друга — реактивный `setNodes` из стора перетирал
 * позицию ещё не долетевших до сервера узлов поверх текущего живого
 * перетаскивания, см. комментарий у `watch(flowNodes, ...)`; 3) вставленные
 * элементы теряли выделение сразу после вставки.
 */
test.describe('Доски: копирование/вставка', () => {
  test('копипаст нескольких элементов на той же доске, и картинки — на другую', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-copy-paste');
    const context = await newContext(browser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAs(context, owner);
    const page = await context.newPage();

    /**
     * Копирование асинхронное (`onCopy` ждёт сериализации, картинка — ещё и
     * fetch байтов, см. `board-clipboard.ts`) — `keyboard.press('...+c')`
     * возвращается сразу после диспатча события клавиатуры, не дожидаясь
     * завершения обработчика. Без ожидания реального изменения буфера
     * следующий сразу за копированием Ctrl+V иногда вставлял ещё СТАРОЕ его
     * содержимое (гонка, а не баг в самой сериализации/вставке).
     */
    async function copyAndWaitForClipboard(previousText: string): Promise<void> {
      await page.keyboard.press('ControlOrMeta+c');
      await expect(async () => {
        const text = await page.evaluate(() => navigator.clipboard.readText());
        expect(text).not.toBe(previousText);
      }).toPass({ timeout: 5000 });
    }

    async function createBoard(name: string): Promise<void> {
      await page.goto('/boards');
      await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
      await page.getByPlaceholder('Например, Ретро спринта 24').fill(name);
      await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
      await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
      const board = boardLocators(page);
      await expect(board.pane).toBeVisible();
      await board.pane.click(); // фокус на холст перед хоткеем
      await page.keyboard.press('ControlOrMeta+0');
      // `[data-testid="board-pane"]` появляется сразу, а WS-`join()` доски
      // (`BoardPage.vue`) не await-ится перед этим — на второй доске в тесте
      // (сразу после leave/join предыдущей на том же сокете) вставка сразу
      // после навигации может улететь раньше, чем join долетит до сервера;
      // ждём реальное состояние сессии вместо фиксированной паузы
      await expect(board.joined).toBeVisible();
      await expect(board.zoom).toHaveText('100%');
    }

    // --- Доска A: два стикера в разных углах, выделяем оба, копируем и вставляем ---
    const board = boardLocators(page);
    await createBoard(`${E2E_ROOM_PREFIX}Copy A ${randomUUID().slice(0, 8)}`);

    await board.pane.dblclick({ position: { x: 300, y: 150 } });
    await expect(board.stickyNodes).toHaveCount(1);
    await page.keyboard.press('Escape'); // выйти из режима правки

    await board.pane.dblclick({ position: { x: 950, y: 150 } });
    await expect(board.stickyNodes).toHaveCount(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape'); // второй раз — снять выделение со второго стикера

    // `fit-view-on-init` у `<VueFlow>` перезапускает автоподгонку зума при
    // переходе списка узлов из пустого в непустой (первая созданная карточка) —
    // сбрасываем зум ЕЩЁ РАЗ уже после создания обеих карточек, иначе более
    // ранний Ctrl+0 (в `createBoard`) перетирается этим авто-фитом до 200%
    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    // Мульти-выбор — рамкой (drag-select), безусловно, без модификатора
    // (`:selection-key-code="true"` на `<VueFlow>` — заменил мёртвый атрибут
    // `selection-on-drag`, который не соответствовал никакому реальному пропу
    // этой версии Vue Flow и был no-op). Прямоугольник считаем от реальных
    // экранных rect'ов узлов (не от координат клика создания) — они зависят
    // от текущего зума/пана
    const stickyBoxes = await board.stickyNodes.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    );
    const margin = 40;
    const dragStart = {
      x: Math.min(...stickyBoxes.map((b) => b.x)) - margin,
      y: Math.min(...stickyBoxes.map((b) => b.y)) - margin,
    };
    const dragEnd = {
      x: Math.max(...stickyBoxes.map((b) => b.x + b.width)) + margin,
      y: Math.max(...stickyBoxes.map((b) => b.y + b.height)) + margin,
    };
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 10 });
    await page.mouse.up();
    await expect(board.selectedNodes).toHaveCount(2);
    await expect(board.selectionToolbar).toBeVisible();

    await copyAndWaitForClipboard('');
    await page.keyboard.press('Escape'); // снять выделение
    await page.keyboard.press('ControlOrMeta+v');

    await expect(board.stickyNodes).toHaveCount(4);

    // Вставленные элементы сразу остаются выделенными (как в Miro) — можно
    // сразу перетащить их на нужное место без повторного выделения
    await expect(board.selectedNodes).toHaveCount(2);

    // Вставка создала НОВЫЕ элементы, а не патчнула старые
    const stickyIds = await board.stickyNodes.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-node-id')),
    );
    expect(new Set(stickyIds).size).toBe(4);

    // Переживает перезагрузку — реально ушло на сервер, а не только в локальный стор
    await page.reload();
    await expect(board.stickyNodes).toHaveCount(4);
    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    // --- Картинка на доске A — копируем именно её ---
    const imageBuffer = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 80, b: 40 } },
    })
      .jpeg()
      .toBuffer();
    await board.toolbarButton('Картинка').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await board.pane.click({ position: { x: 950, y: 450 } });
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: imageBuffer });
    await expect(board.imageNodes).toHaveCount(1, { timeout: 15_000 });

    const originalSrc = await board.imageNodes.locator('img').getAttribute('src');
    expect(originalSrc).toMatch(/^\/api\/boards\/[0-9a-f-]{36}\/assets\/[a-f0-9]{32}\.webp$/);
    const boardAId = originalSrc!.split('/')[3];

    await board.imageNodes.click();
    await expect(board.selectionToolbar).toBeVisible();
    const clipboardBeforeImageCopy = await page.evaluate(() => navigator.clipboard.readText());
    await copyAndWaitForClipboard(clipboardBeforeImageCopy);

    // --- Доска B: вставляем скопированную картинку ---
    await createBoard(`${E2E_ROOM_PREFIX}Copy B ${randomUUID().slice(0, 8)}`);
    const boardB = boardLocators(page);
    // На доске B join доски должен долететь до вставки — иначе паста может
    // улететь раньше, чем сервер зарегистрирует участника в сессии
    await expect(boardB.joined).toBeVisible();
    await page.keyboard.press('ControlOrMeta+v');
    await expect(boardB.imageNodes).toHaveCount(1, { timeout: 15_000 });
    const pastedSrc = await boardB.imageNodes.locator('img').getAttribute('src');
    expect(pastedSrc).toMatch(/^\/api\/boards\/[0-9a-f-]{36}\/assets\/[a-f0-9]{32}\.webp$/);
    expect(pastedSrc!.split('/')[3]).not.toBe(boardAId); // новый ассет на доске B, не ссылка на A

    const served = await page.request.get(pastedSrc!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/webp');
  });

  test('копирование/вставка и дублирование двух связанных стикеров переносят стрелку', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-copy-edges');
    const context = await newContext(browser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAs(context, owner);
    const page = await context.newPage();

    // Создаём доску
    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await page
      .getByPlaceholder('Например, Ретро спринта 24')
      .fill(`${E2E_ROOM_PREFIX}CopyEdges ${randomUUID().slice(0, 8)}`);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    const board = boardLocators(page);
    await expect(board.pane).toBeVisible();
    await board.pane.click(); // фокус на холст перед хоткеем
    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    // --- Два стикера в разных углах ---
    await board.pane.dblclick({ position: { x: 300, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(1);
    const firstId = await board.stickyNodes.getAttribute('data-node-id');
    await page.keyboard.press('Escape');

    await board.pane.dblclick({ position: { x: 1000, y: 600 } });
    await expect(board.stickyNodes).toHaveCount(2);
    const secondId = await board.stickyNodes
      .locator(`:scope:not([data-node-id="${firstId}"])`)
      .getAttribute('data-node-id');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape'); // снять выделение со второго стикера

    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    // --- Соединяем стрелкой (drag от хендла первого к хендлу второго) ---
    const sourceHandle = page.locator(
      `[data-testid="board-handle"][data-nodeid="${firstId}"][data-handleid="right"]`,
    );
    const targetHandle = page.locator(
      `[data-testid="board-handle"][data-nodeid="${secondId}"][data-handleid="left"]`,
    );
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    await expect(board.edges).toHaveCount(1);

    // --- Выделяем оба стикера рамкой — без platform-specific modifier key ---
    const edgeStickyBoxes = await board.stickyNodes.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect()),
    );
    const selectionMargin = 40;
    await page.mouse.move(
      Math.min(...edgeStickyBoxes.map((box) => box.x)) - selectionMargin,
      Math.min(...edgeStickyBoxes.map((box) => box.y)) - selectionMargin,
    );
    await page.mouse.down();
    await page.mouse.move(
      Math.max(...edgeStickyBoxes.map((box) => box.x + box.width)) + selectionMargin,
      Math.max(...edgeStickyBoxes.map((box) => box.y + box.height)) + selectionMargin,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect(board.selectedNodes).toHaveCount(2);

    // --- Копируем и вставляем (Ctrl/Cmd+C / Ctrl/Cmd+V) ---
    const clipboardBeforeCopy = await page.evaluate(() => navigator.clipboard.readText());
    await page.keyboard.press('ControlOrMeta+c');
    await expect(async () => {
      expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe(
        clipboardBeforeCopy,
      );
    }).toPass({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+v');

    // 2 оригинала + 2 вставленные копии; у каждой пары — своё ребро
    await expect(board.stickyNodes).toHaveCount(4);
    await expect(board.edges).toHaveCount(2);
    await expect(board.selectedNodes).toHaveCount(2);

    // --- Дублируем вставленные копии (Ctrl/Cmd+D) — должно перенести и рёбро ---
    await page.keyboard.press('ControlOrMeta+d');

    // 2 оригинала + 2 вставленные + 2 дубликата
    await expect(board.stickyNodes).toHaveCount(6);
    // оригинальное ребро + для вставленной и дублированной пар
    await expect(board.edges).toHaveCount(3);

    // Дублирование не меняет выделение вставленной пары.
    await expect(board.selectedNodes).toHaveCount(2);
  });
});
