import { randomUUID } from 'node:crypto';

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

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(
      `${E2E_ROOM_PREFIX}Snap ${randomUUID().slice(0, 8)}`,
    );
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();
    await page.locator('.vue-flow__pane').click();
    await page.keyboard.press('ControlOrMeta+0');
    await page.waitForTimeout(200);

    // Два стикера на одной горизонтали:
    // A: центр в (400, 300) → x=310, y=210 (центр стикера при двойном клике)
    // B: центр в (600, 300) → x=510, y=210
    await page.locator('.vue-flow__pane').dblclick({ position: { x: 400, y: 300 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await page.locator('.vue-flow__pane').dblclick({ position: { x: 600, y: 300 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+0');
    await page.waitForTimeout(200);

    const leftSticky = page.locator('.vue-flow__node-sticky').first();
    const rightSticky = page.locator('.vue-flow__node-sticky').last();

    const leftBox = await leftSticky.boundingBox();
    expect(leftBox).not.toBeNull();

    // Выбираем правый стикер и перетаскиваем его влево к левому.
    // SNAP_THRESHOLD_PX = 8px. Перетаскиваем так, чтобы в какой-то момент
    // правый стикер оказался в пределах 8px от левого по какой-то оси.
    const rightBox = await rightSticky.boundingBox();
    expect(rightBox).not.toBeNull();

    // Целевая позиция: левый край правого стикера почти совпадает с левым краем левого
    // (разница ~5px < 8px порога). Для одинаковых стикеров left-left, center-center
    // и right-right дают одинаковую snap-позицию (x = leftBox.x).
    const targetRightX = leftBox!.x + 5; // 5px от левого края левого стикера
    const dragDistance = rightBox!.x - targetRightX;

    await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2);
    await rightSticky.click(); // выбрать одиночным кликом перед drag
    await page.mouse.move(rightBox!.x + rightBox!.width / 2, rightBox!.y + rightBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rightBox!.x + rightBox!.width / 2 - dragDistance,
      rightBox!.y + rightBox!.height / 2,
      { steps: 20 },
    );

    // Во время drag появляются snap-гиды (только визуально, позиция не меняется)
    await expect(page.locator('.board-snap-guides')).toBeVisible();
    await expect(page.locator('.board-snap-guide')).toHaveCount(1);

    // Отпускаем — snap позиция применяется, гиды исчезают
    await page.mouse.up();
    await page.waitForTimeout(200);
    await expect(page.locator('.board-snap-guides')).toHaveCount(0);

    // Правый стикер притянулся к левому — оба имеют одинаковый левый край
    const snappedRightBox = await rightSticky.boundingBox();
    expect(snappedRightBox).not.toBeNull();
    expect(snappedRightBox!.x).toBeCloseTo(leftBox!.x, 1);
  });
});
