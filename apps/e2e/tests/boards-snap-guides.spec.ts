import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Snap-направляющие при перетаскивании (13.6).
 *
 * Проверяем:
 * 1. Snap-гиды появляются во время перетаскивания, когда элемент приближается
 *    к другому в пределах SNAP_THRESHOLD_PX (8px при зуме 1).
 * 2. Гиды исчезают при отпускании мыши.
 * 3. При отпускании snap-позиция применяется — элемент притягивается к
 *    выравниванию с другим элементом.
 *
 * Стикеры — 180×180px. Snap работает только same-type (left↔left, center↔center,
 * right↔right), а не cross-type (left↔right). Для одинаковых элементов snap по
 * левому краю и по центру дают одинаковый результат — при равных расстояниях
 * выбирается первая точка в массиве (left/top).
 */
test.describe('Доски: snap-направляющие при перетаскивании', () => {
  test('snap-гиды появляются и применяются при приближении элемента к другому', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-snap');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();
    const board = boardLocators(page);

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await page
      .getByPlaceholder('Например, Ретро спринта 24')
      .fill(`${E2E_ROOM_PREFIX}Snap ${randomUUID().slice(0, 8)}`);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();
    await expect(board.joined).toBeVisible();
    await board.pane.click();
    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    // Создаём карточки разнесённо: fit-view после первого создания меняет
    // экранные координаты, поэтому близкая вторая точка может попасть в первую.
    // Дальше snap всё равно рассчитывается от реальных DOM rect'ов. Идентифицируем
    // по data-node-id (не по наличию contenteditable — оба редактора закрываются
    // ниже, различать узлы по editing-состоянию после этого уже нельзя).
    await board.pane.dblclick({ position: { x: 300, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(1);
    const leftStickyId = await board.stickyNodes.getAttribute('data-node-id');
    await page.keyboard.press('Escape');

    await board.pane.dblclick({ position: { x: 1000, y: 600 } });
    await expect(board.stickyNodes).toHaveCount(2);
    // Новый элемент завершает предыдущий редактор (activeTextEditor.commit() в
    // startEditing) — свой же auto-opened редактор закрываем явно, как и у первого.
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    const leftSticky = page.locator(`[data-node-id="${leftStickyId}"]`);
    const rightSticky = board.stickyNodes.locator(`:scope:not([data-node-id="${leftStickyId}"])`);

    // Vue Flow передаёт в drag-событие всё текущее выделение. Оставляем
    // выбранным только переносимый узел, иначе оба стикера считаются dragged
    // и для snap не остаётся статичного ориентира.
    await rightSticky.click();
    await expect(rightSticky).toHaveAttribute('data-selected', 'true');
    await expect(leftSticky).toHaveAttribute('data-selected', 'false');

    const leftBox = await leftSticky.boundingBox();
    expect(leftBox).not.toBeNull();

    // Выбираем правый стикер и перетаскиваем его влево к левому.
    // SNAP_THRESHOLD_PX = 8px. Перетаскиваем так, чтобы в какой-то момент
    // правый стикер оказался в пределах 8px от левого по какой-то оси.
    const rightBox = await rightSticky.boundingBox();
    expect(rightBox).not.toBeNull();

    const dragStartX = rightBox!.x + rightBox!.width / 2;
    const dragStartY = rightBox!.y + rightBox!.height / 2;

    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();

    // Крупный сегмент — подводим правый стикер примерно к левому (грубо, без
    // точного попадания в 8px порог: экранные и flow-координаты слегка
    // расходятся из-за внутреннего трансформа Vue Flow).
    const roughTargetX = leftBox!.x + rightBox!.width / 2;
    const roughTargetY = leftBox!.y + rightBox!.height / 2;
    await page.mouse.move(roughTargetX, roughTargetY, { steps: 20 });

    // Корректирующий сегмент — по СВЕЖЕМУ фактическому зазору (а не по
    // константе, подобранной один раз и не переживающей дрейф координат
    // между прогонами): дотягиваем левый край переносимого стикера вплотную
    // к левому краю статичного, гарантированно попадая в SNAP_THRESHOLD_PX
    // независимо от точного значения расхождения экран/flow.
    const midBox = await rightSticky.boundingBox();
    expect(midBox).not.toBeNull();
    const correctionX = leftBox!.x - midBox!.x;
    const correctionY = leftBox!.y - midBox!.y;
    await page.mouse.move(roughTargetX + correctionX, roughTargetY + correctionY, { steps: 5 });

    // Во время drag появляются snap-гиды (только визуально, позиция не меняется)
    await expect(board.snapGuides).toBeVisible();
    await expect.poll(() => board.snapGuide.count()).toBeGreaterThan(0);

    // Отпускаем — snap позиция применяется, гиды исчезают
    await page.mouse.up();
    await expect(board.snapGuides).toHaveCount(0);

    // Переносимый стикер притянулся к статичному — оба имеют одинаковый левый
    // край. Сравниваем актуальные rect'ы: Vue Flow может автопанить viewport
    // во время drag, поэтому сохранённый до жеста screen-x не является опорой.
    await expect
      .poll(async () => {
        const [staticBox, draggedBox] = await Promise.all([
          leftSticky.boundingBox(),
          rightSticky.boundingBox(),
        ]);
        return staticBox && draggedBox ? Math.round(draggedBox.x - staticBox.x) : null;
      })
      .toBeCloseTo(0, 1);
  });
});
