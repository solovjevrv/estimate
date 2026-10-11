import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { createTeamBoard, createTeamWithInvite } from '../src/team-helpers';

/**
 * Перенос (10.24): личная комната → в команду → снова личная; личная доска →
 * в команду. Пользователь — админ своей команды: заводить там можно и комнаты,
 * и доски, значит и переносить туда.
 */
async function moveTo(page: Page, destination: string | null): Promise<void> {
  await page.getByRole('menuitem', { name: 'Перенести…' }).click();
  const dialog = page.getByTestId('move-entity-modal');
  await expect(dialog).toBeVisible();
  if (destination) {
    await page.getByTestId('move-destination').click();
    await page.getByRole('option', { name: destination }).click();
  }
  await page.getByTestId('move-submit').click();
  await expect(dialog).toBeHidden();
}

test('комната и доска: личная → командная → личная', async ({ page, createUser, loginAs }) => {
  test.slow();
  const owner = await createUser('move-owner');
  await loginAs(page.context(), owner);
  await createTeamWithInvite(page);
  const teamName = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();

  // Личная комната: переключатель «Командная комната» выключаем
  await page.goto('/my-rooms');
  await page.getByRole('button', { name: 'Новая комната' }).first().click();
  await page
    .getByPlaceholder('Например, Планирование спринта')
    .fill(`${E2E_ROOM_PREFIX}Move ${randomUUID().slice(0, 8)}`);
  await page.getByRole('switch', { name: 'Командная комната' }).click();
  await page.locator('form').getByRole('button', { name: 'Создать комнату' }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  await expect(page.getByText('Личная комната')).toBeVisible();

  // «Отмена» и крестик закрывают окно без переноса
  const dialog = page.getByTestId('move-entity-modal');
  await page.getByRole('button', { name: 'Меню комнаты' }).click();
  await page.getByRole('menuitem', { name: 'Перенести…' }).click();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Меню комнаты' }).click();
  await page.getByRole('menuitem', { name: 'Перенести…' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Закрыть|Close/ })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Личная комната')).toBeVisible();

  await page.getByRole('button', { name: 'Меню комнаты' }).click();
  await moveTo(page, teamName);
  await expect(page.getByText(`Команда «${teamName}»`)).toBeVisible();

  // Обратно: «Личная» — первый вариант у командной комнаты
  await page.getByRole('button', { name: 'Меню комнаты' }).click();
  await moveTo(page, null);
  await expect(page.getByText('Личная комната')).toBeVisible();

  // Личная доска → команда: подзаголовок в плашке названия на холсте
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Новая доска', exact: true }).click();
  await page
    .getByPlaceholder('Например, Ретро спринта 24')
    .fill(`${E2E_ROOM_PREFIX}Move board ${randomUUID().slice(0, 8)}`);
  const teamSwitch = page.getByRole('switch', { name: 'Командная доска' });
  if (await teamSwitch.isChecked()) await teamSwitch.click();
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  await expect(boardLocators(page).joined).toBeVisible();
  await expect(page.getByText('Личная доска')).toBeVisible();

  await page.getByRole('button', { name: 'Ещё действия' }).click();
  await moveTo(page, teamName);
  await expect(page.getByText(`Командная доска · ${teamName}`)).toBeVisible();
});

/**
 * Командная доска стала личной, пока участник команды на ней сидит: сервер
 * выводит всех из канала доски, участник перезаходит и видит «нет доступа» —
 * без перезагрузки страницы.
 */
test('доска стала личной — у участника команды на открытой доске доступ пропадает сразу', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();
  const owner = await createUser('move-live-owner');
  const ownerContext = await newContext(browser);
  await loginAs(ownerContext, owner);
  const ownerPage = await ownerContext.newPage();
  const { inviteUrl } = await createTeamWithInvite(ownerPage);
  const boardUrl = await createTeamBoard(ownerPage, 'Move live');
  await expect(boardLocators(ownerPage).joined).toBeVisible();

  const member = await createUser('move-live-member');
  const memberContext = await newContext(browser);
  await loginAs(memberContext, member);
  const memberPage = await memberContext.newPage();
  await memberPage.goto(new URL(inviteUrl).pathname);
  await memberPage.getByRole('button', { name: 'Вступить' }).click();
  await memberPage.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  await memberPage.goto(boardUrl);
  await expect(boardLocators(memberPage).joined).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Ещё действия' }).click();
  await moveTo(ownerPage, null);
  await expect(ownerPage.getByText('Личная доска')).toBeVisible();

  await expect(memberPage.getByText('Доска не найдена или у вас нет доступа.')).toBeVisible();
});
