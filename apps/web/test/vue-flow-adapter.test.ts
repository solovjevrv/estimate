import type { BoardEdge, BoardItem } from '@poker/shared';
import { MarkerType } from '@vue-flow/core';
import { describe, expect, it } from 'vitest';

import {
  boardEdgeToFlowEdge,
  boardItemToNode,
  toFlowEdges,
  toFlowNodes,
} from '../src/lib/board/vue-flow-adapter';

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
  style: { color: '#7DA9F6', line: 'straight', markerStart: 'none', markerEnd: 'none' },
};

const curvedEdge: BoardEdge = {
  ...straightEdge,
  id: 'e2',
  label: 'зависит от',
  style: { color: '#FFB8E8', line: 'curved', markerStart: 'none', markerEnd: 'none' },
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

  it('элементы перетаскиваются и выделяются (12.6)', () => {
    const node = boardItemToNode(stickyItem);
    expect(node.draggable).toBe(true);
    expect(node.selectable).toBe(true);
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
    expect(toFlowEdges([straightEdge, curvedEdge]).map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});
