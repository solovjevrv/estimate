import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * E2E на шаблоны досок (15.1): создание доски с шаблоном через модалку создания,
 * применение шаблона через галерею на пустой доске, а также через ?applyTemplate.
 * Глубокая проверка плотности элементов по количеству фреймов.
 */
test.describe('Доски: шаблоны', () => {
  test('создание доски с шаблоном Lean Canvas → 9 фреймов на холсте', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('board-template-create');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Template ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);

    // Выбираем шаблон Lean Canvas в выпадающем списке
    await page.getByRole('combobox').selectOption({ label: 'Lean Canvas' });
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Lean Canvas содержит 9 фреймов
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(9);
  });

  test('открытие пустой доски → галерея → выбор Start/Stop/Continue → 3 фрейма', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('board-template-picker');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Blank ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Галерея шаблонов появляется на пустой доске
    await expect(page.locator('.surface-card').filter({ hasText: 'Выберите шаблон' })).toBeVisible();

    // Выбираем шаблон Start/Stop/Continue
    await page.getByRole('button', { name: /Ретро.*Start.*Stop.*Continue/i }).click();

    // 3 фрейма и 3 стикера
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(3);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(3);
    // Галерея исчезла
    await expect(page.locator('.surface-card').filter({ hasText: 'Выберите шаблон' })).toBeHidden();
  });

  test('доска с контентом → галерея не показывается', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('board-template-skip');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}WithContent ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Создаём стикер вручную — галерея исчезнет
    await page.locator('.board-toolbar button[aria-label="Стикер"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 200, y: 200 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);

    await expect(page.locator('.surface-card').filter({ hasText: 'Выберите шаблон' })).toBeHidden();

    // Применяем шаблон через ?applyTemplate — после reload доска снова пустая, но
    // applyTemplate не добавит элементы, т.к. доска уже не пустая
    const boardId = page.url().match(/\/boards\/([0-9a-f-]{36})/)![1]!;
    await page.goto(`/boards/${boardId}?applyTemplate=9f3a1b2c-c111-4a11-8b11-000000000001`);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(0);
  });

  test('анонимный гость на пустой доске по ссылке → галерея не показывается', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('board-template-guest');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}GuestTemplate ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();
    const boardUrl = page.url();

    // Владелец включает share по ссылке на view
    await page.getByRole('button', { name: 'Поделиться ссылкой' }).click();
    await page.getByRole('radio', { name: 'Только просмотр' }).click();
    await page.getByRole('button', { name: /включить/i }).click();

    // Гость открывает в новой вкладке
    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);
    await expect(guestPage.locator('.vue-flow__pane')).toBeVisible();

    // Галерея не показывается: у гостя нет доступа к /api/board-templates (401)
    await expect(guestPage.locator('.surface-card').filter({ hasText: 'Выберите шаблон' })).toBeHidden();
  });
});
