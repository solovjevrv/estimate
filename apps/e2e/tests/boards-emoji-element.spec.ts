import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Эмодзи на холсте (13.3) — кнопка в левом тулбаре сама открывает список (без
 * промежуточного клика по холсту), выбор сразу вставляет элемент в центр
 * вьюпорта; тулбар выделения — только замена эмодзи/дублировать/удалить (как
 * у картинки, никаких форма/цвет/текстовых регуляторов).
 */
test.describe('Доски: эмодзи', () => {
  test('вставка через тулбар, персистентность после reload и упрощённый тулбар выделения', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-emoji');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Emoji ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Клик по инструменту сразу открывает список — без клика по холсту
    await page.locator('.board-toolbar button[aria-label="Эмодзи"]').click();
    await page.getByRole('button', { name: '🔥', exact: true }).click();

    const emojiNode = page.locator('.vue-flow__node-emoji').first();
    await expect(emojiNode).toBeVisible();
    await expect(emojiNode).toContainText('🔥');

    // Переживает перезагрузку — сохранилось на сервере
    await page.reload();
    await expect(page.locator('.vue-flow__node-emoji')).toHaveCount(1);
    await expect(page.locator('.vue-flow__node-emoji').first()).toContainText('🔥');

    // Тулбар выделения — только замена эмодзи + дублировать + удалить
    await page.locator('.vue-flow__node-emoji').click();
    const toolbar = page.locator('.board-selection-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByLabel('Заменить эмодзи')).toBeVisible();
    await expect(toolbar.getByLabel('Тип элемента')).toHaveCount(0);
    await expect(toolbar.getByLabel('Цвет')).toHaveCount(0);
    await expect(toolbar.getByLabel('Настройки текста')).toHaveCount(0);
    await expect(toolbar.getByLabel('Выравнивание')).toHaveCount(0);
    await expect(toolbar.getByLabel('Начертание')).toHaveCount(0);
    await expect(toolbar.getByLabel('Маркер')).toHaveCount(0);
    await expect(toolbar.getByLabel('Ссылка')).toHaveCount(0);
    await expect(toolbar.getByLabel('Дублировать')).toBeVisible();
    await expect(toolbar.getByLabel('Удалить')).toBeVisible();

    // Замена эмодзи через тулбар выделения
    await toolbar.getByLabel('Заменить эмодзи').click();
    await page.getByRole('button', { name: '🚀', exact: true }).click();
    await expect(page.locator('.vue-flow__node-emoji').first()).toContainText('🚀');
    await expect(page.locator('.vue-flow__node-emoji')).toHaveCount(1);
  });
});
