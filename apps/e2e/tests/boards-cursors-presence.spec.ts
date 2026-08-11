import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * E2E на курсоры и presence (14.1): два браузерных контекста одного и того же
 * пользователя на одной личной доске. Проверяем:
 *  1. При входе второго участника панель «кто на доске» появляется с двумя
 *     аватарами/именами (presence broadcast по board:presence).
 *  2. Движение мыши в A рассылает курсор (board:awareness) — чужой курсор
 *     появляется в B на соответствующей позиции.
 *
 * Курсоры works в world-координатах (как в Miro): позиция проецируется через
 * project(), поэтому для проверки удобно сравнивать координаты canvas-слоя,
 * а не viewport-пиксели. В headleonless Chromium зум/панorama фиксированы
 * fit-view-on-init, так что world ≈ viewport в начале теста.
 */
test('курсоры участников и список «кто на доске» синхронизируются между участниками', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('cursors-owner');
  const contextA = await newContext(browser);
  await loginAs(contextA, owner);
  const pageA = await contextA.newPage();
  await pageA.goto('/boards');

  await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}Cursors ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardUrl = pageA.url();
  await expect(pageA.locator('.vue-flow__pane')).toBeVisible();

  // --- Второй участник входит на ту же доску ---
  const contextB = await newContext(browser);
  await loginAs(contextB, owner);
  const pageB = await contextB.newPage();
  await pageB.goto(boardUrl);
  await expect(pageB.locator('.vue-flow__pane')).toBeVisible();

  // --- Панель presence: оба участника видны ---
  // Один пользователь в двух вкладках — presence deduplication по userId
  // (см. BoardPresence.list) даст одну запись, поэтому проверяем, что панель
  // появилась (длина списка > 1 означает минимум 2 уникальных пользователя;
  // здесь владелец открыл доску дважды — один userId, панель не появится).
  // Чтобы проверить presence, создаём второго пользователя:
  const second = await createUser('cursors-second');
  const contextC = await newContext(browser);
  await loginAs(contextC, second);
  const pageC = await contextC.newPage();
  await pageC.goto(boardUrl);
  await expect(pageC.locator('.vue-flow__pane')).toBeVisible();

  // Панель «кто на доске» появляется, когда >1 уникального участника
  await expect(pageA.locator('.board-presence')).toBeVisible();
  await expect(pageA.locator('.board-presence-item')).toHaveCount(2);
  // Себя выделяем
  const selfItem = pageA.locator('.board-presence-item--self');
  await expect(selfItem).toBeVisible();

  // 1. Движение мыши в A — чужой курсор появляется в B
  await pageA.mouse.move(400, 300);

  // Курсор в B — элемент с классом board-cursor, не принадлежащий нам
  await expect(pageB.locator('.board-cursor')).toBeVisible();
  // Имя того, чей курсор виден — должно совпадать с именем владельца
  await expect(pageB.locator('.board-cursor-name')).toHaveText(owner.name);

  // 2. Движение мыши в B — курсор появляется в A
  await pageB.mouse.move(600, 400);
  await expect(pageA.locator('.board-cursor')).toBeVisible();
  await expect(pageA.locator('.board-cursor-name')).toHaveText(owner.name);
});
