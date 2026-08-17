import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Текстовый элемент на холсте (13.1) — создание через левый тулбар,
 * редактирование, проверка персистентности после reload.
 */
test.describe('Доски: текстовый элемент', () => {
  test('создание текстового элемента через тулбар и персистентность после reload', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-text');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Text ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Выбираем инструмент «Текст» в левом тулбаре
    await board.toolbarButton('Текст').click();

    // Кликаем по холсту — создаётся текстовый элемент
    await board.pane.click({ position: { x: 400, y: 300 } });

    // Проверяем, что элемент создался и сразу в режиме редактирования
    await expect(board.textNodes).toHaveCount(1);
    const editable = board.textNodes.locator('[contenteditable="true"]');
    await expect(editable).toBeVisible();

    // Вводим текст
    await editable.fill('Свободный текст на холсте');

    // Кликаем по пустому месту — коммитим черновик
    await board.pane.click({ position: { x: 900, y: 500 } });

    // Проверяем, что текст отображается
    const textNode = board.textNodes.first();
    await expect(textNode).toContainText('Свободный текст на холсте');

    // Проверяем, что нет фона/заливки/рамки (визуально отличается от стикера)
    await expect(textNode).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    // Перезагружаем страницу — проверяем персистентность
    await page.reload();
    await expect(board.textNodes).toBeVisible();
    await expect(board.textNodes.first()).toContainText('Свободный текст на холсте');
  });

  test('конвертация текстового элемента в стикер через тулбар выделения', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-text-convert');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}TextConvert ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Создаём текстовый элемент
    await board.toolbarButton('Текст').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    const editable = board.textNodes.locator('[contenteditable="true"]');
    await editable.fill('Конвертируем в стикер');
    await board.pane.click({ position: { x: 900, y: 500 } });

    // Выбираем элемент — появляется тулбар выделения
    await board.textNodes.click();
    await expect(board.selectionToolbar).toBeVisible();

    // Меняем тип на «Стикер» через дропдаун формы
    await board.selectionToolbarButton('Тип элемента').click();
    await board.formMenuButton('Стикер').click();

    // Проверяем, что элемент стал стикером (появился фон/тень)
    await expect(board.stickyNodes).toHaveCount(1);
    const stickyNode = board.stickyNodes.first();
    // Текст может быть внутри вложенного элемента — проверяем по всему узлу
    await expect(stickyNode.locator('[data-testid="board-sticky-content"]')).toContainText(
      'Конвертируем в стикер',
    );
    // У стикера есть фон (жёлтый по умолчанию)
    await expect(stickyNode.locator('[data-testid="board-sticky-content"]')).toHaveCSS(
      'background-color',
      'rgb(252, 235, 150)',
    );
  });
});
