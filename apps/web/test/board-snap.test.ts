import { describe, expect, it } from 'vitest';

import {
  computeResizeSnapGuides,
  computeSnapGuides,
  SNAP_THRESHOLD_PX,
  type SnapRect,
} from '../src/features/boards/domain/board-snap';

function rect(id: string, x: number, y: number, width = 100, height = 100): SnapRect {
  return { id, x, y, width, height };
}

describe('computeSnapGuides', () => {
  it('возвращает пустой результат, если нет статичных элементов', () => {
    const result = computeSnapGuides([rect('a', 100, 100)], []);
    expect(result.guides).toEqual([]);
    expect(result.positions.size).toBe(0);
  });

  it('не снапит, если расстояние больше порога по обеим осям', () => {
    const result = computeSnapGuides(
      [rect('a', 100, 100)],
      [rect('b', 200, 250)], // 100px по X, 150px по Y — оба дальше порога
    );
    expect(result.positions.size).toBe(0);
    expect(result.guides).toEqual([]);
  });

  it('снапит левый край к левому краю статичного элемента в пределах порога', () => {
    // a: width=100, x=105 → left=105. b: width=20, x=100 → left=100. left diff=5 < 8
    // center: a=155, b=110, diff=45 > 8. right: a=205, b=120, diff=85 > 8
    // Только left-left попадает в порог
    const result = computeSnapGuides(
      [rect('a', 105, 100, 100, 100)],
      [rect('b', 100, 250, 20, 100)],
    );
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]!).toMatchObject({
      orientation: 'vertical',
      position: 100,
      targetIds: ['b'],
      // a: y=100,h=100 → [100,200]; b: y=250,h=100 → [250,350]
      from: 100,
      to: 350,
    });
  });

  it('снапит правый край к правому краю статичного элемента (разные ширины)', () => {
    // a: width=100, x=0, right=100. b: width=50, x=150, right=200. right diff=100 > 8
    // a: left=0, b: left=150, diff=150 > 8. a: center=50, b: center=175, diff=125 > 8
    // Ничего не снапит
    const result = computeSnapGuides([rect('a', 0, 100, 100, 100)], [rect('b', 150, 250, 50, 100)]);
    expect(result.positions.size).toBe(0);
  });

  it('снапит правый край к правому краю при близости (ширины разные)', () => {
    // a: width=100, x=95, right=195. b: width=50, x=150, right=200. right diff=5 < 8
    // a: left=95, b: left=150, diff=55 > 8. a: center=145, b: center=175, diff=30 > 8
    // Только right-right попадает в порог — однозначный снап по правому краю
    const result = computeSnapGuides(
      [rect('a', 95, 100, 100, 100)],
      [rect('b', 150, 250, 50, 100)],
    );
    // snap: newX = 200 - (195 - 95) = 100
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]!).toMatchObject({ orientation: 'vertical', position: 200 });
    // a: y=100,h=100 → [100,200]; b: y=250,h=100 → [250,350]
    expect(result.guides[0]!).toMatchObject({ from: 100, to: 350 });
  });

  it('снапит центр к центру при расстоянии менее порога (разные ширины)', () => {
    // a: width=200, x=48, center=148. b: width=100, x=100, center=150. diff=2 < 8
    // a: left=48, b: left=100, diff=52 > 8. a: right=148, b: right=200, diff=52 > 8
    // Только center-center попадает в порог
    const result = computeSnapGuides(
      [rect('a', 48, 100, 200, 100)],
      [rect('b', 100, 250, 100, 100)],
    );
    // snap: newX = 150 - (148 - 48) = 150 - 100 = 50
    expect(result.positions.get('a')).toEqual({ x: 50, y: 100 });
    expect(result.guides[0]!).toMatchObject({ orientation: 'vertical', position: 150 });
  });

  it('при равных расстояниях выбирает ближайшую точку (left-left побеждает center-center для одинаковых элементов)', () => {
    // a и b одинаковой ширины (100). left diff=3, center diff=3 — равны.
    // Приоритеты одинаковые → выбирается первый в массиве (left)
    const result = computeSnapGuides(
      [rect('a', 103, 100, 100, 100)],
      [rect('b', 100, 250, 100, 100)],
    );
    // snap по левому краю: newX = 100 - (103 - 103) = 100
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.guides[0]!).toMatchObject({ orientation: 'vertical', position: 100 });
    // a: y=100,h=100 → [100,200]; b: y=250,h=100 → [250,350]
    expect(result.guides[0]!).toMatchObject({ from: 100, to: 350 });
  });

  it('снапит вертикально (по Y) — верх к верху', () => {
    // a: y=105, height=100 → top=105, center=155. b: y=100, height=20 → top=100, center=110
    // top-top diff=5 < 8 ✓, center-center diff=45 > 8. Только top попадает в порог
    const result = computeSnapGuides(
      [rect('a', 100, 105, 100, 100)],
      [rect('b', 250, 100, 20, 20)],
    );
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.guides[0]!).toMatchObject({
      orientation: 'horizontal',
      position: 100,
      targetIds: ['b'],
      // a: x=100,w=100 → [100,200]; b: x=250,w=20 → [250,270]
      from: 100,
      to: 270,
    });
  });

  it('снапит по обеим осям одновременно', () => {
    // a: x=103, y=104. b: x=100, y=100. left diff=3, top diff=4, оба < 8
    const result = computeSnapGuides([rect('a', 103, 104)], [rect('b', 100, 100)]);
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.guides).toHaveLength(2);
    const vGuides = result.guides.filter((g) => g.orientation === 'vertical');
    const hGuides = result.guides.filter((g) => g.orientation === 'horizontal');
    expect(vGuides).toHaveLength(1);
    expect(hGuides).toHaveLength(1);
  });

  it('выбирает ближайшую точку при нескольких статичных элементах', () => {
    // a: x=103, b: x=100 (left diff=3), c: x=200 (left diff=97)
    const result = computeSnapGuides(
      [rect('a', 103, 100)],
      [rect('b', 100, 250), rect('c', 200, 250)],
    );
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.guides[0]!.targetIds).toEqual(['b']);
  });

  it('объединяет направляющие в одну, если несколько элементов снапятся к одной позиции', () => {
    // a: width=100, x=102 → left=102. c: width=100, x=101 → left=101. b: width=20, x=100 → left=100
    // a left diff=2, c left diff=1 — оба снапятся на left=100
    // Проверяем центр: a=center=152, b center=110 → diff=42>8. OK, только left
    const result = computeSnapGuides(
      [rect('a', 102, 100, 100, 100), rect('c', 101, 200, 100, 100)],
      [rect('b', 100, 150, 20, 100)],
    );
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.positions.get('c')).toEqual({ x: 100, y: 200 });
    const vGuides = result.guides.filter((g) => g.orientation === 'vertical');
    expect(vGuides).toHaveLength(1);
    expect(vGuides[0]!.targetIds).toEqual(['b']);
  });

  it('пропускает сам себя при сравнении', () => {
    const result = computeSnapGuides(
      [rect('a', 100, 100)],
      [rect('a', 105, 250), rect('b', 200, 250)],
    );
    // a не должен снапиться сам на себя
    expect(result.positions.has('a')).toBe(false);
  });

  it('корректно снапит широкий элемент (правый к правому)', () => {
    // a: width=200, x=0, right=200. b: width=100, x=100, right=200. right diff=0
    // a: left=0, b: left=100, diff=100 > 8. a: center=100, b: center=150, diff=50 > 8
    const result = computeSnapGuides(
      [rect('a', 0, 100, 200, 100)],
      [rect('b', 100, 250, 100, 100)],
    );
    expect(result.positions.get('a')).toEqual({ x: 0, y: 100 });
    expect(result.guides[0]!).toMatchObject({ orientation: 'vertical', position: 200 });
    // a: y=100,h=100 → [100,200]; b: y=250,h=100 → [250,350]
    expect(result.guides[0]!).toMatchObject({ from: 100, to: 350 });
  });

  it('снапит множество элементов в группе к одной линии', () => {
    // a и c оба снапятся на левый край b
    const result = computeSnapGuides(
      [rect('a', 102, 100), rect('c', 105, 300)],
      [rect('b', 100, 200)],
    );
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    expect(result.positions.get('c')).toEqual({ x: 100, y: 300 });
    // Одна вертикальная направляющая на x=100
    const vGuides = result.guides.filter((g) => g.orientation === 'vertical');
    expect(vGuides).toHaveLength(1);
    expect(vGuides[0]!.targetIds).toEqual(['b']);
    // from/to = объединённый Y-диапазон всех трёх rect'ов
    expect(vGuides[0]!).toMatchObject({ from: 100, to: 400 });
  });

  it('from/to соединяют перетаскиваемый и целевой элементы, а не растягиваются на всю доску', () => {
    // a: x=103,w=100 → left=103, center=153, right=203. b: x=100,w=100 → left=100, center=150, right=200
    // Все три ключа в пороге (diff=3), приоритеты равны → snap на left=100 (первый в массиве)
    // from/to = объединённый Y-диапазон всех rect'ов
    const result = computeSnapGuides(
      [rect('a', 103, 100, 100, 100)],
      [rect('b', 100, 1000, 100, 100)],
    );
    expect(result.guides[0]!).toMatchObject({
      orientation: 'vertical',
      position: 100, // b.left победил (первый в массиве X_KEYS при равных приоритетах)
      from: 100, // min(a.y, a.bottom, b.y, b.bottom) = min(100, 200, 1000, 1100) = 100
      to: 1100, // max(100, 200, 1000, 1100) = 1100
    });
  });
});

describe('computeResizeSnapGuides', () => {
  it('снапит правый край (direction=[1,0]) к левому краю статичного элемента, x не двигается', () => {
    // resizing: right=100. b: left=105 (x=105), diff=5 < 8
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      [1, 0],
      [rect('b', 105, 0, 50, 50)],
    );
    expect(result.rect).toMatchObject({ x: 0, y: 0, width: 105, height: 100 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]!).toMatchObject({ orientation: 'vertical', position: 105 });
  });

  it('снапит левый край (direction=[-1,0]), правый край остаётся зафиксирован', () => {
    // resizing: x=50,width=100 → right=150 (анкер). b: left=45, diff=5 < 8
    const result = computeResizeSnapGuides(
      rect('a', 50, 0, 100, 100),
      [-1, 0],
      [rect('b', 45, 0, 20, 20)],
    );
    // right edge (150) должен остаться на месте: x + width = 45 + 105 = 150
    expect(result.rect).toMatchObject({ x: 45, width: 105 });
    expect(result.rect.x + result.rect.width).toBe(150);
  });

  it('не трогает ось, которая не участвует в этом resize-жесте (direction=0 на оси)', () => {
    // direction=[0,1] — только Y активна, X-совпадение (пусть и в пороге) игнорируется
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      [0, 1],
      [rect('b', 103, 0, 100, 100)], // X-края почти совпадают, но X здесь неактивен
    );
    expect(result.rect).toMatchObject({ x: 0, width: 100 });
    expect(result.guides.every((g) => g.orientation !== 'vertical')).toBe(true);
  });

  it('не снапит за пределами порога — rect не меняется, guides пустой', () => {
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      [1, 1],
      [rect('b', 200, 200, 50, 50)],
    );
    expect(result.rect).toEqual(rect('a', 0, 0, 100, 100));
    expect(result.guides).toEqual([]);
  });

  it('lockAspectRatio: при совпадении на обеих осях побеждает более точное, вторая сторона пересчитывается от исходного соотношения', () => {
    // Квадрат 100x100 (сторона стикера), тянут за угол bottom-right ([1,1]).
    // X-совпадение (diff=6) слабее Y-совпадения (diff=3) → выигрывает Y,
    // итоговая высота 103, ширина пересчитывается от ratio=1 тоже в 103 —
    // пропорция стикера не искажается снапом.
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      [1, 1],
      [rect('bx', 106, 0, 10, 10), rect('by', 0, 103, 10, 10)],
      SNAP_THRESHOLD_PX,
      { lockAspectRatio: true },
    );
    expect(result.rect).toMatchObject({ x: 0, y: 0, width: 103, height: 103 });
    // Только Y реально совпал с соседом — X пересчитан от пропорции, не от независимого снапа
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]!.orientation).toBe('horizontal');
  });

  it('lockAspectRatio: без конфликта (совпала только одна ось) вторая сторона всё равно пересчитывается пропорционально', () => {
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      [1, 1],
      [rect('bx', 106, 0, 10, 10)],
      SNAP_THRESHOLD_PX,
      { lockAspectRatio: true },
    );
    expect(result.rect).toMatchObject({ width: 106, height: 106 });
  });
});

describe('SNAP_THRESHOLD_PX', () => {
  it('константа порога доступна для экспорта', () => {
    expect(SNAP_THRESHOLD_PX).toBe(8);
  });
});
