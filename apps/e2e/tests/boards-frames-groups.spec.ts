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

    // Создаём два стикера — y подальше от верхней панели с названием доски
    // (иначе клик по пейну перехватывает панель, а не создаёт элемент)
    await page.locator('.board-toolbar button[aria-label="Стикер"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 100, y: 300 } });
    await page.locator('.board-toolbar button[aria-label="Стикер"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 250, y: 300 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(2);

    // Выделяем оба стикера — на доске сейчас только они, так что Ctrl/Cmd+A
    // (уже проверенный хоткей выделения всего, use-board-hotkeys.ts) надёжнее
    // хрупкого drag-select прямоугольника с ручной геометрией
    await page.locator('.vue-flow__pane').click({ position: { x: 600, y: 550 } });
    await page.keyboard.press('ControlOrMeta+a');

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

  test('фрейм — мини-холст: элемент внутри двигается вместе с фреймом, дублирование фрейма дублирует содержимое', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-frame-minicanvas');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}FrameMini ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    // Фрейм + стикер, созданный кликом ВНУТРИ его границ — приклеивается сразу (14.3)
    await page.locator('.board-toolbar button[aria-label="Фрейм"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 400, y: 300 } });
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(1);

    await page.locator('.board-toolbar button[aria-label="Стикер"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 420, y: 320 } });
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);

    const frameNode = page.locator('.vue-flow__node-frame');
    const stickyNode = page.locator('.vue-flow__node-sticky');
    const frameBoxBefore = await frameNode.boundingBox();
    const stickyBoxBefore = await stickyNode.boundingBox();
    expect(frameBoxBefore).not.toBeNull();
    expect(stickyBoxBefore).not.toBeNull();

    // Тащим фрейм за правый край рамки по вертикальному центру — не за угол
    // (там ресайз-хендл), не за заголовок (он над фреймом), не за сам стикер
    // (сидит в середине фрейма). Сток должен приехать вместе с фреймом, а не
    // остаться на месте (был баг: extent:'parent' без корректной относительной
    // позиции визуально "отвязывал" детей)
    const dragFrom = {
      x: frameBoxBefore!.x + frameBoxBefore!.width * 0.9,
      y: frameBoxBefore!.y + frameBoxBefore!.height * 0.5,
    };
    const delta = { x: 90, y: 60 };
    await page.mouse.move(dragFrom.x, dragFrom.y);
    await page.mouse.down();
    await page.mouse.move(dragFrom.x + delta.x, dragFrom.y + delta.y, { steps: 8 });
    await page.mouse.up();

    // poll, не мгновенный снимок — финальный патч детей идёт отдельным сетевым
    // запросом (containerChildOps), рендер применяется асинхронно после ответа
    await expect
      .poll(async () => (await frameNode.boundingBox())!.x - frameBoxBefore!.x)
      .toBeGreaterThan(delta.x - 20);
    // Главная проверка — сток двигается ВМЕСТЕ с фреймом, а не по отдельности
    await expect
      .poll(async () => (await stickyNode.boundingBox())!.x - stickyBoxBefore!.x)
      .toBeGreaterThan(delta.x - 20);
    await expect
      .poll(async () => (await stickyNode.boundingBox())!.y - stickyBoxBefore!.y)
      .toBeGreaterThan(delta.y - 20);

    // Дублирование фрейма (тулбар выделения) тянет за собой и его содержимое
    await frameNode.click();
    await page.locator('.board-selection-toolbar button[aria-label="Дублировать"]').click();
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(2);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(2);
  });

  test('контекстное меню: «Сгруппировать» заблокировано, если в выделении уже есть контейнер', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-group-guard');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}GroupGuard ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(page.locator('.vue-flow__pane')).toBeVisible();

    await page.locator('.board-toolbar button[aria-label="Фрейм"]').click();
    await page.locator('.vue-flow__pane').click({ position: { x: 300, y: 200 } });
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(1);

    // Одиночное выделение фрейма — «Сгруппировать» заблокировано (нет вложенности контейнеров),
    // «Разгруппировать» тоже (сам фрейм ни в кого не вложен)
    await page.locator('.vue-flow__node-frame').click({ button: 'right' });
    await expect(page.getByRole('button', { name: 'Сгруппировать', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Разгруппировать', exact: true })).toBeDisabled();
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

    // Удаляем фрейм (контекстное меню → Удалить). Правый клик по невыделенной
    // карточке заодно выделяет её — рядом всплывает и тулбар выделения со
    // своей кнопкой «Удалить», так что скоупим локатор именно контекстным меню
    await page.locator('.vue-flow__node-frame').click({ button: 'right' });
    await page
      .locator('.board-context-menu')
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(0);

    // Стикер осиротел — остаётся на холсте как элемент верхнего уровня
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);

    // Переживает перезагрузку — стикер сохранился без родителя
    await page.reload();
    await expect(page.locator('.vue-flow__node-frame')).toHaveCount(0);
    await expect(page.locator('.vue-flow__node-sticky')).toHaveCount(1);
  });
});
