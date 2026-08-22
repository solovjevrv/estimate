import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { waitForStableBox } from '../src/stable-box';

/**
 * Регрессионный набор досок (12.11): два независимых браузерных контекста одного
 * и того же пользователя (сервер не ограничивает параллельные сессии на доске —
 * см. `BoardPresence`) на одной и той же личной доске. Проверяем весь основной
 * цикл op-протокола (12.4-12.10) сквозь настоящие WS-соединения: создание стикера
 * долетает до второго участника, перенос, соединение стрелкой, каскадное удаление.
 *
 * `[data-testid="board-pane"]` перед первым действием — без видимого индикатора "WS
 * подключен" (его в UI нет, presence/awareness пока не рендерятся) это
 * единственный практичный сигнал, что `BoardCanvas` смонтирован, а вместе с ним —
 * что `boardSession.join()` уже вызван (см. `BoardPage.vue`: `board.value`
 * выставляется и канвас монтируется в том же синхронном участке кода, что и
 * `void boardSession.join(id)`, до следующего тика реактивности Vue).
 *
 * Автофит на пустой доске (одноразовый, по первому появившемуся узлу) больше
 * не уводит зум выше 100% (17.12), но по-прежнему один раз перецентровывает
 * pan — жёсткая страничная координата ПОСЛЕ первого стикера ничего не
 * гарантирует. Позиция второго стикера поэтому считается смещением от
 * РЕАЛЬНОЙ (уже перецентрованной) boundingBox первого, а не константой.
 * Ctrl+0 здесь намеренно не используется: в headless Chromium с двумя
 * открытыми контекстами (`newContext` дважды) он перехватывается самим
 * браузером как акселератор "сбросить зум страницы" и до кода приложения не
 * доходит (проверено; в одноконтекстных тестах работает штатно). Перенос
 * проверяется не сравнением пикселей между A и B (независимый viewport/pan
 * каждого клиента может разойтись даже при идентичных данных — см.
 * `boards-reconnect.spec.ts`), а изменением координат в рамках одной и той
 * же страницы B.
 */
test('два браузера на одной доске: создание, перенос, связь, удаление синхронизируются в реальном времени', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('board-sync');
  const contextA = await newContext(browser);
  await loginAs(contextA, owner);
  const pageA = await contextA.newPage();
  await pageA.goto('/boards');

  await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}Sync ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  const boardA = boardLocators(pageA);

  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardUrl = pageA.url();
  await expect(boardA.pane).toBeVisible();

  const contextB = await newContext(browser);
  await loginAs(contextB, owner);
  const pageB = await contextB.newPage();
  await pageB.goto(boardUrl);
  const boardB = boardLocators(pageB);
  await expect(boardB.pane).toBeVisible();

  // --- Создание стикера видно у второго участника ---
  await boardA.pane.dblclick({ position: { x: 300, y: 300 } });
  await expect(boardA.stickyNodes).toHaveCount(1);
  const stickyId = await boardA.stickyNodes.getAttribute('data-node-id');

  // Гоча Vue Flow #7: headless Chromium не всегда честно фокусирует
  // contenteditable через программный .focus() при автовходе в
  // редактирование — кликаем сами. С 12.13 текст — не textarea, а
  // contenteditable-div (форматирование по выделению).
  const textareaA = pageA.locator(`[data-node-id="${stickyId}"] [contenteditable="true"]`);
  await textareaA.click();
  await textareaA.fill('Первый стикер');
  await boardA.pane.click({ position: { x: 950, y: 450 } });

  const nodeBLocator = pageB.locator(`[data-node-id="${stickyId}"]`);
  await expect(nodeBLocator).toBeVisible();
  await expect(nodeBLocator).toContainText('Первый стикер');

  // --- Перенос синхронизируется ---
  const initialBoxB = await nodeBLocator.boundingBox();
  expect(initialBoxB).not.toBeNull();

  const nodeALocator = pageA.locator(`[data-node-id="${stickyId}"]`);
  const boxA = await nodeALocator.boundingBox();
  expect(boxA).not.toBeNull();
  const startX = boxA!.x + boxA!.width / 2;
  const startY = boxA!.y + boxA!.height / 2;
  await pageA.mouse.move(startX, startY);
  await pageA.mouse.down();
  await pageA.mouse.move(startX + 30, startY + 100, { steps: 5 });
  await pageA.mouse.move(startX + 60, startY + 200, { steps: 10 });
  await pageA.mouse.up();

  await expect
    .poll(async () => {
      const box = await nodeBLocator.boundingBox();
      return box ? Math.round(box.y) : null;
    })
    .not.toBe(Math.round(initialBoxB!.y));

  // Перенесённая карточка остаётся выделенной — над ней всплывает
  // `BoardSelectionToolbar`, перекрывающий клики по холсту рядом с ней
  await pageA.keyboard.press('Escape');

  // --- Второй стикер + соединение стрелкой ---
  // Позиция — не абсолютная константа, а смещение от РЕАЛЬНОЙ (уже
  // перецентрованной автофитом первого стикера, 17.12) boundingBox первого:
  // после автофита на пустой доске и переноса первого стикера жёсткая
  // страничная координата больше ничего не гарантирует.
  const sticky1BoxForSecond = await waitForStableBox(nodeALocator);
  await pageA.mouse.dblclick(sticky1BoxForSecond.x + 400, sticky1BoxForSecond.y);
  await expect(boardA.stickyNodes).toHaveCount(2);
  const secondId = await boardA.stickyNodes
    .locator(`:scope:not([data-node-id="${stickyId}"])`)
    .getAttribute('data-node-id');
  const textareaA2 = pageA.locator(`[data-node-id="${secondId}"] [contenteditable="true"]`);
  await textareaA2.click();
  await boardA.pane.click({ position: { x: 950, y: 450 } });

  const sourceHandle = pageA.locator(
    `[data-testid="board-handle"][data-nodeid="${stickyId}"][data-handleid="right"]`,
  );
  const targetHandle = pageA.locator(
    `[data-testid="board-handle"][data-nodeid="${secondId}"][data-handleid="left"]`,
  );
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHandle.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await pageA.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
    {
      steps: 10,
    },
  );
  await pageA.mouse.up();

  await expect(boardA.edges).toHaveCount(1);
  await expect(boardB.edges).toHaveCount(1);

  // --- Удаление карточки каскадно убирает и связь у второго участника ---
  await pageA.locator(`[data-node-id="${stickyId}"]`).click();
  await pageA.keyboard.press('Delete');

  await expect(pageB.locator(`[data-node-id="${stickyId}"]`)).toHaveCount(0);
  await expect(boardB.edges).toHaveCount(0);
  await expect(boardB.stickyNodes).toHaveCount(1);
});
