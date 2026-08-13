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
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Lean Canvas' }).click();
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

    // Триггер галереи шаблонов виден на пустой доске (нижняя панель холста)
    await page.getByRole('button', { name: 'Начать с шаблона' }).click();

    // Выбираем шаблон Start/Stop/Continue в открывшейся галерее
    await page.getByRole('button', { name: /Ретро.*Start.*Stop.*Continue/i }).click();

    // 3 фрейма и 3 стикера
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(3);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(3);
    // Триггер исчез — доска больше не пустая
    await expect(page.getByRole('button', { name: 'Начать с шаблона' })).toBeHidden();
  });

  test('доска с контентом → триггер шаблонов не показывается', async ({
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

    await expect(page.getByRole('button', { name: 'Начать с шаблона' })).toBeHidden();

    // Применяем шаблон через ?applyTemplate — после reload доска снова пустая, но
    // applyTemplate не добавит элементы, т.к. доска уже не пустая
    const boardId = page.url().match(/\/boards\/([0-9a-f-]{36})/)![1]!;
    await page.goto(`/boards/${boardId}?applyTemplate=9f3a1b2c-c111-4a11-8b11-000000000001`);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(0);
  });

  test('анонимный гость на пустой доске по ссылке → триггер шаблонов не показывается', async ({
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

    // Владелец включает share по ссылке — кнопка спрятана в меню «Ещё действия»;
    // тумблер сразу включает роль view (безопасный дефолт, BoardShareModal.vue onToggle)
    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Поделиться ссылкой' }).click();
    const shareResponse = page.waitForResponse(
      (res) => res.url().includes('/share') && res.request().method() === 'PATCH',
    );
    await page.getByRole('switch').click();
    await shareResponse;
    await page.getByRole('button', { name: 'Готово' }).click();

    // Гость открывает в новой вкладке
    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);
    // Гость без сессии сперва представляется именем (14.4), потом заходит на доску
    await guestPage.getByPlaceholder('Например, Мария').fill('E2E Guest');
    await guestPage.getByRole('button', { name: 'Открыть доску' }).click();
    await expect(guestPage.locator('.vue-flow__pane')).toBeVisible();

    // Триггер не показывается: у гостя нет доступа к /api/board-templates (401)
    await expect(guestPage.getByRole('button', { name: 'Начать с шаблона' })).toBeHidden();
  });
});
