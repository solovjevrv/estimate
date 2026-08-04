import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор: смена типа колоды и перезапуск раунда во время
 * голосования — самые частые ветки, которых нет в smoke-сценарии (там
 * колода одна и раунд один).
 */
test('отмена раунда, смена шкалы во время голосования и новый раунд после вскрытия', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('owner-deck');
  const context = await newContext(browser);
  await loginAs(context, owner);
  const page = await context.newPage();
  await page.goto('/');

  await page.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  const roomName = `${E2E_ROOM_PREFIX}Deck ${randomUUID().slice(0, 8)}`;
  await page.getByPlaceholder('Например, Планирование спринта').fill(roomName);
  await page.locator('form').getByRole('button', { name: 'Создать комнату' }).click();
  await page.waitForURL(/\/rooms\/[0-9a-f-]{36}/);

  // Раунда ещё нет — колода по умолчанию Фибоначчи, кнопка «Начать раунд»
  await page.getByRole('button', { name: 'Начать раунд' }).click();
  await expect(page.getByRole('button', { name: '5', exact: true })).toBeVisible();

  // Голосуем — теперь на кнопке «Отменить раунд», клик по ней спрашивает подтверждение,
  // потому что есть, что терять
  await page.getByRole('button', { name: '5', exact: true }).click();
  await expect(page.getByText('Проголосовало: 1 из 1')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить раунд' }).click();
  await expect(page.getByText('Отменить голосование?')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить и начать заново' }).click();

  // Раунд перезапустился той же колодой — свой голос сброшен, счётчик обнулился
  await expect(page.getByText('Проголосовало: 0 из 1')).toBeVisible();

  // Голосуем снова и переключаем шкалу на «Футболки» — тоже требует подтверждения,
  // раунд перезапускается уже новой колодой. Ждём, пока голос долетит до сервера и
  // счётчик обновится — иначе смена колоды видит votedCount ещё нулевым и перезапускает
  // раунд молча, без вопроса (то же поведение, что и при пустом столе).
  await page.getByRole('button', { name: '5', exact: true }).click();
  await expect(page.getByText('Проголосовало: 1 из 1')).toBeVisible();
  await page.getByRole('button', { name: 'Футболки', exact: true }).click();
  await expect(page.getByText('Отменить голосование?')).toBeVisible();
  await page.getByRole('button', { name: 'Отменить и начать заново' }).click();

  await expect(page.getByRole('button', { name: 'XS', exact: true })).toBeVisible();
  await expect(page.getByText('Проголосовало: 0 из 1')).toBeVisible();

  // Вскрываем карты и запускаем новый раунд той же (последней выбранной) колодой —
  // после вскрытия перезапуск больше не спрашивает подтверждения. Дожидаемся, пока
  // голос долетит до сервера, — иначе «Вскрыть карты» увидит allVoted ещё ложным и
  // откроет модалку подтверждения вместо прямого вскрытия.
  await page.getByRole('button', { name: 'XS', exact: true }).click();
  await expect(page.getByText('Проголосовало: 1 из 1')).toBeVisible();
  await page.getByRole('button', { name: 'Вскрыть карты' }).click();
  await expect(page.getByText('Результаты раунда')).toBeVisible();
  await expect(page.getByText('Мин: XS')).toBeVisible();

  await page.getByRole('button', { name: 'Новый раунд' }).click();
  await expect(page.getByRole('button', { name: 'XS', exact: true })).toBeVisible();
  await expect(page.getByText('Проголосовало: 0 из 1')).toBeVisible();
});
