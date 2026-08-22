import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { waitForStableBox } from '../src/stable-box';

/**
 * Фреймы и группы (14.3) — видимые контейнеры (frame) и невидимые (group).
 * Фрейм создаётся инструментом «Фрейм» в левом тулбаре (клик по пустому холсту),
 * группа — через контекстное меню «Сгруппировать» на выделении. Удаление
 * контейнера осирает детей (parentId → null), не удаляя их.
 *
 * Фрейм и группа ведут себя РАЗНО при драге (важное отличие, добавлено после
 * ручной проверки пользователем): фрейм — мини-холст, дети двигаются вместе с
 * НИМ, но не клэмпятся физически внутри — драг ребёнка за пределы фрейма
 * отвязывает его (resolveDragParent пересчитывается всегда, не единожды).
 * Группа — жёсткий пучок: драг ЛЮБОГО участника двигает всех остальных и сам
 * контейнер-группу, членство меняется только явным «Разгруппировать», которое
 * распускает группу целиком и удаляет опустевшую оболочку.
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Инструмент «Фрейм» — клик по холсту создаёт фрейм
    await board.toolbarButton('Фрейм').click();
    await expect(board.toolbarButton('Фрейм')).toHaveAttribute('aria-pressed', 'true');
    await board.pane.click({ position: { x: 300, y: 200 } });

    // Фрейм появился, инструмент вернулся на «Выделение»
    await expect(board.frameNodes).toHaveCount(1);
    await expect(board.toolbarButton('Фрейм')).toHaveAttribute('aria-pressed', 'false');

    // Переживает перезагрузку
    await page.reload();
    await expect(board.frameNodes).toHaveCount(1);
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Создаём два стикера — y подальше от верхней панели с названием доски
    // (иначе клик по пейну перехватывает панель, а не создаёт элемент)
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 100, y: 300 } });
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 250, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(2);

    // Выделяем оба стикера — на доске сейчас только они, так что Ctrl/Cmd+A
    // (уже проверенный хоткей выделения всего, use-board-hotkeys.ts) надёжнее
    // хрупкого drag-select прямоугольника с ручной геометрией
    await board.pane.click({ position: { x: 600, y: 550 } });
    await page.keyboard.press('ControlOrMeta+a');

    // Контекстное меню → «Сгруппировать»
    await board.stickyNodes.first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Сгруппировать', exact: true }).click();

    // Группа появилась
    await expect(board.groupNodes).toHaveCount(1);

    // Переживает перезагрузку
    await page.reload();
    await expect(board.groupNodes).toHaveCount(1);
    await expect(board.stickyNodes).toHaveCount(2);
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Фрейм + стикер, созданный кликом ВНУТРИ его границ — приклеивается сразу (14.3)
    await board.toolbarButton('Фрейм').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    await expect(board.frameNodes).toHaveCount(1);

    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 420, y: 320 } });
    await expect(board.stickyNodes).toHaveCount(1);

    const frameNode = board.frameNodes;
    const stickyNode = board.stickyNodes;
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
    await board.selectionToolbarButton('Дублировать').click();
    await expect(board.frameNodes).toHaveCount(2);
    await expect(board.stickyNodes).toHaveCount(2);
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.toolbarButton('Фрейм').click();
    await board.pane.click({ position: { x: 300, y: 200 } });
    await expect(board.frameNodes).toHaveCount(1);

    // Одиночное выделение фрейма — «Сгруппировать» заблокировано (нет вложенности контейнеров),
    // «Разгруппировать» тоже (сам фрейм ни в кого не вложен)
    await board.frameNodes.click({ button: 'right' });
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
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Создаём фрейм
    await board.toolbarButton('Фрейм').click();
    await board.pane.click({ position: { x: 300, y: 200 } });
    await expect(board.frameNodes).toHaveCount(1);

    // Создаём стикер внутри фрейма
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 310, y: 210 } });
    await expect(board.stickyNodes).toHaveCount(1);

    // Удаляем фрейм (контекстное меню → Удалить). Правый клик по невыделенной
    // карточке заодно выделяет её — рядом всплывает и тулбар выделения со
    // своей кнопкой «Удалить», так что скоупим локатор именно контекстным меню
    await board.frameNodes.click({ button: 'right' });
    await board.contextMenu.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(board.frameNodes).toHaveCount(0);

    // Стикер осиротел — остаётся на холсте как элемент верхнего уровня
    await expect(board.stickyNodes).toHaveCount(1);

    // Переживает перезагрузку — стикер сохранился без родителя
    await page.reload();
    await expect(board.frameNodes).toHaveCount(0);
    await expect(board.stickyNodes).toHaveCount(1);
  });

  test('группа — жёсткий пучок: перетаскивание одного участника двигает и остальных', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-group-rigid');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}GroupRigid ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 100, y: 300 } });
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(2);

    await board.pane.click({ position: { x: 700, y: 550 } });
    await page.keyboard.press('ControlOrMeta+a');
    await board.stickyNodes.first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Сгруппировать', exact: true }).click();
    await expect(board.groupNodes).toHaveCount(1);

    const sticky1 = board.stickyNodes.first();
    const sticky2 = board.stickyNodes.last();
    const box1Before = await sticky1.boundingBox();
    const box2Before = await sticky2.boundingBox();

    // Снимаем выделение и тащим ТОЛЬКО один узел — иначе сработал бы родной
    // мульти-драг Vue Flow (оба узла и так уже выделены), а не наш кастомный
    // каскад по факту членства в группе (dragCascadeOps), который и проверяем
    await board.pane.click({ position: { x: 700, y: 550 } });
    await page.mouse.move(
      box1Before!.x + box1Before!.width / 2,
      box1Before!.y + box1Before!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      box1Before!.x + box1Before!.width / 2 + 90,
      box1Before!.y + box1Before!.height / 2 + 50,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect
      .poll(async () => (await sticky1.boundingBox())!.x)
      .toBeGreaterThan(box1Before!.x + 70);
    // Главная проверка — сосед по группе тоже поехал, хотя его не тащили
    await expect
      .poll(async () => (await sticky2.boundingBox())!.x)
      .toBeGreaterThan(box2Before!.x + 70);
  });

  test('разгруппировка распускает группу целиком и удаляет опустевшую оболочку', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-ungroup-cleanup');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}UngroupCleanup ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 100, y: 300 } });
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(2);

    await board.pane.click({ position: { x: 700, y: 550 } });
    await page.keyboard.press('ControlOrMeta+a');
    await board.stickyNodes.first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Сгруппировать', exact: true }).click();
    await expect(board.groupNodes).toHaveCount(1);

    // Разгруппировываем через контекстное меню по ОДНОМУ участнику — группа
    // жёсткая, распускается целиком (не только выделенный участник)
    await board.stickyNodes.first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Разгруппировать', exact: true }).click();

    await expect(board.groupNodes).toHaveCount(0);
    await expect(board.stickyNodes).toHaveCount(2);

    // Переживает перезагрузку — оболочка не "воскресает"
    await page.reload();
    await expect(board.groupNodes).toHaveCount(0);
    await expect(board.stickyNodes).toHaveCount(2);
  });

  test('группа приклеивается к фрейму при перетаскивании участника внутрь его границ, и переезжает вместе с фреймом (14.8)', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-group-in-frame');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}GroupInFrame ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // Группа — ДАЛЕКО от места, где появится фрейм, чтобы группировка не
    // задела его геометрию (фрейм создаём уже после группировки)
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 100, y: 300 } });
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 250, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(2);

    // `fit-view-on-init` у `<VueFlow>` подгоняет зум под первый созданный узел —
    // для одного маленького стикера это может увести зум далеко от 100% (найдено
    // на этом самом тесте: 200%), а вся геометрия драга ниже считается в
    // предположении, что boundingBox-пиксели не искажены произвольным зумом
    await page.keyboard.press('ControlOrMeta+0');
    await expect(board.zoom).toHaveText('100%');

    await board.pane.click({ position: { x: 700, y: 600 } });
    await page.keyboard.press('ControlOrMeta+a');
    await board.stickyNodes.first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Сгруппировать', exact: true }).click();
    await expect(board.groupNodes).toHaveCount(1);

    // Фрейм — в стороне от группы
    await board.toolbarButton('Фрейм').click();
    await board.pane.click({ position: { x: 950, y: 450 } });
    await expect(board.frameNodes).toHaveCount(1);

    const sticky1 = board.stickyNodes.first();
    const sticky2 = board.stickyNodes.last();
    const frameNode = board.frameNodes;
    const frameBox = await frameNode.boundingBox();
    const sticky1Before = await sticky1.boundingBox();
    expect(frameBox).not.toBeNull();

    // Тащим ОДНОГО участника группы в центр фрейма — группа жёсткая, поэтому
    // сосед по группе едет тем же каскадом (уже проверено другим тестом);
    // здесь проверяем НОВОЕ (14.8) — сама группа-обёртка при этом переоценивает
    // принадлежность фрейму по своей новой (сдвинутой) позиции
    const dragFrom = {
      x: sticky1Before!.x + sticky1Before!.width / 2,
      y: sticky1Before!.y + sticky1Before!.height / 2,
    };
    const dragTo = {
      x: frameBox!.x + frameBox!.width / 2,
      y: frameBox!.y + frameBox!.height / 2,
    };
    await page.mouse.move(dragFrom.x, dragFrom.y);
    await page.mouse.down();
    await page.mouse.move(dragTo.x, dragTo.y, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => (await sticky1.boundingBox())!.x)
      .toBeGreaterThan(sticky1Before!.x + 100);

    // Главная проверка: раз группа теперь приклеена к фрейму, перетаскивание
    // ФРЕЙМА должно унести за собой ОБА стикера — не только напрямую
    // перетащенный, но и его соседа по группе (двухуровневый каскад, 14.8)
    const sticky1AfterGroupDrag = await sticky1.boundingBox();
    const sticky2AfterGroupDrag = await sticky2.boundingBox();
    const frameBoxBefore = await frameNode.boundingBox();
    const frameDragFrom = {
      x: frameBoxBefore!.x + frameBoxBefore!.width * 0.05,
      y: frameBoxBefore!.y + frameBoxBefore!.height * 0.5,
    };
    const frameDelta = { x: 60, y: 40 };
    await page.mouse.move(frameDragFrom.x, frameDragFrom.y);
    await page.mouse.down();
    await page.mouse.move(frameDragFrom.x + frameDelta.x, frameDragFrom.y + frameDelta.y, {
      steps: 8,
    });
    await page.mouse.up();

    await expect
      .poll(async () => (await frameNode.boundingBox())!.x - frameBoxBefore!.x)
      .toBeGreaterThan(frameDelta.x - 20);
    await expect
      .poll(async () => (await sticky1.boundingBox())!.x - sticky1AfterGroupDrag!.x)
      .toBeGreaterThan(frameDelta.x - 20);
    // Сосед по группе (не то, за что тащили ни в первый, ни во второй раз) —
    // без исправления 14.8 остался бы на месте, так как parentId группы
    // не сменился бы на фрейм и cascade фрейма его бы не подхватил
    await expect
      .poll(async () => (await sticky2.boundingBox())!.x - sticky2AfterGroupDrag!.x)
      .toBeGreaterThan(frameDelta.x - 20);
  });

  test('правый клик по мульти-выделению открывает меню доски, не браузера', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-multi-context-menu');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}MultiCtxMenu ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 100, y: 300 } });
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(2);

    // Мульти-выделение (2+ узла) — Vue Flow рисует поверх него служебную
    // обёртку .vue-flow__nodesselection-rect для группового драга/ресайза,
    // которая перехватывает клики, включая правый — без отдельного
    // обработчика (selectionContextMenu) вместо меню доски "просвечивало" бы
    // браузерное (найдено вручную)
    await board.pane.click({ position: { x: 700, y: 550 } });
    await page.keyboard.press('ControlOrMeta+a');
    await board.stickyNodes.first().click({ button: 'right' });

    await expect(board.contextMenu).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сгруппировать', exact: true })).toBeVisible();
  });

  test('копирование через системный буфер (Ctrl/Cmd+C/V): фрейм тянет за собой содержимое', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-copy-frame');
    const context = await newContext(browser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAs(context, owner);
    const page = await context.newPage();

    async function copyAndWaitForClipboard(previousText: string): Promise<void> {
      await page.keyboard.press('ControlOrMeta+c');
      await expect(async () => {
        const text = await page.evaluate(() => navigator.clipboard.readText());
        expect(text).not.toBe(previousText);
      }).toPass({ timeout: 5000 });
    }

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}CopyFrame ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();
    await board.pane.click();

    // Фрейм + стикер внутри него (приклеивается сразу, 14.3). Автофит на
    // пустой доске подгоняется под только что созданный 640×400 фрейм (17.12)
    // и заодно перецентровывает pan — срабатывает асинхронно (ResizeObserver),
    // поэтому ждём стабилизации boundingBox фрейма, а не полагаемся на текст
    // зума (он и так «100%» ДО фита — проверка прошла бы, не дождавшись сдвига).
    await board.toolbarButton('Фрейм').click();
    await board.pane.click({ position: { x: 300, y: 200 } });
    await expect(board.frameNodes).toHaveCount(1);

    // Стикер — ближе к верхнему левому углу фрейма, не в его центре: ниже
    // копируем фрейм кликом по умолчанию в центр локатора (`frameNodes.click()`),
    // а сплошной 180×180 стикер поверх центра фрейма перехватил бы этот клик.
    const frameBox = await waitForStableBox(board.frameNodes);
    await board.toolbarButton('Стикер').click();
    await page.mouse.click(frameBox.x + frameBox.width * 0.2, frameBox.y + frameBox.height * 0.2);
    await expect(board.stickyNodes).toHaveCount(1);
    await page.keyboard.press('Escape');

    // Копируем ТОЛЬКО фрейм (клик по его рамке, не по стикеру внутри) — вставка
    // должна восстановить и стикер тоже, хотя явно выделен был лишь контейнер
    await board.frameNodes.click();
    await copyAndWaitForClipboard('');
    await page.keyboard.press('ControlOrMeta+v');

    await expect(board.frameNodes).toHaveCount(2);
    await expect(board.stickyNodes).toHaveCount(2);
  });

  test('копирование через системный буфер (Ctrl/Cmd+C/V): группа тянет за собой содержимое, а не только пустую оболочку', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();
    const owner = await createUser('board-copy-group');
    const context = await newContext(browser);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAs(context, owner);
    const page = await context.newPage();

    async function copyAndWaitForClipboard(previousText: string): Promise<void> {
      await page.keyboard.press('ControlOrMeta+c');
      await expect(async () => {
        const text = await page.evaluate(() => navigator.clipboard.readText());
        expect(text).not.toBe(previousText);
      }).toPass({ timeout: 5000 });
    }

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}CopyGroup ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();
    await board.pane.click();

    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 100, y: 300 } });
    await board.toolbarButton('Стикер').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    await expect(board.stickyNodes).toHaveCount(2);

    await board.pane.click({ position: { x: 700, y: 550 } });
    await page.keyboard.press('ControlOrMeta+a');
    await board.stickyNodes.first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Сгруппировать', exact: true }).click();
    await expect(board.groupNodes).toHaveCount(1);

    // Копируем ОДНОГО участника (не всю группу целиком выделяем) — вставка
    // должна восстановить группу целиком, а не только этот один стикер и не
    // пустую оболочку без содержимого
    await board.stickyNodes.first().click();
    await copyAndWaitForClipboard('');
    await page.keyboard.press('ControlOrMeta+v');

    await expect(board.groupNodes).toHaveCount(2);
    await expect(board.stickyNodes).toHaveCount(4);
  });
});
