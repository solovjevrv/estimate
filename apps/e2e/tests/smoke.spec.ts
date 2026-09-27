import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { expectVoted, joinAsGuest, stat } from '../src/room-helpers';

/**
 * Golden path всего продукта одним прогоном: вход → создание комнаты →
 * подключение второго участника (гостя) по прямой ссылке → голосование →
 * вскрытие карт. Гоняется перед релизом (PR dev→main) — цель не покрыть все
 * ветки, а поймать, если что-то в основном сценарии сломалось насквозь.
 */
test('вход → комната → гость → голосование → вскрытие карт @smoke', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  const owner = await createUser('owner');

  const ownerContext = await newContext(browser);
  await loginAs(ownerContext, owner);
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('/');

  await ownerPage.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  const roomName = `${E2E_ROOM_PREFIX}Smoke ${randomUUID().slice(0, 8)}`;
  await ownerPage.getByPlaceholder('Например, Планирование спринта').fill(roomName);
  // Кнопка внутри модалки — тот же текст, что и у кнопки-триггера на главной,
  // поэтому уточняем через форму (триггер вне <form>, эта кнопка — внутри)
  await ownerPage.locator('form').getByRole('button', { name: 'Создать комнату' }).click();

  await ownerPage.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const roomUrl = ownerPage.url();

  // Гость подключается по прямой ссылке той же комнаты, без аккаунта
  const guestContext = await newContext(browser);
  const guestPage = await guestContext.newPage();
  await guestPage.goto(roomUrl);
  await joinAsGuest(guestPage, 'Гость Смоук');

  await expect(guestPage.getByText('Участники')).toBeVisible();
  await expect(ownerPage.getByText('Участники')).toBeVisible();

  await ownerPage.getByRole('button', { name: 'Начать раунд' }).click();
  await expect(guestPage.getByRole('button', { name: '5', exact: true })).toBeVisible();

  await ownerPage.getByRole('button', { name: '5', exact: true }).click();
  await guestPage.getByRole('button', { name: '8', exact: true }).click();

  // Голос гостя доезжает до владельца отдельной WS-рассылкой (room_state) — без
  // этого ожидания клик по «Вскрыть карты» мог случиться раньше, чем локальный
  // allVoted на странице владельца увидит второй голос, и вместо вскрытия
  // открылась бы модалка подтверждения (с тем же текстом на кнопке)
  await expectVoted(ownerPage, 2, 2);

  // Проголосовали оба — скрам-мастер вскрывает без запроса подтверждения
  await ownerPage.getByRole('button', { name: 'Вскрыть карты' }).click();

  await expect(ownerPage.getByText('Результаты раунда')).toBeVisible();
  await expect(guestPage.getByText('Результаты раунда')).toBeVisible();
  await expect(stat(ownerPage, 'Мин', '5')).toBeVisible();
  await expect(stat(ownerPage, 'Макс', '8')).toBeVisible();
});
