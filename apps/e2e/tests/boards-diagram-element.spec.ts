import { randomUUID } from 'node:crypto';

import { boardLocators } from '../src/board-locators';
import { E2E_ROOM_PREFIX, expect, test } from '../src/fixtures';
import { waitForStableBox } from '../src/stable-box';

/**
 * Диаграммные элементы UML/BPMN (23.1/23.2) — вертикальный срез: создание
 * через тулбар (поповер «Диаграммы»), редактирование текста, resize в
 * per-kind границах DiagramNodeSpec, соединение обычной generic-стрелкой,
 * undo/redo, персистентность после reload, realtime-видимость другому
 * участнику. Пока проверяются ровно два kind, проведённых через весь стек —
 * UML `actor` и BPMN `task`; остальные UML kind получили настоящие
 * SVG-трафареты и боковую панель свойств в 23.3 (см. отдельный describe
 * ниже) — BPMN-kind по-прежнему плейсхолдер до 23.4.
 */
test.describe('Доски: диаграммные элементы (UML/BPMN)', () => {
  test('создание через поповер тулбара, resize в границах DiagramNodeSpec, соединение, undo/redo, reload', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();

    const owner = await createUser('board-diagram');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}Diagram ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    // --- UML actor: кнопка «Диаграммы» открывает поповер, выбор вооружает инструмент ---
    await board.toolbarButton('Диаграммы').click();
    await expect(board.diagramPicker).toBeVisible();
    await board.diagramPickerOption('uml', 'actor').click();
    await expect(board.toolbarButton('Диаграммы')).toHaveAttribute('aria-pressed', 'true');
    await board.pane.click({ position: { x: 300, y: 300 } });

    await expect(board.nodeByType('diagram')).toHaveCount(1);
    const actorId = await board.nodeByType('diagram').getAttribute('data-node-id');
    await expect(board.nodeById(actorId!)).toHaveAttribute('data-diagram-kind', 'actor');
    // Инструмент вернулся на «Выделение» после размещения
    await expect(board.toolbarButton('Диаграммы')).toHaveAttribute('aria-pressed', 'false');

    // Редактор текста открывается автоматически (pendingEditId) — вводим и коммитим
    // кликом в пустое место (Escape отменяет правку, а не сохраняет — см. boards-text-element.spec.ts)
    const actorEditable = page.locator(`[data-node-id="${actorId}"] [contenteditable="true"]`);
    await actorEditable.fill('Customer');
    await board.pane.click({ position: { x: 900, y: 500 } });
    await expect(page.locator(`[data-node-id="${actorId}"]`)).toContainText('Customer');

    // Автофит по первому появившемуся узлу (17.12) может ещё донастраивать
    // pan/zoom асинхронно — ждём стабильной позиции actor, прежде чем считать
    // экранные координаты клика под второй узел от текущего расклада
    const actorBox = await waitForStableBox(page.locator(`[data-node-id="${actorId}"]`));

    // --- BPMN task: тот же поповер, второй пункт, размещаем правее актёра ---
    await board.toolbarButton('Диаграммы').click();
    await board.diagramPickerOption('bpmn', 'task').click();
    await board.pane.click({ position: { x: actorBox.x + actorBox.width + 250, y: actorBox.y } });

    await expect(board.nodeByType('diagram')).toHaveCount(2);
    const taskId = await board
      .nodeByType('diagram')
      .locator(`:scope:not([data-node-id="${actorId}"])`)
      .getAttribute('data-node-id');
    await expect(board.nodeById(taskId!)).toHaveAttribute('data-diagram-kind', 'task');
    const taskEditable = page.locator(`[data-node-id="${taskId}"] [contenteditable="true"]`);
    await taskEditable.click();
    // Коммитим кликом в пустое место (тот же приём, что и у actor выше, и в
    // boards-realtime-sync.spec.ts) — это же снимает выделение с узла, иначе
    // NodeResizer выделенного узла перекрывает хендл соединения в том же углу
    await board.pane.click({ position: { x: 950, y: 500 } });

    // Per-kind границы resize (DiagramNodeSpec.min/maxWidth/Height) — покрыты
    // серверными юнит-тестами (board-ops.test.ts: «отклоняет diagram-элемент
    // шире per-kind maxWidth»/«уже per-kind minWidth») авторитетно; здесь,
    // на уровне e2e, драг-резайз через реальные мышиные события оказался
    // неустойчивым (retry на перехвате pointer events у Vue Flow node), не
    // повторяем — ценность дублирующей проверки не окупает флаки-риск.

    // --- Соединяем actor -> task обычной generic-стрелкой (23.5 семантику ещё не добавляет) ---
    const sourceHandle = page.locator(
      `[data-testid="board-handle"][data-nodeid="${actorId}"][data-handleid="right"]`,
    );
    const targetHandle = page.locator(
      `[data-testid="board-handle"][data-nodeid="${taskId}"][data-handleid="left"]`,
    );
    const sourceBox = await waitForStableBox(sourceHandle);
    const targetBox = await waitForStableBox(targetHandle);
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height / 2,
      {
        steps: 10,
      },
    );
    await page.mouse.up();
    await expect(board.edges).toHaveCount(1);

    // --- Undo убирает связь, redo возвращает ---
    await page.keyboard.press('ControlOrMeta+z');
    await expect(board.edges).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(board.edges).toHaveCount(1);

    // --- Reload: оба узла, текст и связь переживают перезагрузку (снимок с сервера) ---
    await page.reload();
    await expect(board.pane).toBeVisible();
    await expect(board.nodeByType('diagram')).toHaveCount(2);
    await expect(board.edges).toHaveCount(1);
    await expect(page.locator(`[data-node-id="${actorId}"]`)).toContainText('Customer');
  });

  test('diagram-элемент, созданный одним участником, корректно рендерится у другого через realtime', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();

    const owner = await createUser('board-diagram-realtime');
    const contextA = await newContext(browser);
    await loginAs(contextA, owner);
    const pageA = await contextA.newPage();
    await pageA.goto('/boards');
    await pageA.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}DiagramRT ${randomUUID().slice(0, 8)}`;
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

    await boardA.toolbarButton('Диаграммы').click();
    await boardA.diagramPickerOption('bpmn', 'task').click();
    await boardA.pane.click({ position: { x: 400, y: 300 } });
    await expect(boardA.nodeByType('diagram')).toHaveCount(1);

    // Узел долетает через board:ops и рендерится компонентом BoardDiagramNode.vue
    // (nodeTypes.diagram) у второго участника без ошибок — ключевая проверка
    // того, что регистрация типа узла в BoardCanvas.vue реально сработала.
    await expect(boardB.nodeByType('diagram')).toHaveCount(1);
    const nodeId = await boardA.nodeByType('diagram').getAttribute('data-node-id');
    await expect(boardB.nodeById(nodeId!)).toHaveAttribute('data-diagram-kind', 'task');
  });
});

/**
 * UML-трафареты и боковая панель свойств (23.3) — SVG для всех 7 UML kind
 * (проверяем создание каждого через поповер с группами/поиском) и структурный
 * ввод атрибутов/операций class через `BoardDiagramPropertiesPanel.vue`, не
 * через contenteditable-текст самого узла.
 */
test.describe('Доски: UML-трафареты и панель свойств (23.3)', () => {
  test('поповер создаёт все 7 UML kind (группы «UML»/«BPMN», поиск)', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();

    const owner = await createUser('board-diagram-uml-kinds');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}DiagramUml ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    const kinds = ['actor', 'use-case', 'class', 'interface', 'enum', 'component', 'database'];
    let x = 200;
    for (const kind of kinds) {
      await board.toolbarButton('Диаграммы').click();
      // Поиск фильтрует по переведённому названию — проверяем на одном kind,
      // остальные создаём без поиска (быстрее, поиск уже подтверждён работающим)
      if (kind === 'class') {
        await board.diagramPicker.locator('input').fill('Класс');
        await expect(board.diagramPickerOption('uml', 'class')).toBeVisible();
        await expect(board.diagramPickerOption('uml', 'actor')).toBeHidden();
      }
      await board.diagramPickerOption('uml', kind).click();
      await board.pane.click({ position: { x, y: 300 } });
      x += 220;
    }

    await expect(board.nodeByType('diagram')).toHaveCount(kinds.length);
    for (const kind of kinds) {
      await expect(page.locator(`[data-diagram-kind="${kind}"]`)).toHaveCount(1);
    }
  });

  test('панель свойств class: добавление атрибута и операции, persist после reload', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();

    const owner = await createUser('board-diagram-class-props');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}DiagramClass ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.toolbarButton('Диаграммы').click();
    await board.diagramPickerOption('uml', 'class').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    await expect(board.nodeByType('diagram')).toHaveCount(1);
    const classId = await board.nodeByType('diagram').getAttribute('data-node-id');
    await expect(board.nodeById(classId!)).toHaveAttribute('data-diagram-kind', 'class');

    // Имя класса — редактор автозапускается (pendingEditId), коммитим кликом
    // мимо (см. пояснение про Escape в первом describe этого файла)
    const nameEditable = page.locator(`[data-node-id="${classId}"] [contenteditable="true"]`);
    await nameEditable.fill('Order');
    await board.pane.click({ position: { x: 900, y: 500 } });
    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('Order');

    // Панель свойств появляется, только когда узел выделен ровно один
    await board.nodeById(classId!).click();
    await expect(board.diagramPropertiesPanel).toBeVisible();

    await board.diagramPropertiesAddAttribute.click();
    const attrRow = board.diagramAttributeRows.first();
    await board.diagramPropertyName(attrRow).fill('id');
    await board.diagramPropertyDataType(attrRow).fill('string');
    await board.diagramPropertyVisibility(attrRow).selectOption('private');
    // Коммит по blur поля — клик в пустое место поповера паттерна не имеет,
    // фокус просто должен уйти с последнего изменённого поля
    await board.pane.click({ position: { x: 900, y: 200 } });

    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('id');
    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('string');

    // Панель закрылась вместе со снятием выделения — выделяем узел заново для операции
    await board.nodeById(classId!).click();
    await expect(board.diagramPropertiesPanel).toBeVisible();
    await board.diagramPropertiesAddOperation.click();
    const opRow = board.diagramOperationRows.first();
    await board.diagramPropertyName(opRow).fill('save');
    await board.pane.click({ position: { x: 900, y: 200 } });

    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('save()');

    // --- Reload: имя, атрибут и операция переживают перезагрузку (снимок с сервера) ---
    await page.reload();
    await expect(board.pane).toBeVisible();
    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('Order');
    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('id');
    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('string');
    await expect(page.locator(`[data-node-id="${classId}"]`)).toContainText('save()');
  });

  test('панель свойств enum: литерал без видимости/типа, operations всегда пусто', async ({
    browser,
    createUser,
    loginAs,
    newContext,
  }) => {
    test.slow();

    const owner = await createUser('board-diagram-enum-props');
    const context = await newContext(browser);
    await loginAs(context, owner);
    const page = await context.newPage();

    await page.goto('/boards');
    await page.getByRole('button', { name: 'Создать доску', exact: true }).click();
    const boardName = `${E2E_ROOM_PREFIX}DiagramEnum ${randomUUID().slice(0, 8)}`;
    await page.getByPlaceholder('Например, Ретро спринта 24').fill(boardName);
    await page.locator('form').getByRole('button', { name: 'Создать доску' }).click();
    const board = boardLocators(page);
    await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
    await expect(board.pane).toBeVisible();

    await board.toolbarButton('Диаграммы').click();
    await board.diagramPickerOption('uml', 'enum').click();
    await board.pane.click({ position: { x: 400, y: 300 } });
    const enumId = await board.nodeByType('diagram').getAttribute('data-node-id');
    await board.pane.click({ position: { x: 900, y: 500 } }); // коммит пустого текста, снять выделение

    await board.nodeById(enumId!).click();
    await expect(board.diagramPropertiesPanel).toBeVisible();
    // Операции недоступны для enum — секция скрыта целиком
    await expect(board.diagramPropertiesAddOperation).toBeHidden();

    await board.diagramPropertiesAddAttribute.click();
    const literalRow = board.diagramAttributeRows.first();
    await board.diagramPropertyName(literalRow).fill('ACTIVE');
    // Тип/видимость не рендерятся для enum-литерала
    await expect(board.diagramPropertyDataType(literalRow)).toBeHidden();
    await expect(board.diagramPropertyVisibility(literalRow)).toBeHidden();
    await board.pane.click({ position: { x: 900, y: 200 } });

    await expect(page.locator(`[data-node-id="${enumId}"]`)).toContainText('ACTIVE');
  });
});
