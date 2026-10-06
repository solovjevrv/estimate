import { randomUUID } from 'node:crypto';

import type { Page } from '@playwright/test';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { waitForStableBox } from '../src/stable-box';

/**
 * Голосование точками (15.2) сквозь настоящие WS-соединения: две вкладки
 * одного владельца на личной доске (как `boards-realtime-sync.spec.ts`).
 * A запускает голосование по всей доске, клик по стикеру ставит точку, клик
 * по своему бейджу снимает её; B видит голосование у себя; A завершает —
 * у обоих итоги с числом голосов, «Скрыть результаты» убирает их.
 */
/**
 * Два стикера, как в `boards-realtime-sync.spec.ts`: второй — со смещением от
 * реальной позиции первого (автофит после первого стикера перецентровывает
 * холст, абсолютные координаты ничего не гарантируют).
 */
async function addTwoStickies(page: Page): Promise<void> {
  const board = boardLocators(page);
  await board.pane.dblclick({ position: { x: 300, y: 300 } });
  await expect(board.stickyNodes).toHaveCount(1);
  await board.pane.click({ position: { x: 950, y: 450 } });
  const firstBox = await waitForStableBox(board.stickyNodes.first());
  await page.mouse.dblclick(firstBox.x + 400, firstBox.y + firstBox.height / 2);
  await expect(board.stickyNodes).toHaveCount(2);
  await board.pane.click({ position: { x: 950, y: 450 } });
  await page.keyboard.press('Escape');
}

test('голосование точками: старт, точки, снятие, завершение, итоги и скрытие', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('board-voting');
  const contextA = await newContext(browser);
  await loginAs(contextA, owner);
  const pageA = await contextA.newPage();
  await pageA.setViewportSize({ width: 1280, height: 760 });
  await pageA.goto('/boards');
  await pageA.getByRole('button', { name: 'Новая доска', exact: true }).click();
  await pageA
    .getByPlaceholder('Например, Ретро спринта 24')
    .fill(`${E2E_ROOM_PREFIX}Voting ${randomUUID().slice(0, 8)}`);
  await pageA.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await pageA.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const boardUrl = pageA.url();
  const boardA = boardLocators(pageA);
  await expect(boardA.pane).toBeVisible();

  await addTwoStickies(pageA);

  const contextB = await newContext(browser);
  await loginAs(contextB, owner);
  const pageB = await contextB.newPage();
  await pageB.goto(boardUrl);
  // Холст рисует только видимые узлы, а камера у B своя — проверки на B
  // строим по панелям голосования, не по числу узлов
  await expect(boardLocators(pageB).pane).toBeVisible();

  // A: настройка — 2 голоса, до 2 на стикер, с таймером доски
  await pageA.getByTestId('board-voting-button').click();
  await expect(pageA.getByTestId('board-voting-setup')).toBeVisible();
  // data-testid у UInputNumber может оказаться и на обёртке, и на самом input
  const votesInput = pageA.locator(
    'input[data-testid="board-voting-votes"], [data-testid="board-voting-votes"] input',
  );
  // По умолчанию: 3 точки на человека, на один элемент — без ограничения
  await expect(votesInput).toHaveValue('3');
  await expect(pageA.getByTestId('board-voting-per-item-unlimited')).toHaveAttribute(
    'data-state',
    'checked',
  );
  await votesInput.fill('2');
  await pageA.getByTestId('board-voting-start').click();

  await expect(pageA.getByTestId('board-voting-bar')).toContainText('Осталось 2 из 2');
  await expect(pageB.getByTestId('board-voting-bar')).toBeVisible();
  // Галочка «Запустить таймер доски» включена по умолчанию — таймер идёт у всех
  await expect(pageB.getByTestId('board-timer')).toHaveAttribute('data-phase', 'running');

  // Клик по стикеру — точка, а не выделение
  const first = boardA.stickyNodes.first();
  await first.click();
  await expect(first.getByTestId('board-vote-mine-count')).toHaveText('1');
  await expect(first).toHaveAttribute('data-selected', 'false');
  await first.click();
  await expect(first.getByTestId('board-vote-mine-count')).toHaveText('2');
  await expect(pageA.getByTestId('board-voting-bar')).toContainText('Осталось 0 из 2');

  // Клик по своему бейджу снимает одну точку
  await first.getByTestId('board-vote-badge-mine').click();
  await expect(first.getByTestId('board-vote-mine-count')).toHaveText('1');
  await boardA.stickyNodes.nth(1).click();
  await expect(pageA.getByTestId('board-voting-remaining')).toHaveText('0 из 2');

  // Завершение (все на доске потратили точки — без подтверждения): итоги у обеих
  // вкладок, таймер голосования сброшен
  await pageA.getByTestId('board-voting-finish').click();
  await expect(pageA.getByTestId('board-voting-results')).toContainText('Голосование 1');
  await expect(pageA.getByTestId('board-voting-result-row')).toHaveCount(2);
  await expect(pageB.getByTestId('board-voting-results')).toBeVisible();
  await expect(pageB.getByTestId('board-voting-button')).toHaveAttribute('data-phase', 'history');
  await expect(first.getByTestId('board-vote-badge-total')).toContainText('1');
  await expect(pageA.getByTestId('board-voting-bar')).toHaveCount(0);
  await expect(pageA.getByTestId('board-timer')).toHaveAttribute('data-phase', 'idle');

  // После завершения выделение снова работает
  await first.click();
  await expect(first).toHaveAttribute('data-selected', 'true');

  // Крестик закрывает итоги только у себя: у A бейджи пропали, у B панель на месте
  await pageA
    .getByTestId('board-voting-results')
    .getByRole('button', { name: 'Свернуть итоги' })
    .click();
  await expect(pageA.getByTestId('board-vote-badge-total')).toHaveCount(0);
  await expect(pageB.getByTestId('board-voting-results')).toBeVisible();

  // История: меню кнопки — прошлое голосование открывает его итоги снова
  await pageA.getByTestId('board-voting-button').click();
  await expect(pageA.getByTestId('board-voting-history-item')).toHaveCount(1);
  await pageA.getByTestId('board-voting-history-item').click();
  await expect(pageA.getByTestId('board-voting-results')).toContainText('Голосование 1');

  // «Выстроить по голосам» (15.4) — стикеры встают сеткой, тост с «Отменить»
  await pageA.getByTestId('board-voting-arrange').click();
  await expect(
    pageA.locator('[data-slot="title"]', { hasText: 'Выстроено по голосам' }),
  ).toBeVisible();

  // «Новое голосование» из итогов — настройка в кнопке верхнего ряда
  await pageA.getByTestId('board-voting-new-from-results').click();
  await expect(pageA.getByTestId('board-voting-setup')).toBeVisible();
  await pageA.keyboard.press('Escape');

  // Удаление голосования из итогов (панель осталась открытой) — с подтверждением,
  // у всех пропадает
  await expect(pageA.getByTestId('board-voting-results')).toContainText('Голосование 1');
  await pageA.getByTestId('board-voting-delete').click();
  await pageA.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(pageA.getByTestId('board-voting-results')).toHaveCount(0);
  await expect(pageA.getByTestId('board-voting-button')).toHaveAttribute('data-phase', 'idle');
  await expect(pageB.getByTestId('board-voting-button')).toHaveAttribute('data-phase', 'idle');
});

test('«Выделенные элементы»: выделить можно при открытой настройке, без выделения старт недоступен', async ({
  browser,
  createUser,
  loginAs,
  newContext,
}) => {
  test.slow();

  const owner = await createUser('board-voting-scope');
  const context = await newContext(browser);
  await loginAs(context, owner);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto('/boards');
  await page.getByRole('button', { name: 'Новая доска', exact: true }).click();
  await page
    .getByPlaceholder('Например, Ретро спринта 24')
    .fill(`${E2E_ROOM_PREFIX}Voting scope ${randomUUID().slice(0, 8)}`);
  await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const board = boardLocators(page);
  await expect(board.pane).toBeVisible();
  await addTwoStickies(page);

  // Клик по холсту настройку не закрывает, а Escape — закрывает
  await page.getByTestId('board-voting-button').click();
  const setup = page.getByTestId('board-voting-setup');
  await expect(setup).toBeVisible();
  await setup.getByTestId('board-voting-start').focus();
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);

  // Ничего не выделено — открываем настройку и выбираем «Выделенные элементы»
  await page.getByTestId('board-voting-button').click();
  await expect(setup).toBeVisible();
  await setup.getByTestId('board-voting-scope').click();
  await page.getByRole('option', { name: 'Выделенные элементы' }).click();
  await expect(setup).toContainText('Выделите элементы на доске');
  await expect(setup.getByTestId('board-voting-start')).toBeDisabled();

  // Клик по стикеру на холсте выделяет его — настройка остаётся открытой
  const first = board.stickyNodes.first();
  await first.click();
  await expect(setup).toBeVisible();
  await expect(setup.getByTestId('board-voting-scope')).toContainText('Выделенные: 1');
  await expect(setup.getByTestId('board-voting-start')).toBeEnabled();

  await setup.getByTestId('board-voting-start').click();
  await expect(page.getByTestId('board-voting-bar')).toBeVisible();
  // Второй стикер вне голосования — приглушён
  const muted = page.locator('.vue-flow__node.board-node-voting-muted');
  await expect(muted).toHaveCount(1);

  // После завершения приглушение снимается (Vue Flow сливает узлы — класс
  // голосования оставался до перезагрузки страницы)
  await page.getByTestId('board-voting-finish').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Завершить' }).click();
  await expect(page.getByTestId('board-voting-results')).toBeVisible();
  await expect(muted).toHaveCount(0);
  await expect(page.locator('.vue-flow__node.board-node-voting-target')).toHaveCount(0);
});
