import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * E2E на follow-mode камеры (14.5). По тому же шаблону, что
 * `boards-cursors-presence.spec.ts`, что `boards-share-link.spec.ts`:
 * команда + приглашённый второй участник + доска внутри команды — нужны два
 * уникальных пользователя, чтобы presence-панель и курсоры/камеры синхронизировались
 * между ними (один и тот же пользователь в разных вкладках схлопывается в одну
 * запись presence по participantId).
 *
 * Проверяем:
 *  1. Участник B кликает аватарку A в стеке presence → B переходит в режим
 *     следования, и его viewport программно движется к позиции камеры A.
 *  2. Ручной пан/зум B (через @move-start) во время слежения обрывает follow-mode.
 *  3. Уход A с доски (закрытие вкладки) автоматически снимает слежение у B.
 */
test.describe('follow-mode камеры (14.5)', () => {
  test('участник B кликает аватарку A и следует за её камерой', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();

    const owner = await createUser('follow-owner');
    const second = await createUser('follow-second');

    const ctxA = await newContext(browser);
    await loginAs(ctxA, owner);
    const pageA = await ctxA.newPage();
    await pageA.goto('/teams');

    await pageA.getByRole('button', { name: 'Создать команду' }).click();
    const teamName = `${E2E_ROOM_PREFIX}Team ${randomUUID().slice(0, 8)}`;
    await pageA.getByPlaceholder('Например, Команда фронтенда').fill(teamName);
    await pageA.locator('form').getByRole('button', { name: 'Создать', exact: true }).click();
    await pageA.waitForURL(/\/teams\/[0-9a-f-]{36}/);
    const inviteUrl = await pageA.locator('input[readonly]').inputValue();

    // Доска внутри команды — оба участника видят её
    await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Follow ${randomUUID().slice(0, 8)}`;
    await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    const boardA = boardLocators(pageA);
    const boardUrl = pageA.url();
    await expect(boardA.pane).toBeVisible();

    // Второй пользователь входит в команду по приглашению
    const ctxB = await newContext(browser);
    await loginAs(ctxB, second);
    const pageB = await ctxB.newPage();
    await pageB.goto(new URL(inviteUrl).pathname);
    await pageB.getByRole('button', { name: 'Вступить' }).click();
    await pageB.waitForURL(/\/teams\/[0-9a-f-]{36}/);
    await pageB.goto(boardUrl);
    const boardB = boardLocators(pageB);
    await expect(boardB.pane).toBeVisible();

    // Presence: оба участника на доске
    await expect(boardA.presence).toBeVisible();
    await expect(boardA.presenceAvatars).toHaveCount(2);
    await expect(boardB.presenceAvatars).toHaveCount(2);

    // --- A панорамирует холст — камера улетает в broadcast (throttled 150мс) ---
    const paneA = boardA.pane;
    await paneA.waitFor();
    const paneABox = await paneA.boundingBox();
    expect(paneABox).not.toBeNull();
    const panStartX = paneABox!.x + paneABox!.width / 2;
    const panStartY = paneABox!.y + paneABox!.height / 2;
    await pageA.mouse.move(panStartX, panStartY);
    await pageA.mouse.down();
    await pageA.mouse.move(panStartX + 200, panStartY + 100, { steps: 5 });
    await pageA.mouse.up();

    // Ждём, пока камера A долетит до B (throttled 150мс + небольшая мargen)
    await pageB.waitForTimeout(300);

    // --- B кликает аватарку A (НЕ свою) → входит в follow-mode ---
    await expect(boardB.nonSelfAvatars).toHaveCount(1);
    const avatarBox = await boardB.nonSelfAvatars.boundingBox();
    expect(avatarBox).not.toBeNull();
    await pageB.mouse.click(
      avatarBox!.x + avatarBox!.width / 2,
      avatarBox!.y + avatarBox!.height / 2,
    );

    // Включился follow-mode: появился чип «Вы следите за…» и обводка --following
    await expect(boardB.followingBadge.filter({ hasText: /Вы следите за/i })).toBeVisible();
    await expect(boardB.followingAvatar).toHaveCount(1);

    // viewport B должен совпадать с позицией камеры A
    const viewportB = await boardB.viewport.getAttribute('style');
    // Позиция изменилась от начальной (fit-view-on-init), а не осталась в нуле
    expect(viewportB).not.toBeNull();
    expect(viewportB).toMatch(/translate\(\s*-?\d+/);
  });
});

test('ручной пан/зум участника B во время слежения обрывает follow-mode', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('follow-pan-owner');
  const second = await createUser('follow-pan-second');

  const ctxA = await newContext(browser);
  await loginAs(ctxA, owner);
  const pageA = await ctxA.newPage();
  await pageA.goto('/teams');

  await pageA.getByRole('button', { name: 'Создать команду' }).click();
  const teamName = `${E2E_ROOM_PREFIX}Team ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Команда фронтенда').fill(teamName);
  await pageA.locator('form').getByRole('button', { name: 'Создать', exact: true }).click();
  await pageA.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  const inviteUrl = await pageA.locator('input[readonly]').inputValue();

  await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}FollowPan ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardA = boardLocators(pageA);
  const boardUrl = pageA.url();
  await expect(boardA.pane).toBeVisible();

  const ctxB = await newContext(browser);
  await loginAs(ctxB, second);
  const pageB = await ctxB.newPage();
  await pageB.goto(new URL(inviteUrl).pathname);
  await pageB.getByRole('button', { name: 'Вступить' }).click();
  await pageB.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  await pageB.goto(boardUrl);
  const boardB = boardLocators(pageB);
  await expect(boardB.pane).toBeVisible();

  await expect(boardB.presenceAvatars).toHaveCount(2);

  // B begins following A
  await expect(boardB.nonSelfAvatars).toHaveCount(1);
  const box = await boardB.nonSelfAvatars.boundingBox();
  expect(box).not.toBeNull();
  await pageB.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(boardB.followingAvatar).toHaveCount(1);

  // B вручную панорамирует — @move-start разрывает follow-mode
  const paneB = boardB.pane;
  const paneBBox = await paneB.boundingBox();
  expect(paneBBox).not.toBeNull();
  await pageB.mouse.move(paneBBox!.x + paneBBox!.width / 2, paneBBox!.y + paneBBox!.height / 2);
  await pageB.mouse.down();
  await pageB.mouse.move(
    paneBBox!.x + paneBBox!.width / 2 + 100,
    paneBBox!.y + paneBBox!.height / 2 + 50,
    { steps: 3 },
  );
  await pageB.mouse.up();

  // follow-mode разорван: обводка --following исчезла, чип исчез
  await expect(boardB.followingAvatar).toHaveCount(0);
  await expect(boardB.followingBadge.filter({ hasText: /Вы следите за/i })).toHaveCount(0);
});

test('уход A с доски снимает слежение у B', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('follow-leave-owner');
  const second = await createUser('follow-leave-second');

  const ctxA = await newContext(browser);
  await loginAs(ctxA, owner);
  const pageA = await ctxA.newPage();
  await pageA.goto('/teams');

  await pageA.getByRole('button', { name: 'Создать команду' }).click();
  const teamName = `${E2E_ROOM_PREFIX}Team ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Команда фронтенда').fill(teamName);
  await pageA.locator('form').getByRole('button', { name: 'Создать', exact: true }).click();
  await pageA.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  const inviteUrl = await pageA.locator('input[readonly]').inputValue();

  await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}FollowLeave ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardA = boardLocators(pageA);
  const boardUrl = pageA.url();
  await expect(boardA.pane).toBeVisible();

  const ctxB = await newContext(browser);
  await loginAs(ctxB, second);
  const pageB = await ctxB.newPage();
  await pageB.goto(new URL(inviteUrl).pathname);
  await pageB.getByRole('button', { name: 'Вступить' }).click();
  await pageB.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  await pageB.goto(boardUrl);
  const boardB = boardLocators(pageB);
  await expect(boardB.pane).toBeVisible();

  await expect(boardB.presenceAvatars).toHaveCount(2);

  // B подписывается на A
  await expect(boardB.nonSelfAvatars).toHaveCount(1);
  const box = await boardB.nonSelfAvatars.boundingBox();
  expect(box).not.toBeNull();
  await pageB.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(boardB.followingAvatar).toHaveCount(1);

  // A закрывает вкладку → покидает доску → presence перестраивается без A
  await ctxA.close();

  // B автоматически снимает слежение — A исчез из presence
  await expect(boardB.presenceAvatars).toHaveCount(1);
  await expect(boardB.followingAvatar).toHaveCount(0);
  await expect(boardB.followingBadge.filter({ hasText: /Вы следите за/i })).toHaveCount(0);
});
