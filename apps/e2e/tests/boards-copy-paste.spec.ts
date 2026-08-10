import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

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
      await expect(page.locator('.vue-flow__pane')).toBeVisible();
      await page.locator('.vue-flow__pane').click(); // фокус на холст перед хоткеем
      await page.keyboard.press('ControlOrMeta+0');
      // `.vue-flow__pane` появляется сразу, а WS-`join()` доски (`BoardPage.vue`)
      // не await-ится перед этим — на второй доске в тесте (сразу после leave/join
      // предыдущей на том же сокете) вставка сразу после навигации может улететь
      // раньше, чем join долетит до сервера; даём небольшой запас
      await page.waitForTimeout(300);
    }

    // --- Доска A: два стикера в разных углах, выделяем оба, копируем и вставляем ---
    await createBoard(`${E2E_ROOM_PREFIX}Copy A ${randomUUID().slice(0, 8)}`);

    await page.locator('.vue-flow__pane').dblclick({ position: { x: 300, y: 150 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
    await page.keyboard.press('Escape'); // выйти из режима правки

    await page.locator('.vue-flow__pane').dblclick({ position: { x: 950, y: 150 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape'); // второй раз — снять выделение со второго стикера

    // `fit-view-on-init` у `<VueFlow>` перезапускает автоподгонку зума при
    // переходе списка узлов из пустого в непустой (первая созданная карточка) —
    // сбрасываем зум ЕЩЁ РАЗ уже после создания обеих карточек, иначе более
    // ранний Ctrl+0 (в `createBoard`) перетирается этим авто-фитом до 200%
    await page.keyboard.press('ControlOrMeta+0');
    await page.waitForTimeout(200);

    // Мульти-выбор — рамкой (drag-select), безусловно, без модификатора
    // (`:selection-key-code="true"` на `<VueFlow>` — заменил мёртвый атрибут
    // `selection-on-drag`, который не соответствовал никакому реальному пропу
    // этой версии Vue Flow и был no-op). Прямоугольник считаем от реальных
    // экранных rect'ов узлов (не от координат клика создания) — они зависят
    // от текущего зума/пана
    const stickyBoxes = await page
      .locator('.vue-flow__node-sticky')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
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
    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(2);
    await expect(page.locator('.board-selection-toolbar')).toBeVisible();

    await copyAndWaitForClipboard('');
    await page.keyboard.press('Escape'); // снять выделение
    await page.keyboard.press('ControlOrMeta+v');

    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(4);

    // Вставленные элементы сразу остаются выделенными (как в Miro) — можно
    // сразу перетащить их на нужное место без повторного выделения
    await expect(page.locator('.vue-flow__node.selected')).toHaveCount(2);

    // Вставка создала НОВЫЕ элементы, а не патчнула старые
    const stickyIds = await page
      .locator('.vue-flow__node-sticky')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-id')));
    expect(new Set(stickyIds).size).toBe(4);

    // Переживает перезагрузку — реально ушло на сервер, а не только в локальный стор
    await page.reload();
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(4);
    await page.keyboard.press('ControlOrMeta+0');
    await page.waitForTimeout(200);

    // --- Картинка на доске A — копируем именно её ---
    const imageBuffer = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 80, b: 40 } },
    })
      .jpeg()
      .toBuffer();
    await page.locator('.board-toolbar button[aria-label="Картинка"]').click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('.vue-flow__pane').click({ position: { x: 950, y: 450 } });
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: imageBuffer });
    await expect(page.locator('.vue-flow__node-image')).toHaveCount(1, { timeout: 15_000 });

    const originalSrc = await page.locator('.vue-flow__node-image img').getAttribute('src');
    expect(originalSrc).toMatch(/^\/api\/boards\/[0-9a-f-]{36}\/assets\/[a-f0-9]{32}\.webp$/);
    const boardAId = originalSrc!.split('/')[3];

    await page.locator('.vue-flow__node-image').click();
    await expect(page.locator('.board-selection-toolbar')).toBeVisible();
    const clipboardBeforeImageCopy = await page.evaluate(() => navigator.clipboard.readText());
    await copyAndWaitForClipboard(clipboardBeforeImageCopy);

    // --- Доска B: вставляем скопированную картинку ---
    await createBoard(`${E2E_ROOM_PREFIX}Copy B ${randomUUID().slice(0, 8)}`);
    await page.keyboard.press('ControlOrMeta+v');

    await expect(page.locator('.vue-flow__node-image')).toHaveCount(1, { timeout: 15_000 });
    const pastedSrc = await page.locator('.vue-flow__node-image img').getAttribute('src');
    expect(pastedSrc).toMatch(/^\/api\/boards\/[0-9a-f-]{36}\/assets\/[a-f0-9]{32}\.webp$/);
    expect(pastedSrc!.split('/')[3]).not.toBe(boardAId); // новый ассет на доске B, не ссылка на A

    const served = await page.request.get(pastedSrc!);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/webp');
  });
});
