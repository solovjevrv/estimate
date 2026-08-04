import { randomUUID } from 'node:crypto';

import { FIBONACCI_DECK } from '@poker/shared';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор: большая комната (16 участников) голосует одним залпом.
 * Стол защищён блокировкой строки комнаты (см. README «Одновременные действия»),
 * но это не юнит-тест сервера, а сквозная проверка через реальные WS-соединения —
 * что при параллельных `submit_vote` ни один голос не теряется и не путается
 * с чужим при подсчёте итога.
 */
test('16 участников голосуют одновременно — все голоса учтены без потерь', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('owner-concurrent');
  const ownerContext = await newContext(browser);
  await loginAs(ownerContext, owner);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/');

  await ownerPage.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  const roomName = `${E2E_ROOM_PREFIX}Concurrent ${randomUUID().slice(0, 8)}`;
  await ownerPage.getByPlaceholder('Например, Планирование спринта').fill(roomName);
  await ownerPage.locator('form').getByRole('button', { name: 'Создать комнату' }).click();
  await ownerPage.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const roomUrl = ownerPage.url();

  const GUEST_COUNT = 15;
  const guestPages = [];
  for (let i = 0; i < GUEST_COUNT; i++) {
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.goto(roomUrl);
    await page.getByPlaceholder('Например, Мария').fill(`Гость ${i + 1}`);
    await page.getByRole('button', { name: 'Войти в комнату' }).click();
    guestPages.push(page);
  }

  const pages = [ownerPage, ...guestPages];

  // Каждому участнику — своё значение из колоды Фибоначчи (по кругу, колода короче состава) —
  // так итоговые мин/макс/среднее посчитаны из заведомо разных чисел, а не совпадения на одном.
  const values = pages.map((_, i) => FIBONACCI_DECK[i % FIBONACCI_DECK.length] as number);

  await ownerPage.getByRole('button', { name: 'Начать раунд' }).click();
  await expect(guestPages.at(-1)!.getByRole('button', { name: '5', exact: true })).toBeVisible();
  await expect(ownerPage.getByText(`Проголосовало: 0 из ${pages.length}`)).toBeVisible();

  // Голосуем настоящим залпом — все клики летят параллельно, а не по очереди
  await Promise.all(
    pages.map((page, i) =>
      page.getByRole('button', { name: String(values[i]), exact: true }).click(),
    ),
  );

  await expect(
    ownerPage.getByText(`Проголосовало: ${pages.length} из ${pages.length}`),
  ).toBeVisible();

  // Проголосовали все — вскрытие идёт без запроса подтверждения
  await ownerPage.getByRole('button', { name: 'Вскрыть карты' }).click();
  await expect(ownerPage.getByText('Результаты раунда')).toBeVisible();

  const sum = values.reduce((total, value) => total + value, 0);
  const average = Math.round((sum / values.length) * 100) / 100;
  const min = Math.min(...values);
  const max = Math.max(...values);

  await expect(ownerPage.getByText(`Среднее: ${average}`)).toBeVisible();
  await expect(ownerPage.getByText(`Мин: ${min}`)).toBeVisible();
  await expect(ownerPage.getByText(`Макс: ${max}`)).toBeVisible();
});
