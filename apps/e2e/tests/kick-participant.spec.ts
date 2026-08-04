import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор: исключение участника скрам-мастером (5.8), в том числе
 * когда исключённый успел проголосовать до вскрытия — его голос должен
 * остаться учтён в результате (см. RoundResultPanel «Проголосовали и вышли»),
 * а не пропасть молча.
 */
test('скрам-мастер исключает проголосовавшего участника — голос учтён в результате как «вышедший»', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('owner-kick');
  const ownerContext = await newContext(browser);
  await loginAs(ownerContext, owner);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/');

  await ownerPage.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  const roomName = `${E2E_ROOM_PREFIX}Kick ${randomUUID().slice(0, 8)}`;
  await ownerPage.getByPlaceholder('Например, Планирование спринта').fill(roomName);
  await ownerPage.locator('form').getByRole('button', { name: 'Создать комнату' }).click();
  await ownerPage.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const roomUrl = ownerPage.url();

  const guestContext = await newContext(browser);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(roomUrl);
  const guestName = 'Гость Кик';
  await guestPage.getByPlaceholder('Например, Мария').fill(guestName);
  await guestPage.getByRole('button', { name: 'Войти в комнату' }).click();
  await expect(ownerPage.getByText('Участники')).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Начать раунд' }).click();
  await expect(guestPage.getByRole('button', { name: '8', exact: true })).toBeVisible();

  await guestPage.getByRole('button', { name: '8', exact: true }).click();
  await ownerPage.getByRole('button', { name: '5', exact: true }).click();
  await expect(ownerPage.getByText('Проголосовало: 2 из 2')).toBeVisible();

  // Скрам-мастер открывает меню действий на карточке гостя и исключает его
  await ownerPage.getByRole('button', { name: `Действия с участником ${guestName}` }).click();
  await ownerPage.getByRole('menuitem', { name: 'Исключить' }).click();
  await expect(ownerPage.getByText('Исключить из комнаты?')).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Исключить', exact: true }).click();

  // Текст тоста задублирован скрытым aria-live регионом для скринридеров — уточняем видимую зону
  await expect(
    ownerPage
      .getByRole('region', { name: /Notifications/ })
      .getByText(`${guestName} исключён из комнаты`),
  ).toBeVisible();
  await expect(guestPage.getByText('Скрам-мастер исключил вас из этой комнаты.')).toBeVisible();
  await expect(guestPage.getByRole('button', { name: 'Войти снова' })).toBeVisible();

  // Остался один участник (владелец), он уже проголосовал — вскрытие идёт без запроса подтверждения
  await ownerPage.getByRole('button', { name: 'Вскрыть карты' }).click();
  await expect(ownerPage.getByText('Результаты раунда')).toBeVisible();
  await expect(ownerPage.getByText('Мин: 5')).toBeVisible();
  await expect(ownerPage.getByText('Макс: 8')).toBeVisible();
  await expect(ownerPage.getByText('Проголосовали и вышли')).toBeVisible();
  await expect(ownerPage.getByText(`${guestName}: 8`)).toBeVisible();
});
