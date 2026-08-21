import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * E2E на курсоры и presence (14.1). Личная доска (без teamId) доступна только
 * её владельцу (`BoardsService.assertAccess`) — по-настоящему другой
 * пользователь получит 404 «Доска не найдена». Поэтому, как и в
 * `boards-realtime-sync.spec.ts`, для проверки синка между независимыми
 * вкладками используем одного и того же владельца в контекстах A/B. Но для
 * presence-счётчика (>1 УНИКАЛЬНЫЙ участник) нужен второй, реальный
 * пользователь — заводим его тем же путём, что `team-roles-invite.spec.ts`:
 * команда + вступление по инвайт-ссылке, доска создаётся уже внутри команды.
 *
 * Проверяем:
 *  1. При входе второго уникального участника (команды) панель «кто на
 *     доске» появляется с двумя аватарами/именами (presence broadcast по
 *     board:presence).
 *  2. Движение мыши в A рассылает курсор (board:awareness) — чужой курсор
 *     появляется в B на соответствующей позиции.
 *
 * Курсоры работают в world-координатах (как в Miro): позиция проецируется
 * через project(), поэтому для проверки удобно сравнивать координаты
 * canvas-слоя, а не viewport-пиксели. В headless Chromium зум/панорама
 * фиксированы fit-view-on-init, так что world ≈ viewport в начале теста.
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
  await pageA.goto('/teams');

  await pageA.getByRole('button', { name: 'Создать команду' }).click();
  const teamName = `${E2E_ROOM_PREFIX}Team ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Команда фронтенда').fill(teamName);
  await pageA.locator('form').getByRole('button', { name: 'Создать', exact: true }).click();
  await pageA.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  const inviteUrl = await pageA.locator('input[readonly]').inputValue();

  await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}Cursors ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardA = boardLocators(pageA);
  const boardUrl = pageA.url();
  await expect(boardA.pane).toBeVisible();

  // --- Владелец открывает ту же доску во второй независимой вкладке ---
  const contextB = await newContext(browser);
  await loginAs(contextB, owner);
  const pageB = await contextB.newPage();
  await pageB.goto(boardUrl);
  await expect(boardLocators(pageB).pane).toBeVisible();

  // Панель presence: один пользователь в двух вкладках — presence
  // deduplication по userId (см. BoardPresence.list) даст одну запись,
  // панель появляется только когда уникальных участников больше одного.
  // Второй уникальный участник — приглашённый в команду коллега:
  const second = await createUser('cursors-second');
  const contextC = await newContext(browser);
  await loginAs(contextC, second);
  const pageC = await contextC.newPage();
  const boardC = boardLocators(pageC);
  await pageC.goto(new URL(inviteUrl).pathname);
  await pageC.getByRole('button', { name: 'Вступить' }).click();
  await pageC.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  await pageC.goto(boardUrl);
  await expect(boardC.pane).toBeVisible();

  // Панель «кто на доске» появляется, когда >1 уникального участника
  await expect(boardA.presence).toBeVisible();
  await expect(boardA.presenceAvatars).toHaveCount(2);
  // Себя выделяем
  await expect(boardA.selfAvatar).toHaveCount(1);

  // Awareness тоже держит одну запись на userId (см. `awarenessByUser` в
  // board-session.ts) — курсор из A не виден в B, это тот же пользователь,
  // что и сам B (`entry.userId !== selfUserId` в BoardCursor.vue отфильтрует
  // его как собственный). Проверяем чужой курсор на genuinely другом
  // пользователе — A и C.

  // 1. Движение мыши в A — чужой курсор появляется у C
  await pageA.mouse.move(400, 300);

  // `[data-testid="board-cursor"]` сам по себе схлопывается в 0×0 (оба потомка — position:
  // absolute, растягивать родителя нечему), рисуется он всё равно нормально
  // (потомки красятся по своим смещениям независимо от размера родителя), но
  // строгая проверка видимости Playwright по самому враптера с нулевой
  // площадью не проходит — проверяем по `[data-testid="board-cursor-name"]` (реальный бокс
  // с паддингом), заодно уже сверяем и текст.
  await expect(boardC.cursorName).toHaveText(owner.name);

  // 2. Движение мыши в C — курсор появляется в A
  await pageC.mouse.move(600, 400);
  await expect(boardA.cursorName).toHaveText(second.name);

  // 3. Курсор не должен замирать во время драга элемента: `onNodeDrag` шлёт
  // awareness наравне с обычным mousemove по пейну (баг найден при ручной
  // проверке — драг перехватывает указатель, и обычный mousemove-хендлер
  // на пейне для этих кадров не отрабатывает).
  await boardA.pane.dblclick({ position: { x: 300, y: 300 } });
  await expect(boardA.stickyNodes).toHaveCount(1);
  const stickyId = await boardA.stickyNodes.getAttribute('data-node-id');
  const textareaA = pageA.locator(`[data-node-id="${stickyId}"] [contenteditable="true"]`);
  await textareaA.click();
  await textareaA.fill('Драг-тест курсора');
  await boardA.pane.click({ position: { x: 950, y: 450 } });

  const nodeA = pageA.locator(`[data-node-id="${stickyId}"]`);
  const box = await nodeA.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  await pageA.mouse.move(startX, startY);
  await pageA.mouse.down();
  await pageA.mouse.move(startX + 40, startY + 40, { steps: 5 });
  await expect(boardC.cursorName).toHaveText(owner.name);
  const styleDuringDrag = await boardC.cursor.getAttribute('style');

  // Ещё один рывок мышью, пока кнопка всё ещё зажата — позиция курсора у C
  // обязана сдвинуться вместе с ним, а не остаться там же, где была
  await pageA.mouse.move(startX + 140, startY + 140, { steps: 5 });
  await expect.poll(() => boardC.cursor.getAttribute('style')).not.toBe(styleDuringDrag);

  await pageA.mouse.up();
});
