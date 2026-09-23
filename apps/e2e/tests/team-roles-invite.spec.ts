import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор: вступление в команду по инвайт-ссылке и смена роли
 * администратором — до этой задачи (6.5) команды не были покрыты e2e вовсе.
 * Обновлено под 20.3.4a: приглашение/переименование/удаление команды теперь
 * за меню в шапке (Team menu trigger), приглашение — модалка, а не инлайн-блок,
 * состав команды — за табом «Состав».
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

  // На пустом списке команд одновременно видны кнопка в шапке и кнопка пустого
  // состояния с тем же текстом — берём первую (шапка)
  await ownerPage.getByRole('button', { name: 'Создать команду' }).first().click();
  const teamName = `${E2E_ROOM_PREFIX}Team ${randomUUID().slice(0, 8)}`;
  await ownerPage.getByPlaceholder('Например, Команда фронтенда').fill(teamName);
  await ownerPage.locator('form').getByRole('button', { name: 'Создать', exact: true }).click();
  await ownerPage.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  await expect(ownerPage.getByRole('heading', { name: teamName })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Действия с командой' }).click();
  await ownerPage.getByRole('menuitem', { name: 'Пригласить' }).click();
  const inviteDialog = ownerPage.getByRole('dialog');
  await expect(inviteDialog).toBeVisible();
  const inviteUrl = await inviteDialog.locator('input[readonly]').inputValue();
  expect(inviteUrl).toContain('/invite/');
  await ownerPage.keyboard.press('Escape');
  await expect(inviteDialog).toBeHidden();

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
  await memberPage.getByRole('button', { name: 'Действия с командой' }).click();
  await expect(memberPage.getByRole('menuitem', { name: 'Переименовать' })).toHaveCount(0);
  await expect(memberPage.getByRole('menuitem', { name: 'Удалить команду' })).toHaveCount(0);
  await expect(memberPage.getByRole('menuitem', { name: 'Выйти из команды' })).toBeVisible();
  await memberPage.keyboard.press('Escape');

  // Состав команды — обычный REST, не WS-рассылка, поэтому владельцу нужна перезагрузка
  await ownerPage.reload();
  await ownerPage.getByRole('button', { name: 'Состав' }).click();
  const memberRow = ownerPage.locator('.border-default').filter({ hasText: member.name });
  await memberRow.getByRole('button', { name: 'Действия с участником' }).click();
  await ownerPage.getByRole('menuitem', { name: 'Изменить роль' }).click();
  await ownerPage.getByRole('menuitemcheckbox', { name: 'Администратор' }).click();
  // Текст тоста задублирован скрытым aria-live регионом для скринридеров — уточняем видимую зону (11.3)
  await expect(
    ownerPage.getByRole('region', { name: /Notifications/ }).getByText('Роль обновлена'),
  ).toBeVisible();

  // У повышенного до администратора участника появляется доступ к настройкам команды
  await memberPage.reload();
  await memberPage.getByRole('button', { name: 'Действия с командой' }).click();
  await expect(memberPage.getByRole('menuitem', { name: 'Переименовать' })).toBeVisible();
  await expect(memberPage.getByRole('menuitem', { name: 'Удалить команду' })).toBeVisible();
  await memberPage.keyboard.press('Escape');

  // Клик по участнику в составе открывает его карточку (10.14) с полным профилем —
  // владелец команды видит email коллеги-администратора
  await memberRow.getByRole('link', { name: member.name }).click();
  await ownerPage.waitForURL(/\/teams\/[0-9a-f-]{36}\/members\/[0-9a-f-]{36}/);
  await expect(ownerPage.getByRole('heading', { name: member.name })).toBeVisible();
  await expect(ownerPage.getByText(member.email)).toBeVisible();
  await expect(ownerPage.getByText('Администратор', { exact: true }).first()).toBeVisible();
});
