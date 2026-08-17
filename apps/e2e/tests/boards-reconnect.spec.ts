import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Регрессия реконнекта/догона (12.11), отдельно от основного sync-сценария —
 * специфичный кейс, а не часть обычного цикла CRUD. У доски нет видимого
 * индикатора "WS подключен/отключен" (presence/awareness пока не рендерятся в
 * UI), так что тест — чёрный ящик: рвём сеть у одного контекста через
 * `context.setOffline`, вносим изменения с другого, возвращаем сеть и проверяем
 * итоговое состояние с щедрым таймаутом на реконнект (socket.io переподключается
 * с задержкой ~1с по умолчанию) — вместо того, чтобы наблюдать сам факт разрыва.
 * Итоговое совпадение с ревизией сервера (без дублей и потерь) подтверждает, что
 * сработал именно догон по `sinceRevision` (`board-session.ts`: `performJoin`),
 * а не потерянные события молча остались забытыми.
 *
 * Перенос карточки проверяется сравнением экрана B до/после обрыва — НЕ B
 * против A: viewport/pan каждого клиента независим (никогда не синхронизуется,
 * только данные элементов), а перетаскивание на A может запустить у самого A
 * авто-панорамирование камеры — тогда голые пиксельные координаты между A и B
 * разойдутся, даже если модельные x/y обеих карточек совпадают идеально
 * (проверено эмпирически: только что созданная, никогда не перетаскиваемая
 * карточка совпадает у A/B пиксель-в-пиксель, а перетащенная — нет).
 */
test('после обрыва сети участник догоняет пропущенные изменения по revision', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('board-reconnect');
  const contextA = await newContext(browser);
  await loginAs(contextA, owner);
  const pageA = await contextA.newPage();
  await pageA.goto('/boards');

  await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
  const boardName = `${E2E_ROOM_PREFIX}Reconnect ${randomUUID().slice(0, 8)}`;
  await pageA.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardA = boardLocators(pageA);
  const boardUrl = pageA.url();
  await expect(boardA.pane).toBeVisible();

  const contextB = await newContext(browser);
  await loginAs(contextB, owner);
  const pageB = await contextB.newPage();
  await pageB.goto(boardUrl);
  const boardB = boardLocators(pageB);
  await expect(boardB.pane).toBeVisible();

  // Стикер до обрыва — доказывает, что realtime вообще работает, до перехода к офлайну
  await boardA.pane.dblclick({ position: { x: 150, y: 150 } });
  await expect(boardA.stickyNodes).toHaveCount(1);
  const beforeId = await boardA.stickyNodes.getAttribute('data-node-id');
  const textareaBefore = pageA.locator(`[data-node-id="${beforeId}"] [contenteditable="true"]`);
  await textareaBefore.click();
  await textareaBefore.fill('До обрыва');
  await boardA.pane.click({ position: { x: 550, y: 600 } });

  const nodeBLocator = pageB.locator(`[data-node-id="${beforeId}"]`);
  await expect(nodeBLocator).toContainText('До обрыва');
  const initialBoxB = await nodeBLocator.boundingBox();
  expect(initialBoxB).not.toBeNull();

  // --- Контекст B уходит в офлайн ---
  await contextB.setOffline(true);

  // Пока B офлайн: A двигает существующую карточку и создаёт новую
  const nodeA = pageA.locator(`[data-node-id="${beforeId}"]`);
  const boxBefore = await nodeA.boundingBox();
  expect(boxBefore).not.toBeNull();
  await pageA.mouse.move(boxBefore!.x + boxBefore!.width / 2, boxBefore!.y + boxBefore!.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(boxBefore!.x + 260, boxBefore!.y + 260, { steps: 10 });
  await pageA.waitForTimeout(150);
  await pageA.mouse.up();
  // Даём время гарантированному финальному патчу drag-stop уйти и подтвердиться
  // сервером до следующего действия — иначе в буфер догона мог бы попасть только
  // промежуточный троттленный патч драга, а не финальный
  await pageA.waitForTimeout(300);

  await boardA.pane.dblclick({ position: { x: 950, y: 150 } });
  await expect(boardA.stickyNodes).toHaveCount(2);
  const afterId = await boardA.stickyNodes
    .locator(`:scope:not([data-node-id="${beforeId}"])`)
    .getAttribute('data-node-id');
  const textareaAfter = pageA.locator(`[data-node-id="${afterId}"] [contenteditable="true"]`);
  await textareaAfter.click();
  await textareaAfter.fill('После обрыва');
  await boardA.pane.click({ position: { x: 550, y: 600 } });

  // Ни одно из офлайн-изменений пока не долетело до B
  await expect(boardB.stickyNodes).toHaveCount(1);

  // --- Сеть у B восстанавливается — ждём переподключения и догона ---
  await contextB.setOffline(false);

  await expect(pageB.locator(`[data-node-id="${afterId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(pageB.locator(`[data-node-id="${afterId}"]`)).toContainText('После обрыва');
  // Ни дублей, ни потерь — ровно те же две карточки, что и у A
  await expect(boardB.stickyNodes).toHaveCount(2);

  await expect
    .poll(async () => {
      const box = await nodeBLocator.boundingBox();
      return box ? Math.round(box.x) : null;
    })
    .not.toBe(Math.round(initialBoxB!.x));
});
