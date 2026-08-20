import type {
  EdgeAnchorParams,
  EdgeGeometryNode,
} from '../src/features/boards/domain/floating-edge-geometry';
import { describe, expect, it } from 'vitest';

import {
  closestSampleIndex,
  getEdgeAnchorParams,
  getOffsetCurvePath,
  lerpEdgeAnchorParams,
  nearestSide,
  offsetAlongNormal,
  tangentAtSample,
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

/** Горизонтальная выборка (0,0)→(100,0) с шагом 25 — прямая линия, 5 точек */
const horizontalSamples = [
  { x: 0, y: 0 },
  { x: 25, y: 0 },
  { x: 50, y: 0 },
  { x: 75, y: 0 },
  { x: 100, y: 0 },
];

describe('closestSampleIndex', () => {
  it('находит индекс ближайшего сэмпла к целевой точке', () => {
    // расстояния до (60,10)²: 3700, 1325, 200, 325, 1700 → минимум у индекса 2 (x=50)
    expect(closestSampleIndex(horizontalSamples, { x: 60, y: 10 })).toBe(2);
  });

  it('точное совпадение с сэмплом даёт его индекс', () => {
    expect(closestSampleIndex(horizontalSamples, { x: 100, y: 0 })).toBe(4);
  });
});

describe('tangentAtSample', () => {
  it('касательная в средней точке горизонтальной прямой — (1,0)', () => {
    expect(tangentAtSample(horizontalSamples, 2)).toEqual({ x: 1, y: 0 });
  });

  it('на границе выборки берёт одностороннюю разность', () => {
    expect(tangentAtSample(horizontalSamples, 0)).toEqual({ x: 1, y: 0 });
    expect(tangentAtSample(horizontalSamples, 4)).toEqual({ x: 1, y: 0 });
  });

  it('диагональная выборка даёт нормализованный диагональный вектор', () => {
    const diagonal = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ];
    const result = tangentAtSample(diagonal, 1);
    expect(result.x).toBeCloseTo(Math.SQRT1_2);
    expect(result.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('вырожденная выборка (совпадающие соседи) — фолбэк (1,0)', () => {
    const degenerate = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    expect(tangentAtSample(degenerate, 0)).toEqual({ x: 1, y: 0 });
  });
});

describe('offsetAlongNormal', () => {
  it('смещает точку вдоль нормали к горизонтальной касательной', () => {
    // tangent=(1,0) → normal=(0,1)
    const result = offsetAlongNormal({ x: 10, y: 0 }, { x: 1, y: 0 }, 5);
    expect(result).toEqual({ x: 10, y: 5 });
  });

  it('отрицательная дистанция смещает в противоположную сторону', () => {
    const result = offsetAlongNormal({ x: 10, y: 0 }, { x: 1, y: 0 }, -5);
    expect(result).toEqual({ x: 10, y: -5 });
  });

  it('смещает точку вдоль нормали к вертикальной касательной', () => {
    // tangent=(0,1) → normal=(-1,0)
    const result = offsetAlongNormal({ x: 0, y: 0 }, { x: 0, y: 1 }, 4);
    expect(result).toEqual({ x: -4, y: 0 });
  });

  it('нулевая дистанция не меняет точку', () => {
    const result = offsetAlongNormal({ x: 3, y: 7 }, { x: 1, y: 0 }, 0);
    expect(result).toEqual({ x: 3, y: 7 });
  });
});

describe('lerpEdgeAnchorParams', () => {
  const from: EdgeAnchorParams = {
    sx: 0,
    sy: 0,
    tx: 100,
    ty: 200,
    sourceSide: 'right',
    targetSide: 'left',
  };
  const to: EdgeAnchorParams = {
    sx: 40,
    sy: 20,
    tx: 140,
    ty: 220,
    sourceSide: 'bottom',
    targetSide: 'top',
  };

  it('t=0 возвращает исходные координаты', () => {
    expect(lerpEdgeAnchorParams(from, to, 0)).toEqual({
      sx: 0,
      sy: 0,
      tx: 100,
      ty: 200,
      sourceSide: 'bottom',
      targetSide: 'top',
    });
  });

  it('t=1 возвращает целевые координаты', () => {
    expect(lerpEdgeAnchorParams(from, to, 1)).toEqual(to);
  });

  it('t=0.5 — середина между координатами', () => {
    expect(lerpEdgeAnchorParams(from, to, 0.5)).toEqual({
      sx: 20,
      sy: 10,
      tx: 120,
      ty: 210,
      sourceSide: 'bottom',
      targetSide: 'top',
    });
  });

  it('sourceSide/targetSide не интерполируются — всегда берутся из to (дискретный выбор, не непрерывная величина)', () => {
    const result = lerpEdgeAnchorParams(from, to, 0);
    expect(result.sourceSide).toBe(to.sourceSide);
    expect(result.targetSide).toBe(to.targetSide);
  });
});

describe('nearestSide', () => {
  /** x=100, y=200, w=60, h=40 → top mid (130,200), right mid (160,220), bottom mid (130,240), left mid (100,220) */
  const rectNode = node({ x: 100, y: 200 }, { width: 60, height: 40 });

  it('точка над карточкой — ближе всего верхняя сторона', () => {
    expect(nearestSide(rectNode, { x: 130, y: 100 })).toBe('top');
  });

  it('точка справа от карточки — ближе всего правая сторона', () => {
    expect(nearestSide(rectNode, { x: 400, y: 220 })).toBe('right');
  });

  it('точка под карточкой — ближе всего нижняя сторона', () => {
    expect(nearestSide(rectNode, { x: 130, y: 500 })).toBe('bottom');
  });

  it('точка слева от карточки — ближе всего левая сторона', () => {
    expect(nearestSide(rectNode, { x: -200, y: 220 })).toBe('left');
  });

  it('точка ровно в центре карточки — детерминированно выбирает одну сторону (без разброса при равных расстояниях)', () => {
    const square = node({ x: 0, y: 0 }, { width: 100, height: 100 });
    expect(nearestSide(square, { x: 50, y: 50 })).toBe('top');
  });
});
