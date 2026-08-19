import type {
  EdgeAnchorParams,
  EdgeGeometryNode,
} from '../src/features/boards/domain/floating-edge-geometry';
import { describe, expect, it } from 'vitest';

import {
  getEdgeAnchorParams,
  getOffsetCurvePath,
} from '../src/features/boards/domain/floating-edge-geometry';

function node(
  position: { x: number; y: number },
  dimensions: { width: number; height: number },
): EdgeGeometryNode {
  return { computedPosition: position, dimensions };
}

/** Прямоугольник с ненулевыми x/y: x=100, y=200, w=60, h=40 */
const source = node({ x: 100, y: 200 }, { width: 60, height: 40 });
/** Целевой узел: x=300, y=200, w=80, h:60 */
const target = node({ x: 300, y: 200 }, { width: 80, height: 60 });

describe('getEdgeAnchorParams — source sides', () => {
  it('top: середина верхней стороны (x + w/2, y)', () => {
    const params = getEdgeAnchorParams(source, target, 'top', 'left');
    expect(params.sourceSide).toBe('top');
    expect(params).toMatchObject({ sx: 130, sy: 200 });
  });

  it('right: середина правой стороны (x + w, y + h/2)', () => {
    const params = getEdgeAnchorParams(source, target, 'right', 'left');
    expect(params.sourceSide).toBe('right');
    expect(params).toMatchObject({ sx: 160, sy: 220 });
  });

  it('bottom: середина нижней стороны (x + w/2, y + h)', () => {
    const params = getEdgeAnchorParams(source, target, 'bottom', 'left');
    expect(params.sourceSide).toBe('bottom');
    expect(params).toMatchObject({ sx: 130, sy: 240 });
  });

  it('left: середина левой стороны (x, y + h/2)', () => {
    const params = getEdgeAnchorParams(source, target, 'left', 'left');
    expect(params.sourceSide).toBe('left');
    expect(params).toMatchObject({ sx: 100, sy: 220 });
  });
});

describe('getEdgeAnchorParams — target sides', () => {
  it('top: середина верхней стороны целевого узла', () => {
    const params = getEdgeAnchorParams(source, target, 'right', 'top');
    expect(params.targetSide).toBe('top');
    // target x=300, w=80, h=60 → top midpoint (340, 200)
    expect(params).toMatchObject({ tx: 340, ty: 200 });
  });

  it('right: середина правой стороны (x + w, y + h/2)', () => {
    const params = getEdgeAnchorParams(source, target, 'right', 'right');
    expect(params.targetSide).toBe('right');
    expect(params).toMatchObject({ tx: 380, ty: 230 });
  });

  it('bottom: середина нижней стороны (x + w/2, y + h)', () => {
    const params = getEdgeAnchorParams(source, target, 'right', 'bottom');
    expect(params.targetSide).toBe('bottom');
    expect(params).toMatchObject({ tx: 340, ty: 260 });
  });

  it('left: середина левой стороны (x, y + h/2)', () => {
    const params = getEdgeAnchorParams(source, target, 'right', 'left');
    expect(params.targetSide).toBe('left');
    expect(params).toMatchObject({ tx: 300, ty: 230 });
  });
});

describe('getEdgeAnchorParams — fallback handles', () => {
  it('source null/undefined/unknown → right (fallback)', () => {
    expect(getEdgeAnchorParams(source, target, null, 'left').sourceSide).toBe('right');
    expect(getEdgeAnchorParams(source, target, undefined, 'left').sourceSide).toBe('right');
    expect(getEdgeAnchorParams(source, target, 'diagonal', 'left').sourceSide).toBe('right');
  });

  it('target null/undefined/unknown → left (fallback)', () => {
    expect(getEdgeAnchorParams(source, target, 'right', null).targetSide).toBe('left');
    expect(getEdgeAnchorParams(source, target, 'right', undefined).targetSide).toBe('left');
    expect(getEdgeAnchorParams(source, target, 'right', 'weird').targetSide).toBe('left');
  });

  it('source target с нулевыми handle оба попадают на fallback', () => {
    const params = getEdgeAnchorParams(source, target, null, null);
    expect(params.sourceSide).toBe('right');
    expect(params.targetSide).toBe('left');
    expect(params).toMatchObject({ sx: 160, sy: 220, tx: 300, ty: 230 });
  });
});

describe('getEdgeAnchorParams — чистота границы', () => {
  it('результат содержит sourceSide/targetSide, а не Vue Flow Position', () => {
    const params: EdgeAnchorParams = getEdgeAnchorParams(source, target, 'top', 'bottom');
    // Нет полей Vue Flow в результате геометрии
    expect('sourcePosition' in params).toBe(false);
    expect('targetPosition' in params).toBe(false);
    expect(params.sourceSide).toBe('top');
    expect(params.targetSide).toBe('bottom');
  });

  it('функция не зависит от Vue Flow: работает с чистыми plain-объектами', () => {
    const params = getEdgeAnchorParams(
      { computedPosition: { x: 0, y: 0 }, dimensions: { width: 10, height: 10 } },
      { computedPosition: { x: 100, y: 0 }, dimensions: { width: 10, height: 10 } },
      'right',
      'left',
    );
    expect(params).toMatchObject({ sx: 10, sy: 5, tx: 100, ty: 5 });
  });
});

describe('getOffsetCurvePath', () => {
  it('apex-точка на кривой совпадает с straightMid + offset', () => {
    const [, labelX, labelY] = getOffsetCurvePath(0, 0, 100, 0, { x: 10, y: -20 });
    expect(labelX).toBe(60); // midX=50 + offset.x=10
    expect(labelY).toBe(-20); // midY=0 + offset.y=-20
  });

  it('control point в SVG-пути смещён вдвое относительно apex', () => {
    const [path] = getOffsetCurvePath(0, 0, 100, 0, { x: 10, y: -20 });
    expect(path).toBe('M0,0 Q70,-40 100,0'); // controlX=50+20=70, controlY=0-40=-40
  });

  it('нулевое смещение даёт путь через геометрическую середину', () => {
    const [path, labelX, labelY] = getOffsetCurvePath(0, 0, 100, 0, { x: 0, y: 0 });
    expect(path).toBe('M0,0 Q50,0 100,0');
    expect(labelX).toBe(50);
    expect(labelY).toBe(0);
  });
});
