import { boardLocators } from '../src/board-locators';
import { createTeamBoard, createTeamWithInvite } from '../src/team-helpers';
import { expect, test } from '../src/fixtures';

/**
 * E2E на мягкую блокировку текстового редактирования (14.2).
 *
 * Сценарий:
 *  1. Владелец (A) дважды кликает по стикеру → входит в режим редактирования.
 *  2. Второй участник (C, приглашённый в команду) видит бейдж «Имя печатает…».
 *  3. C дважды кликает по тому же стикеру — клик не входит в редактирование
 *     (contenteditable не появляется), а показывается тост блокировки.
 *  4. A снимает выделение (клик по пустому месту холста) → commitEditing →
 *     блокировка снимается, бейдж исчезает.
 *  5. C теперь может редактировать тот же стикер.
 */
test('мягкая блокировка текстового редактирования (14.2)', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('text-lock-owner');
  const contextA = await newContext(browser);
  await loginAs(contextA, owner);
  const pageA = await contextA.newPage();
  const { inviteUrl } = await createTeamWithInvite(pageA);

  // Доска внутри команды
  await createTeamBoard(pageA, 'TextLock');
  const boardA = boardLocators(pageA);
  await expect(boardA.joined).toBeVisible();
  const boardUrl = pageA.url();

  // Второй уникальный участник — приглашённый в команду
  const second = await createUser('text-lock-second');
  const contextC = await newContext(browser);
  await loginAs(contextC, second);
  const pageC = await contextC.newPage();
  await pageC.goto(new URL(inviteUrl).pathname);
  await pageC.getByRole('button', { name: 'Вступить' }).click();
  await pageC.waitForURL(/\/teams\/[0-9a-f-]{36}/);
  await pageC.goto(boardUrl);
  const boardC = boardLocators(pageC);
  await expect(boardC.pane).toBeVisible();
  // C должен быть в комнате доски до того, как A начнёт редактировать: блокировка
  // рассылается один раз, при входе в редактирование
  await expect(boardC.joined).toBeVisible();

  // --- Создаём стикер на доске через A ---
  await boardA.pane.dblclick({ position: { x: 300, y: 300 } });
  await expect(boardA.stickyNodes).toHaveCount(1);
  const stickyId = await boardA.stickyNodes.getAttribute('data-node-id');
  expect(stickyId).not.toBeNull();

  // Ждём репликацию стикера на страницу C
  await expect(boardC.stickyNodes).toHaveCount(1);

  const nodeA = `[data-node-id="${stickyId}"]`;
  const nodeC = `[data-node-id="${stickyId}"]`;
  const badgeSelector = `${nodeA} [data-testid="board-editing-badge"]`;
  const badgeSelectorC = `${nodeC} [data-testid="board-editing-badge"]`;
  const contentBoxA = `${nodeA} [data-testid="board-sticky-content"]`;
  const contentBoxC = `${nodeC} [data-testid="board-sticky-content"]`;
  const contenteditableA = `[data-node-id="${stickyId}"] [contenteditable="true"]`;

  // --- 1. A входит в редактирование ---
  await pageA.locator(contentBoxA).dblclick();
  await expect(pageA.locator(contenteditableA)).toBeVisible();
  await pageA.locator(contenteditableA).fill('Текст от A');

  // --- 2. Бейдж появляется у C ---
  await expect(pageC.locator(badgeSelectorC)).toBeVisible();
  await expect(pageC.locator(badgeSelectorC)).toHaveText(`${owner.name} печатает…`);
  // У A бейджа нет — своя блокировка скрыта
  await expect(pageA.locator(badgeSelector)).toBeHidden();

  // --- 3. C пытается отредактировать тот же элемент ---
  await pageC.locator(contentBoxC).dblclick();
  // Toast с сообщением о блокировке (Nuxt UI рендерит [data-slot="title"])
  await expect(pageC.locator('[data-slot="title"]')).toHaveText(
    `${owner.name} сейчас редактирует этот элемент`,
  );
  // contenteditable НЕ появляется — редактирование заблокировано
  await expect(pageC.locator(`${nodeC} [contenteditable="true"]`)).toBeHidden();
  // Текст A не изменился — C не смог ввести ничего
  await expect(pageA.locator(contenteditableA)).toHaveText('Текст от A');

  // --- 4. A снимает выделение → блокировка снимается ---
  // Пустое место холста — ниже правого верхнего ряда (таймер, голосование, участники)
  await pageA.locator('[data-testid="board-pane"]').click({ position: { x: 950, y: 450 } });
  await expect(pageC.locator(badgeSelectorC)).toBeHidden();

  // --- 5. C теперь может редактировать ---
  await pageC.locator(contentBoxC).dblclick();
  await expect(pageC.locator(`${nodeC} [contenteditable="true"]`)).toBeVisible();
  await pageC.locator(`${nodeC} [contenteditable="true"]`).fill('Текст от C');
  await expect(pageC.locator(`${nodeC} [contenteditable="true"]`)).toHaveText('Текст от C');

  // Бейдж появляется у A (C теперь редактирует)
  await expect(pageA.locator(badgeSelector)).toBeVisible();
  await expect(pageA.locator(badgeSelector)).toHaveText(`${second.name} печатает…`);
});
