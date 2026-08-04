import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор: таймер обсуждения синхронизируется между участниками
 * через рассылку `room_state`, и управлять им может любой участник, а не
 * только скрам-мастер (решение 27.07.2026).
 */
test('таймер обсуждения синхронизируется между участниками и им управляет любой участник', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('owner-timer');
  const ownerContext = await newContext(browser);
  await loginAs(ownerContext, owner);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/');

  await ownerPage.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  const roomName = `${E2E_ROOM_PREFIX}Timer ${randomUUID().slice(0, 8)}`;
  await ownerPage.getByPlaceholder('Например, Планирование спринта').fill(roomName);
  await ownerPage.locator('form').getByRole('button', { name: 'Создать комнату' }).click();
  await ownerPage.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const roomUrl = ownerPage.url();

  const guestContext = await newContext(browser);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(roomUrl);
  await guestPage.getByPlaceholder('Например, Мария').fill('Гость Таймер');
  await guestPage.getByRole('button', { name: 'Войти в комнату' }).click();
  await expect(ownerPage.getByText('Участники')).toBeVisible();

  // По умолчанию 5 мин, ещё не запущен
  await expect(ownerPage.getByText('5:00')).toBeVisible();
  await expect(guestPage.getByText('5:00')).toBeVisible();

  // Владелец меняет пресет на 10 минут — гость видит новое значение без каких-либо действий
  await ownerPage.getByRole('button', { name: '10 мин', exact: true }).click();
  await expect(ownerPage.getByText('10:00')).toBeVisible();
  await expect(guestPage.getByText('10:00')).toBeVisible();

  // Гость (не скрам-мастер) запускает отсчёт — прав на это не требуется
  await guestPage.getByRole('button', { name: 'Старт', exact: true }).click();
  await expect(guestPage.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible();
  await expect(ownerPage.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible();

  // Владелец ставит на паузу — состояние снова синхронизируется у обоих
  await ownerPage.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(ownerPage.getByRole('button', { name: 'Старт', exact: true })).toBeVisible();
  await expect(guestPage.getByRole('button', { name: 'Старт', exact: true })).toBeVisible();

  // Сброс на другой пресет виден обоим
  await guestPage.getByRole('button', { name: '15 мин', exact: true }).click();
  await expect(ownerPage.getByText('15:00')).toBeVisible();
  await expect(guestPage.getByText('15:00')).toBeVisible();
});
