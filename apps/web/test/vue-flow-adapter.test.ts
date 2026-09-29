import type { BoardEdge, BoardItem } from '@estimate/shared';
import { MarkerType } from '@vue-flow/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  boardEdgeToFlowEdge,
  boardItemToNode,
  createFlowEdgesConverter,
  createFlowNodesConverter,
  toFlowEdges,
  toFlowNodes,
} from '../src/features/boards/adapters/vue-flow-adapter';
import { theme } from '../src/lib/theme';

const stickyItem: BoardItem = {
  id: 'i1',
  boardId: 'b1',
  parentId: null,
  x: 10,
  y: 20,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 3,
  content: { type: 'sticky', text: 'Привет' },
  style: { color: '#FCEB96' },
  reactions: [],
  createdBy: 'u1',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const shapeItem: BoardItem = {
  ...stickyItem,
  id: 'i2',
  content: { type: 'shape', shape: 'diamond', text: 'Решение' },
  style: { color: '#A8CAFF' },
};

const straightEdge: BoardEdge = {
  id: 'e1',
  boardId: 'b1',
  sourceItemId: 'i1',
  targetItemId: 'i2',
  sourceHandle: null,
  targetHandle: null,
  label: null,
  style: {
    color: '#7DA9F6',
    line: 'straight',
    dash: 'solid',
    markerStart: 'none',
    markerEnd: 'none',
  },
  zIndex: 4,
};

const frameItem: BoardItem = {
  id: 'f1',
  boardId: 'b1',
  parentId: null,
  x: 100,
  y: 100,
  width: 640,
  height: 400,
  rotation: 0,
  zIndex: 1,
  content: { type: 'frame', title: 'Группа задач' },
  style: { color: '#FCEB96' },
  reactions: [],
  createdBy: 'u1',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const childItem: BoardItem = {
  id: 'c1',
  boardId: 'b1',
  parentId: 'f1',
  x: 120,
  y: 120,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 2,
  content: { type: 'sticky', text: 'Внутри фрейма' },
  style: { color: '#A8CAFF' },
  reactions: [],
  createdBy: 'u1',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const curvedEdge: BoardEdge = {
  ...straightEdge,
  id: 'e2',
  label: 'зависит от',
  style: {
    color: '#FFB8E8',
    line: 'curved',
    dash: 'solid',
    markerStart: 'none',
    markerEnd: 'none',
  },
};

describe('boardItemToNode', () => {
  it('переносит позицию, размер, z-index и тип узла из content.type', () => {
    const node = boardItemToNode(stickyItem);

    expect(node.id).toBe('i1');
    expect(node.type).toBe('sticky');
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.width).toBe(160);
    expect(node.height).toBe(120);
    expect(node.zIndex).toBe(3);
    expect(node.data).toEqual(stickyItem);
  });

  it('тип узла для фигуры — shape, вне зависимости от конкретного shape', () => {
    expect(boardItemToNode(shapeItem).type).toBe('shape');
  });

  it('элементы перетаскиваются и выделяются (12.6), пока не сказано иначе', () => {
    const node = boardItemToNode(stickyItem);
    expect(node.draggable).toBe(true);
    expect(node.selectable).toBe(true);
  });

  it('canEdit=false — элемент выделяется, но не перетаскивается (14.4)', () => {
    // Узловое поле draggable перебивает глобальный :nodes-draggable у <VueFlow>
    // (baseline-регрессия: зритель по ссылке мог визуально таскать карточки)
    const node = boardItemToNode(stickyItem, undefined, false);
    expect(node.draggable).toBe(false);
    expect(node.selectable).toBe(true);
  });

  it('toFlowNodes прокидывает canEdit=false на каждый узел списка (14.4)', () => {
    const nodes = toFlowNodes([stickyItem, shapeItem], false);
    expect(nodes.every((n) => n.draggable === false)).toBe(true);
  });

  it('задаёт style.width/height явно, не только поля width/height (12.7)', () => {
    // Регрессия: @vue-flow/node-resizer после интерактивного резайза сам пишет
    // размер в node.style (updateStyle: true) — без явного style в адаптере это
    // значение навсегда перебивало бы любой последующий программный патч
    // размера (например, принудительный квадрат при конвертации в стикер),
    // потому что Vue Flow берёт style.width, только если он ещё не задан.
    const node = boardItemToNode(stickyItem);
    expect(node.style).toEqual({ width: '160px', height: '120px' });
  });

  it('toFlowNodes переносит список поэлементно', () => {
    expect(toFlowNodes([stickyItem, shapeItem]).map((n) => n.id)).toEqual(['i1', 'i2']);
  });
});

describe('boardEdgeToFlowEdge', () => {
  it('всегда мапится в кастомный тип floating — форма линии решается по data.style.line', () => {
    const edge = boardEdgeToFlowEdge(straightEdge);
    expect(edge.type).toBe('floating');
    expect(edge.source).toBe('i1');
    expect(edge.target).toBe('i2');
    expect(edge.sourceHandle).toBeUndefined();
    expect(edge.label).toBeUndefined();
    expect(boardEdgeToFlowEdge(curvedEdge).type).toBe('floating');
    expect(edge.data?.style.line).toBe('straight');
    expect(boardEdgeToFlowEdge(curvedEdge).data?.style.line).toBe('curved');
  });

  it('переносит подпись и цвет как inline-style с hex из белого списка токенов', () => {
    const edge = boardEdgeToFlowEdge(curvedEdge);
    expect(edge.label).toBe('зависит от');
    expect(edge.style).toMatchObject({ stroke: expect.stringMatching(/^#[0-9a-f]{6}$/i) });
  });

  it('задаёт fill: none явным inline-style, а не полагается на класс .vue-flow__edge-path (15.5)', () => {
    // html-to-image при PNG-экспорте клонирует поддерево <svg> нативным
    // cloneNode(true), внешние CSS-правила (в т.ч. дефолт fill:none из
    // @vue-flow/core/dist/style.css) в клон не попадают — путь без явного
    // inline fill заливается SVG-дефолтом (чёрный), кривая связь превращается
    // в сплошную чёрную кляксу вместо тонкой линии.
    const edge = boardEdgeToFlowEdge(curvedEdge);
    expect(edge.style).toMatchObject({ fill: 'none' });
  });

  it('маппит наконечник arrow в MarkerType Vue Flow цветом самой связи (не общим дефолтом), а dot оставляет неопределённым — рисуется вручную в BoardFloatingEdge, т.к. Vue Flow не умеет такой тип из коробки', () => {
    const arrowEdge: BoardEdge = {
      ...straightEdge,
      style: { ...straightEdge.style, color: '#112233', markerStart: 'dot', markerEnd: 'arrow' },
    };
    const edge = boardEdgeToFlowEdge(arrowEdge);
    expect(edge.markerStart).toBeUndefined();
    expect(edge.markerEnd).toEqual({ type: MarkerType.ArrowClosed, color: '#112233' });
  });

  it('toFlowEdges переносит список поэлементно', () => {
    const edges = toFlowEdges([straightEdge, curvedEdge]);
    expect(edges.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  describe('zIndex связи — персистентное поле, общее пространство с карточками (12.21)', () => {
    // Раньше (в рамках этой же задачи) zIndex связи ВЫЧИСЛЯЛСЯ на лету от
    // подключённых карточек (max(source, target) + 1) — годилось, пока порядок
    // был только «выше своих двух карточек». С появлением ручного
    // передний/задний план для связи (контекстное меню, как у карточек) это
    // больше не работает — стало обычным патчибельным полем самой связи,
    // дефолт при создании считает вызывающий код (`use-board-edges.ts`).
    it('boardEdgeToFlowEdge переносит edge.zIndex как есть', () => {
      expect(boardEdgeToFlowEdge(straightEdge).zIndex).toBe(straightEdge.zIndex);
    });

    it('toFlowEdges переносит zIndex каждой связи независимо', () => {
      const higher: BoardEdge = { ...curvedEdge, zIndex: 99 };
      const edges = toFlowEdges([straightEdge, higher]);
      expect(edges.map((e) => e.zIndex)).toEqual([straightEdge.zIndex, 99]);
    });
  });

  describe('цвет связи не задан (12.9) — резолвится от темы зрителя', () => {
    afterEach(() => {
      theme.value = 'light';
    });

    it('светлая тема — почти чёрный', () => {
      theme.value = 'light';
      const edge: BoardEdge = {
        ...straightEdge,
        style: { ...straightEdge.style, color: undefined },
      };
      expect(boardEdgeToFlowEdge(edge).style).toMatchObject({ stroke: '#1A1A1A' });
    });

    it('тёмная тема — белый', () => {
      theme.value = 'dark';
      const edge: BoardEdge = {
        ...straightEdge,
        style: { ...straightEdge.style, color: undefined },
      };
      expect(boardEdgeToFlowEdge(edge).style).toMatchObject({ stroke: '#FFFFFF' });
    });

    it('заданный явно цвет побеждает тему', () => {
      theme.value = 'dark';
      const edge: BoardEdge = {
        ...straightEdge,
        style: { ...straightEdge.style, color: '#FF0000' },
      };
      expect(boardEdgeToFlowEdge(edge).style).toMatchObject({ stroke: '#FF0000' });
    });
  });
});

describe('boardItemToNode — фреймы и группы (14.3)', () => {
  it('контейнер (frame) без parentId не получает ни parentNode, ни extent', () => {
    // extent: 'parent' сознательно НЕ используется (даже на детях) — ребёнка
    // не клэмпим внутри фрейма физически, чтобы его можно было драгом вытащить
    // наружу (Miro-семантика); приклеивание/открепление решает resolveDragParent
    // на dragStop, а не физическое ограничение Vue Flow во время самого драга
    const node = boardItemToNode(frameItem);
    expect(node.extent).toBeUndefined();
    expect(node.parentNode).toBeUndefined();
  });

  it('дочерний элемент получает parentNode = parentId, но без extent (не клэмпится физически)', () => {
    const node = boardItemToNode(childItem);
    expect(node.parentNode).toBe('f1');
    expect(node.extent).toBeUndefined();
  });

  it('контейнер (group) без parentId тоже без extent', () => {
    const group: BoardItem = { ...frameItem, id: 'g1', content: { type: 'group' } };
    const node = boardItemToNode(group);
    expect(node.extent).toBeUndefined();
    expect(node.parentNode).toBeUndefined();
  });

  it('toFlowNodes сортирует родителей перед дочерними', () => {
    const nodes = toFlowNodes([childItem, frameItem, stickyItem]);
    const ids = nodes.map((n) => n.id);
    expect(ids.indexOf('f1')).toBeLessThan(ids.indexOf('c1'));
  });

  it('toFlowNodes с ребёнком, чей родитель не в списке — не падает', () => {
    const orphan: BoardItem = { ...childItem, parentId: 'missing' };
    const nodes = toFlowNodes([orphan, stickyItem]);
    expect(nodes.map((n) => n.id)).toContain('c1');
  });

  it('дочерний узел получает position ОТНОСИТЕЛЬНО родителя, не абсолютную', () => {
    // Регрессия: Vue Flow трактует Node.position как относительную к parentNode
    // (getXYZPos: computedPosition = position + parentPos) — передача сюда
    // абсолютных item.x/y (как у домена) сдвигала бы ребёнка ДВАЖДЫ на позицию
    // родителя при рендере (визуально "убегал" при группировке/помещении во фрейм)
    const node = boardItemToNode(childItem, frameItem);
    expect(node.position).toEqual({ x: childItem.x - frameItem.x, y: childItem.y - frameItem.y });
  });

  it('toFlowNodes передаёт родителя из общего списка для вычисления относительной позиции', () => {
    const nodes = toFlowNodes([frameItem, childItem]);
    const child = nodes.find((n) => n.id === 'c1')!;
    expect(child.position).toEqual({ x: 20, y: 20 });
  });

  it('верхнеуровневый элемент (parentId: null) — position остаётся абсолютной', () => {
    const node = boardItemToNode(stickyItem);
    expect(node.position).toEqual({ x: stickyItem.x, y: stickyItem.y });
  });
});

describe('createFlowNodesConverter — мемоизация (17.8)', () => {
  it('не поменявшийся элемент отдаёт ТОТ ЖЕ объект Node при повторном вызове', () => {
    const toFlowNodesMemoized = createFlowNodesConverter();
    const first = toFlowNodesMemoized([stickyItem, shapeItem], true);
    const second = toFlowNodesMemoized([stickyItem, shapeItem], true);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it('изменённый (новая ссылка) элемент пересобирается — сосед по массиву не трогается', () => {
    const toFlowNodesMemoized = createFlowNodesConverter();
    const first = toFlowNodesMemoized([stickyItem, shapeItem], true);
    const movedSticky: BoardItem = { ...stickyItem, x: stickyItem.x + 50 };
    const second = toFlowNodesMemoized([movedSticky, shapeItem], true);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.position).toEqual({ x: movedSticky.x, y: movedSticky.y });
    expect(second[1]).toBe(first[1]);
  });

  it('смена canEdit инвалидирует кэш для всех узлов (draggable зависит от него)', () => {
    const toFlowNodesMemoized = createFlowNodesConverter();
    const first = toFlowNodesMemoized([stickyItem], true);
    const second = toFlowNodesMemoized([stickyItem], false);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.draggable).toBe(false);
  });

  it('родитель сменил ссылку (например, подвинулся) — ребёнок пересобирается с новой относительной позицией', () => {
    const toFlowNodesMemoized = createFlowNodesConverter();
    const first = toFlowNodesMemoized([frameItem, childItem], true);
    const movedFrame: BoardItem = { ...frameItem, x: frameItem.x + 30, y: frameItem.y + 10 };
    const second = toFlowNodesMemoized([movedFrame, childItem], true);
    const firstChild = first.find((n) => n.id === 'c1')!;
    const secondChild = second.find((n) => n.id === 'c1')!;
    expect(secondChild).not.toBe(firstChild);
    expect(secondChild.position).toEqual({
      x: childItem.x - movedFrame.x,
      y: childItem.y - movedFrame.y,
    });
  });

  it('элемент, пропавший из снимка, вычищается из кэша, а не растёт бесконечно', () => {
    const toFlowNodesMemoized = createFlowNodesConverter();
    toFlowNodesMemoized([stickyItem, shapeItem], true);
    const second = toFlowNodesMemoized([shapeItem], true);
    expect(second.map((n) => n.id)).toEqual(['i2']);
    // Возвращение того же stickyItem-объекта позже — не должно найти "призрачный"
    // кэш от первого вызова (он был вычищен) и всё равно строит корректный узел
    const third = toFlowNodesMemoized([stickyItem], true);
    expect(third[0]!.id).toBe('i1');
  });

  it('несколько независимых конвертеров не делят кэш друг с другом', () => {
    const converterA = createFlowNodesConverter();
    const converterB = createFlowNodesConverter();
    const a = converterA([stickyItem], true);
    const b = converterB([stickyItem], true);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]).toEqual(b[0]);
  });
});

describe('createFlowEdgesConverter — мемоизация (17.8)', () => {
  afterEach(() => {
    theme.value = 'light';
  });

  it('не поменявшаяся связь отдаёт ТОТ ЖЕ объект Edge при повторном вызове', () => {
    const toFlowEdgesMemoized = createFlowEdgesConverter();
    const first = toFlowEdgesMemoized([straightEdge, curvedEdge]);
    const second = toFlowEdgesMemoized([straightEdge, curvedEdge]);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it('изменённая (новая ссылка) связь пересобирается — сосед не трогается', () => {
    const toFlowEdgesMemoized = createFlowEdgesConverter();
    const first = toFlowEdgesMemoized([straightEdge, curvedEdge]);
    const relabeled: BoardEdge = { ...straightEdge, label: 'новая подпись' };
    const second = toFlowEdgesMemoized([relabeled, curvedEdge]);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.label).toBe('новая подпись');
    expect(second[1]).toBe(first[1]);
  });

  it('смена темы инвалидирует кэш auto-цвета связи, даже если сама связь не изменилась', () => {
    const toFlowEdgesMemoized = createFlowEdgesConverter();
    const autoColorEdge: BoardEdge = {
      ...straightEdge,
      style: { ...straightEdge.style, color: undefined },
    };
    theme.value = 'light';
    const first = toFlowEdgesMemoized([autoColorEdge]);
    expect(first[0]!.style).toMatchObject({ stroke: '#1A1A1A' });
    theme.value = 'dark';
    const second = toFlowEdgesMemoized([autoColorEdge]);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.style).toMatchObject({ stroke: '#FFFFFF' });
  });

  it('смена темы инвалидирует весь кэш разом — не различает по связи, явный цвет тема не задевает по значению', () => {
    // Инвалидация по теме простая (весь кэш разом, не точечно по auto-color
    // связям) — тема переключается редко, не на каждый WS-патч, в отличие от
    // самих связей; усложнять кэш точечной проверкой ради этого не стоит.
    const toFlowEdgesMemoized = createFlowEdgesConverter();
    theme.value = 'light';
    const first = toFlowEdgesMemoized([straightEdge]);
    theme.value = 'dark';
    const second = toFlowEdgesMemoized([straightEdge]);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.style).toEqual(first[0]!.style);
  });

  it('связь, пропавшая из снимка, вычищается из кэша', () => {
    const toFlowEdgesMemoized = createFlowEdgesConverter();
    toFlowEdgesMemoized([straightEdge, curvedEdge]);
    const second = toFlowEdgesMemoized([curvedEdge]);
    expect(second.map((e) => e.id)).toEqual(['e2']);
  });
});
