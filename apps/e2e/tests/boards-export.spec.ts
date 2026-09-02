import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Экспорт доски в PNG (15.5) — модалка из меню «Ещё действия», скачивание
 * файла в браузере (`downloadBlob`, впервые в проекте). Markdown-формат был
 * в первой версии задачи и снят по решению пользователя (31.08.2026).
 */
async function createBoard(page: import('@playwright/test').Page, namePrefix: string) {
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}${namePrefix} ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  return boardName;
}

test.describe('Доски: экспорт в PNG', () => {
  test('скачивает непустой PNG со стикером', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-export-png');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();
    const board = boardLocators(page);

    await createBoard(page, 'ExportPng');
    await expect(board.pane).toBeVisible();
    await expect(board.joined).toBeVisible();

    await board.pane.dblclick({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes.locator('[contenteditable="true"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Экспорт' }).click();
    await expect(page.getByRole('heading', { name: 'Экспорт доски' })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const path = await download.path();
    expect(path).not.toBeNull();
    const metadata = await sharp(path!).metadata();
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);

    // Модалка закрывается после успешного скачивания
    await expect(page.getByRole('heading', { name: 'Экспорт доски' })).toBeHidden();
  });

  test('увеличение отступа увеличивает итоговую картинку ровно на 2×разницу', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-export-margin');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();
    const board = boardLocators(page);

    await createBoard(page, 'ExportMargin');
    await expect(board.pane).toBeVisible();
    await expect(board.joined).toBeVisible();
    await board.pane.dblclick({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes.locator('[contenteditable="true"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Экспорт' }).click();
    const marginInput = page.getByRole('spinbutton');
    await expect(marginInput).toHaveValue('24');

    const defaultDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать' }).click();
    const defaultPath = await (await defaultDownload).path();
    const defaultMeta = await sharp(defaultPath!).metadata();

    // Меню «Ещё действия» закрывается после выбора пункта — переоткрываем
    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Экспорт' }).click();
    await marginInput.fill('124');
    const widerDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать' }).click();
    const widerPath = await (await widerDownload).path();
    const widerMeta = await sharp(widerPath!).metadata();

    // Отступ применяется с обеих сторон и уже в масштабе PNG (x2) — код
    // отступ не масштабирует (в px картинки, не во flow-координатах)
    expect(widerMeta.width! - defaultMeta.width!).toBe((124 - 24) * 2);
    expect(widerMeta.height! - defaultMeta.height!).toBe((124 - 24) * 2);
  });

  test('«только выделенную область» экспортирует меньшую картинку, чем вся доска', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-export-selection');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();
    const board = boardLocators(page);

    await createBoard(page, 'ExportSel');
    await expect(board.pane).toBeVisible();
    await expect(board.joined).toBeVisible();

    // Два стикера далеко друг от друга — выделяем только один. y не ближе
    // 700 к низу вьюпорта — там миникарта/кластер контролов холста (bottom-
    // right/bottom), клик по ним не создаёт элемент и подвешивает retry-цикл
    // Playwright ("<html> intercepts pointer events").
    await board.pane.dblclick({ position: { x: 200, y: 200 } });
    await expect(board.stickyNodes).toHaveCount(1);
    await page.keyboard.press('Escape');
    await board.pane.dblclick({ position: { x: 1000, y: 500 } });
    await expect(board.stickyNodes).toHaveCount(2);
    await page.keyboard.press('Escape');

    const firstSticky = board.stickyNodes.first();
    await firstSticky.click();
    await expect(firstSticky).toHaveAttribute('data-selected', 'true');

    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Экспорт' }).click();

    const fullDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать' }).click();
    const fullMeta = await sharp((await (await fullDownload).path())!).metadata();

    await firstSticky.click();
    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Экспорт' }).click();
    await page.getByRole('switch').click();
    const selectedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать' }).click();
    const selectedMeta = await sharp((await (await selectedDownload).path())!).metadata();

    expect(selectedMeta.width!).toBeLessThan(fullMeta.width!);
    expect(selectedMeta.height!).toBeLessThan(fullMeta.height!);
  });

  test('заголовок фрейма не обрезается сверху картинки', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-export-frame');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();
    const board = boardLocators(page);

    await createBoard(page, 'ExportFrame');
    await expect(board.pane).toBeVisible();
    await expect(board.joined).toBeVisible();
    // 100% зум — screen px совпадают с flow-координатами, иначе сравнение
    // frameBox.height (screen px текущего зума) с картинкой (flow px × 2) неверно
    await board.pane.click();
    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    await board.toolbarButton('Фрейм').click();
    await board.pane.click({ position: { x: 300, y: 300 } });
    await expect(board.frameNodes).toHaveCount(1);
    const titleInput = board.frameNodes.locator('.board-frame-title');
    await titleInput.fill('Заголовок фрейма');
    // Клик по пустому месту коммитит черновик заголовка (blur) — не ближе
    // 700 к низу вьюпорта, см. комментарий выше про миникарту/кластер контролов
    await board.pane.click({ position: { x: 900, y: 500 } });

    const frameBox = await board.frameNodes.boundingBox();
    expect(frameBox).not.toBeNull();

    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Экспорт' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать' }).click();
    const path = await (await downloadPromise).path();
    const metadata = await sharp(path!).metadata();

    // Если бы граница считалась только по geometry фрейма (без заголовка,
    // BoardFrameNode.vue — .board-frame-title-bar рисуется НАД рамкой с
    // отрицательным top), высота картинки была бы = frameBox.height*2 + margin*2.
    // С учётом заголовка она заметно больше — конкретный порог не хардкодим
    // (зависит от текущего zoom/шрифта), важно, что превышение значимое.
    const heightWithoutTitleAccounting = Math.round(frameBox!.height * 2 + 24 * 2);
    expect(metadata.height!).toBeGreaterThan(heightWithoutTitleAccounting + 20);
  });
});
