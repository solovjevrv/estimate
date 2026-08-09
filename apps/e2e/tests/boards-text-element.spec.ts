import { randomUUID } from 'node:crypto';

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
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Выбираем инструмент «Текст» в левом тулбаре
    await page.locator('.board-toolbar button[aria-label="Текст"]').click();

    // Кликаем по холсту — создаётся текстовый элемент
    await page.locator('.vue-flow__pane').click({ position: { x: 400, y: 300 } });

    // Проверяем, что элемент создался и сразу в режиме редактирования
    await expect(page.locator('.vue-flow__node-text')).toHaveCount(1);
    const editable = page.locator('.vue-flow__node-text [contenteditable="true"]');
    await expect(editable).toBeVisible();

    // Вводим текст
    await editable.fill('Свободный текст на холсте');

    // Кликаем по пустому месту — коммитим черновик
    await page.locator('.vue-flow__pane').click({ position: { x: 900, y: 500 } });

    // Проверяем, что текст отображается
    const textNode = page.locator('.vue-flow__node-text').first();
    await expect(textNode).toContainText('Свободный текст на холсте');

    // Проверяем, что нет фона/заливки/рамки (визуально отличается от стикера)
    await expect(textNode).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    // Перезагружаем страницу — проверяем персистентность
    await page.reload();
    await expect(page.locator('.vue-flow__node-text')).toBeVisible();
    await expect(page.locator('.vue-flow__node-text').first()).toContainText('Свободный текст на холсте');
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
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Создаём текстовый элемент
    await page.locator('.board-toolbar button[aria-label="Текст"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 400, y: 300 } });
    const editable = page.locator('.vue-flow__node-text [contenteditable="true"]');
    await editable.fill('Конвертируем в стикер');
    await page.locator('.vue-flow__pane').click({ position: { x: 900, y: 500 } });

    // Выбираем элемент — появляется тулбар выделения
    await page.locator('.vue-flow__node-text').click();
    await expect(page.locator('.board-selection-toolbar')).toBeVisible();

    // Меняем тип на «Стикер» через дропдаун формы
    await page.locator('.board-selection-toolbar button[aria-label="Тип элемента"]').click();
    await page.locator('.board-form-menu button[aria-label="Стикер"]').click();

    // Проверяем, что элемент стал стикером (появился фон/тень)
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
    const stickyNode = page.locator('.vue-flow__node-sticky').first();
    // Текст может быть внутри вложенного элемента — проверяем по всему узлу
    await expect(stickyNode.locator('.board-sticky-content')).toContainText('Конвертируем в стикер');
    // У стикера есть фон (жёлтый по умолчанию)
    await expect(stickyNode.locator('.board-sticky-content')).toHaveCSS('background-color', 'rgb(252, 235, 150)');
  });
});