import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Клик по инструменту сразу открывает список — без клика по холсту
    await board.toolbarButton('Эмодзи').click();
    await page.getByRole('button', { name: 'fire', exact: true }).click();

    const emojiNode = board.emojiNodes.first();
    await expect(emojiNode).toBeVisible();
    await expect(emojiNode).toContainText('🔥');

    // Переживает перезагрузку — сохранилось на сервере
    await page.reload();
    await expect(board.emojiNodes).toHaveCount(1);
    await expect(board.emojiNodes.first()).toContainText('🔥');

    // Тулбар выделения — только замена эмодзи + дублировать + удалить
    await board.emojiNodes.click();
    const toolbar = board.selectionToolbar;
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
    await page.getByRole('button', { name: 'rocket', exact: true }).click();
    await expect(board.emojiNodes.first()).toContainText('🚀');
    await expect(board.emojiNodes).toHaveCount(1);
  });
});
