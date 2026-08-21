import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { boardLocators } from '../src/board-locators';
import { expect, test } from '../src/fixtures';

/**
 * Анонимный гость по ссылке (без входа в аккаунт) сперва попадает на экран
 * «Представьтесь» (ввод имени) — тест на это не рассчитывал (14.9), из-за
 * этого падал даже после починки клика по «Поделиться ссылкой».
 */
async function joinAsGuest(guestPage: Page, name: string): Promise<void> {
  await guestPage.getByRole('textbox', { name: 'Ваше имя' }).fill(name);
  await guestPage.getByRole('button', { name: 'Открыть доску' }).click();
}

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

    // Владелец включает share-ссылку на просмотр — кнопка теперь в меню «Ещё действия» (14.3),
    // а сама модалка (14.9) — переключатель USwitch + USelect уровня доступа, не радио-кнопки:
    // включение тумблера сразу выставляет роль "view" по умолчанию (более безопасный дефолт).
    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Поделиться ссылкой' }).click();
    // Тумблер триггерит PATCH /api/boards/:id/share — гостя открываем ТОЛЬКО
    // после ответа сервера, иначе гонка (клик резолвится сразу, до сети)
    const shareRequest = page.waitForResponse((r) => r.url().includes('/share') && r.ok());
    await page.getByRole('switch').click();
    await shareRequest;

    // Анонимный гость открывает ссылку в новой вкладке (без авторизации)
    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);
    await joinAsGuest(guestPage, 'Гость Вью');

    // Гость видит доску, но не может редактировать
    await expect(guestPage).toHaveURL(/\/boards\/[0-9a-f-]{36}/);
    const board = boardLocators(guestPage);
    await expect(board.canvas).toBeVisible();
    // Нет кнопки редактирования для гостя (view-роль)
    // Кнопка тулбара — иконка с aria-label, без видимого текста (hasText её не ловит)
    await expect(guestPage.getByRole('button', { name: 'Стикер', exact: true })).toBeHidden();
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

    // Владелец включает share на правку — кнопка теперь в меню «Ещё действия» (14.3),
    // модалка — переключатель + USelect уровня доступа (14.9): сначала включаем
    // тумблер (дефолт "view"), затем переключаем уровень на "edit" через комбобокс.
    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Поделиться ссылкой' }).click();
    // Тумблер и выбор роли триггерят отдельные PATCH /api/boards/:id/share —
    // гостя открываем только после ВТОРОГО (финальная роль "edit"), иначе гонка
    const enableRequest = page.waitForResponse((r) => r.url().includes('/share') && r.ok());
    await page.getByRole('switch').click();
    await enableRequest;
    const editRoleRequest = page.waitForResponse((r) => r.url().includes('/share') && r.ok());
    await page.getByRole('combobox', { name: 'Уровень доступа' }).click();
    await page.getByRole('option', { name: 'Просмотр и правка' }).click();
    await editRoleRequest;

    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);
    await joinAsGuest(guestPage, 'Гость Эдит');

    // Гость может использовать инструменты (edit-роль) — тулбар рендерится
    // только после того, как canEdit разрешится по факту WS-join, не сразу
    // с видимостью канваса, поэтому ждём именно join, а не просто канвас
    const guestBoard = boardLocators(guestPage);
    await expect(guestBoard.joined).toBeVisible();
    // Кнопка тулбара — иконка с aria-label, без видимого текста (hasText её не ловит,
    // 14.9: старый локатор молча никогда не находил её — ни здесь, ни в view-тесте выше)
    await expect(guestPage.getByRole('button', { name: 'Стикер', exact: true })).toBeVisible();
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

    // Кнопка теперь в меню «Ещё действия» (14.3); модалка — переключатель (14.9):
    // включаем, затем тем же тумблером выключаем — второй клик выставляет роль в null.
    await page.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('menuitem', { name: 'Поделиться ссылкой' }).click();
    const shareSwitch = page.getByRole('switch');
    const enableRequest = page.waitForResponse((r) => r.url().includes('/share') && r.ok());
    await shareSwitch.click();
    await enableRequest;
    await expect(page.getByRole('combobox', { name: 'Уровень доступа' })).toBeVisible();

    // Отключаем — тот же тумблер, второй клик выставляет роль в null
    const disableRequest = page.waitForResponse((r) => r.url().includes('/share') && r.ok());
    await shareSwitch.click();
    await disableRequest;

    const guestContext = await newContext(browser);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(boardUrl);
    await expect(guestPage.locator('text=Доска не найдена или у вас нет доступа')).toBeVisible();
  });
});
