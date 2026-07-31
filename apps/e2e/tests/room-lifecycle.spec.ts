import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор (не smoke): гоняется ночным cron'ом/вручную, не на
 * каждый PR. Проверяет архивацию — комната должна остаться доступна для
 * чтения, но закрыть действия за столом.
 */
test('архивация комнаты закрывает стол для действий, но оставляет доступной для чтения', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('owner-lifecycle');
  const context = await newContext(browser);
  await loginAs(context, owner);
  const page = await context.newPage();
  await page.goto('/');

  await page.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  const roomName = `${E2E_ROOM_PREFIX}Lifecycle ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Например, Планирование спринта').fill(roomName);
  await page.locator('form').getByRole('button', { name: 'Создать комнату' }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]{36}/);

  await page.getByRole('button', { name: 'Меню комнаты' }).click();
  await page.getByRole('menuitem', { name: 'Архивировать комнату' }).click();
  await page.getByRole('button', { name: 'Архивировать', exact: true }).click();

  await expect(page.getByText('Архивная')).toBeVisible();
  await expect(page.getByText('Комната в архиве: доступна только для чтения.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Начать раунд' })).toHaveCount(0);
});
