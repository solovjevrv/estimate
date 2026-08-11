import { randomUUID } from 'node:crypto';

import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';

/**
 * Фреймы и группы (14.3) — видимые контейнеры (frame) и невидимые (group).
 * Фрейм создаётся инструментом «Фрейм» в левом тулбаре (клик по пустому холсту),
 * группа — через контекстное меню «Сгруппировать» на выделении. Дети
 * движутся вместе с контейнером (extent: 'parent'). Удаление контейнера осирает
 * детей (parentId → null), не удаляя их.
 */
test.describe('Доски: фреймы и группы', () => {
  test('создание фрейма через тулбар, персистентность после reload', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-frame');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Frame ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Инструмент «Фрейм» — клик по холсту создаёт фрейм
    await page.locator('.board-toolbar button[aria-label="Фрейм"]').click();
    await expect(page.locator('.board-toolbar button[aria-label="Фрейм"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator('.vue-flow__pane').click({ position: { x: 300, y: 200 } });

    // Фрейм появился, инструмент вернулся на «Выделение»
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(1);
    await expect(page.locator('.board-toolbar button[aria-label="Фрейм"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Переживает перезагрузку
    await page.reload();
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(1);
  });

  test('группировка выделения через контекстное меню, персистентность после reload', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-group');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Group ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Создаём два стикера
    await page.locator('.board-toolbar button[aria-label="Стикер"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 100, y: 100 } });
    await page.locator('.board-toolbar button[aria-label="Стикер"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 250, y: 100 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(2);

    // Выделяем оба стикера (drag-select)
    await page.locator('.vue-flow__pane').evaluate(() => {
      // @ts-expect-error -- evaluate returns Element not Element | null
      const pane = document.querySelector('.vue-flow__pane');
      const event = new MouseEvent('mousedown', { bubbles: true, clientX: 80, clientY: 80 });
      pane!.dispatchEvent(event);
      const move = new MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 200 });
      pane!.dispatchEvent(move);
      const up = new MouseEvent('mouseup', { bubbles: true, clientX: 300, clientY: 200 });
      pane!.dispatchEvent(up);
    });
    await page.locator('.vue-flow__node-sticky').first().waitFor();

    // Контекстное меню → «Сгруппировать»
    await page.locator('.vue-flow__node-sticky').first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Сгруппировать', exact: true }).click();

    // Группа появилась
    await expect(page.locator('.vue-flow__node-group')).toHaveCount(1);

    // Переживает перезагрузку
    await page.reload();
    await expect(page.locator('.vue-flow__node-group')).toHaveCount(1);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(2);
  });

  test('удаление фрейма осирает детей, не удаляя их', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-frame-orphan');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}FrameOrphan ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Создаём фрейм
    await page.locator('.board-toolbar button[aria-label="Фрейм"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 300, y: 200 } });
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(1);

    // Создаём стикер внутри фрейма
    await page.locator('.board-toolbar button[aria-label="Стикер"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 310, y: 210 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);

    // Удаляем фрейм (контекстное меню → Удалить)
    await page.locator('.vue-flow__node-frame').click({ button: 'right' });
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(0);

    // Стикер осиротел — остаётся на холсте как элемент верхнего уровня
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);

    // Переживает перезагрузку — стикер сохранился без родителя
    await page.reload();
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(0);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
  });
});
