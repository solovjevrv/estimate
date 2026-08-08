import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессионный набор досок (12.11): два независимых браузерных контекста одного
 * и того же пользователя (сервер не ограничивает параллельные сессии на доске —
 * см. `BoardPresence`) на одной и той же личной доске. Проверяем весь основной
 * цикл op-протокола (12.4-12.10) сквозь настоящие WS-соединения: создание стикера
 * долетает до второго участника, перенос, соединение стрелкой, каскадное удаление.
 *
 * `.vue-flow__pane` перед первым действием — без видимого индикатора "WS
 * подключен" (его в UI нет, presence/awareness пока не рендерятся) это
 * единственный практичный сигнал, что `BoardCanvas` смонтирован, а вместе с ним —
 * что `boardSession.join()` уже вызван (см. `BoardPage.vue`: `board.value`
 * выставляется и канвас монтируется в том же синхронном участке кода, что и
 * `void boardSession.join(id)`, до следующего тика реактивности Vue).
 *
 * Вырожденный случай `fit-view-on-init` на пустой доске (200%, стикеры по
 * 360×360px, см. память по Vue Flow) не сбросить программно — Ctrl+0 в
 * headless Chromium перехватывается самим браузером как его собственный
 * акселератор "сбросить зум страницы" и до кода приложения не доходит.
 * Работаем прямо на 200%: координаты подобраны так, чтобы обе карточки и все
 * действия с ними укладывались в безопасную зону вьюпорта 1280×720 (x:
 * 110-1080, y: 190-580), не задевая тулбар/миникарту/панель управления зумом,
 * а перенос проверяется не сравнением пикселей между A и B (независимый
 * viewport/pan каждого клиента может разойтись даже при идентичных данных —
 * см. `boards-reconnect.spec.ts`), а изменением координат в рамках одной
 * и той же страницы B.
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
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardUrl = pageA.url();
  await expect(pageA.locator('.vue-flow__pane')).toBeVisible();

  const contextB = await newContext(browser);
  await loginAs(contextB, owner);
  const pageB = await contextB.newPage();
  await pageB.goto(boardUrl);
  await expect(pageB.locator('.vue-flow__pane')).toBeVisible();

  // --- Создание стикера видно у второго участника ---
  await pageA.locator('.vue-flow__pane').dblclick({ position: { x: 300, y: 300 } });
  await expect(pageA.locator('.vue-flow__node-sticky')).toHaveCount(1);
  const stickyId = await pageA.locator('.vue-flow__node-sticky').getAttribute('data-id');

  // Гоча Vue Flow #7: headless Chromium не всегда честно фокусирует
  // contenteditable через программный .focus() при автовходе в
  // редактирование — кликаем сами. С 12.13 текст — не textarea, а
  // contenteditable-div (форматирование по выделению).
  const textareaA = pageA.locator(
    `.vue-flow__node[data-id="${stickyId}"] [contenteditable="true"]`,
  );
  await textareaA.click();
  await textareaA.fill('Первый стикер');
  await pageA.locator('.vue-flow__pane').click({ position: { x: 950, y: 450 } });

  const nodeBLocator = pageB.locator(`.vue-flow__node[data-id="${stickyId}"]`);
  await expect(nodeBLocator).toBeVisible();
  await expect(nodeBLocator).toContainText('Первый стикер');

  // --- Перенос синхронизируется ---
  const initialBoxB = await nodeBLocator.boundingBox();
  expect(initialBoxB).not.toBeNull();

  const nodeALocator = pageA.locator(`.vue-flow__node[data-id="${stickyId}"]`);
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
  await pageA.locator('.vue-flow__pane').dblclick({ position: { x: 750, y: 300 } });
  await expect(pageA.locator('.vue-flow__node-sticky')).toHaveCount(2);
  const secondId = await pageA
    .locator(`.vue-flow__node-sticky:not([data-id="${stickyId}"])`)
    .getAttribute('data-id');
  const textareaA2 = pageA.locator(
    `.vue-flow__node[data-id="${secondId}"] [contenteditable="true"]`,
  );
  await textareaA2.click();
  await pageA.locator('.vue-flow__pane').click({ position: { x: 950, y: 450 } });

  const sourceHandle = pageA.locator(
    `.vue-flow__handle[data-nodeid="${stickyId}"][data-handleid="right"]`,
  );
  const targetHandle = pageA.locator(
    `.vue-flow__handle[data-nodeid="${secondId}"][data-handleid="left"]`,
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

  await expect(pageA.locator('.vue-flow__edge')).toHaveCount(1);
  await expect(pageB.locator('.vue-flow__edge')).toHaveCount(1);

  // --- Удаление карточки каскадно убирает и связь у второго участника ---
  await pageA.locator(`.vue-flow__node[data-id="${stickyId}"]`).click();
  await pageA.keyboard.press('Delete');

  await expect(pageB.locator(`.vue-flow__node[data-id="${stickyId}"]`)).toHaveCount(0);
  await expect(pageB.locator('.vue-flow__edge')).toHaveCount(0);
  await expect(pageB.locator('.vue-flow__node-sticky')).toHaveCount(1);
});
