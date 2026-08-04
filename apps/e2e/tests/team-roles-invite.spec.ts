import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор: вступление в команду по инвайт-ссылке и смена роли
 * администратором — до этой задачи (6.5) команды не были покрыты e2e вовсе.
 */
test('вступление в команду по инвайт-ссылке и смена роли участнику администратором', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('owner-roles');
  const ownerContext = await newContext(browser);
  await loginAs(ownerContext, owner);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/teams');

  await ownerPage.getByRole('button', { name: 'Создать команду' }).click();
  const teamName = `${E2E_ROOM_PREFIX}Team ${randomUUID().slice(0, 8)}`;
  await ownerPage.getByPlaceholder('Например, Команда фронтенда').fill(teamName);
  await ownerPage.locator('form').getByRole('button', { name: 'Создать', exact: true }).click();
  await ownerPage.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  await expect(ownerPage.getByRole('heading', { name: teamName })).toBeVisible();

  const inviteUrl = await ownerPage.locator('input[readonly]').inputValue();
  expect(inviteUrl).toContain('/invite/');

  // Второй пользователь вступает по ссылке-приглашению — сразу вошедшим, без экрана логина
  const member = await createUser('member-roles');
  const memberContext = await newContext(browser);
  await loginAs(memberContext, member);
  const memberPage = await memberContext.newPage();
  await memberPage.goto(new URL(inviteUrl).pathname);
  await memberPage.getByRole('button', { name: 'Вступить' }).click();
  await memberPage.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  // «Участник» встречается дважды (бейдж роли в шапке и в своей же строке состава) — берём шапку
  await expect(memberPage.getByText('Участник', { exact: true }).first()).toBeVisible();

  // Рядовой участник не управляет командой — ни настроек, ни смены чужих ролей
  await expect(memberPage.getByRole('button', { name: 'Переименовать' })).toHaveCount(0);
  await expect(memberPage.getByRole('button', { name: 'Удалить команду' })).toHaveCount(0);

  // Состав команды — обычный REST, не WS-рассылка, поэтому владельцу нужна перезагрузка
  await ownerPage.reload();
  const memberRow = ownerPage.locator('.border-default').filter({ hasText: member.name });
  await memberRow.getByRole('combobox', { name: 'Роль' }).click();
  await ownerPage.getByRole('option', { name: 'Администратор' }).click();
  await expect(ownerPage.getByText('Роль обновлена')).toBeVisible();

  // У повышенного до администратора участника появляется доступ к настройкам команды
  await memberPage.reload();
  await expect(memberPage.getByRole('button', { name: 'Переименовать' })).toBeVisible();
  await expect(memberPage.getByRole('button', { name: 'Удалить команду' })).toBeVisible();
});
