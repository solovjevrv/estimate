import { randomUUID } from 'node:crypto';

import { expect, test } from '../src/fixtures';

/**
 * E2E на доски по ссылке (14.4). Проверяем сценарии share-by-link + guest access.
 */
test.describe('доски по ссылке (14.4)', () => {
test('владелец включает ссылку, анонимный гость заходит по ней в режиме просмотра', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('share-owner');
  const contextA = await newContext(browser);
  const page = await contextA.newPage();
  await loginAs(contextA, owner);
  await page.goto('/boards');

    // Создаём личную доску
    await page.getByRole('button', { name: 'Создать доску' }).click();
    const boardName = `ShareBoard ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);

    const boardUrl = page.url();

    // Владелец включает share-ссылку на просмотр
    await page
      .getByRole('button', { name: 'Поделиться ссылкой' })
      .or(page.locator('button').filter({ hasText: 'Поделиться ссылкой' }))
      .click();
    await page.getByRole('radio', { name: 'Только просмотр' }).click();
    await page
      .getByRole('button', { name: 'Включить доступ по ссылке (просмотр)' })
      .or(page.locator('button').filter({ hasText: /включить/i }))
      .click();

    // Анонимный гость открывает ссылку в новой вкладке (без авторизации)
    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);

    // Гость видит доску, но не может редактировать
    await expect(guestPage).toHaveURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(guestPage.locator('.board-canvas')).toBeVisible();
    // Нет кнопки редактирования для гостя (view-роль)
    await expect(guestPage.locator('button').filter({ hasText: /стикер/i })).toBeHidden();
  });

  test('гость может редактировать, если ссылка включена на правку', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('share-edit-owner');
    const contextA = await newContext(browser);
    const page = await contextA.newPage();
    await loginAs(contextA, owner);
    await page.goto('/boards');

    await page.getByRole('button', { name: 'Создать доску' }).click();
    const boardName = `ShareEdit ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);

    const boardUrl = page.url();

    // Владелец включает share на правку
    await page.locator('button').filter({ hasText: 'Поделиться ссылкой' }).click();
    await page.getByRole('radio', { name: 'Просмотр и правка' }).click();
    await page.locator('button').filter({ hasText: /включить/i }).click();

    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);

    // Гость может использовать инструменты (edit-роль)
    await expect(guestPage.locator('.board-canvas')).toBeVisible();
    await expect(guestPage.locator('button').filter({ hasText: /стикер/i })).toBeVisible();
  });

  test('без ссылки анонимный доступ получает 404', async ({ page }) => {
    // Любая несуществующая или закрытая доска — анониму 404 (анти-перебор)
    await page.goto(`/boards/${randomUUID()}`);
    await expect(page.locator('text=Доска не найдена или у вас нет доступа')).toBeVisible();
  });

  test('отключение ссылки закрывает доступ для гостей', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    const owner = await createUser('share-disable-owner');
    const contextA = await newContext(browser);
    const page = await contextA.newPage();
    await loginAs(contextA, owner);
    await page.goto('/boards');

    await page.getByRole('button', { name: 'Создать доску' }).click();
    const boardName = `ShareDisable ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);

    const boardUrl = page.url();

    await page.locator('button').filter({ hasText: 'Поделиться ссылкой' }).click();
    await page.getByRole('radio', { name: 'Только просмотр' }).click();
    await page.locator('button').filter({ hasText: /включить/i }).click();

    // Отключаем — выбираем "Отключить доступ по ссылке" или режим null
    await page.locator('button').filter({ hasText: 'Отключить доступ по ссылке' }).click();

    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);
    await expect(guestPage.locator('text=Доска не найдена или у вас нет доступа')).toBeVisible();
  });
});
