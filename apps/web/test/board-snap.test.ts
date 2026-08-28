import { describe, expect, it } from 'vitest';

import {
  computeEqualGapGuides,
  computeMeasureGuides,
  computeResizeSnapGuides,
  computeSnapGuides,
  resizeAxisFlags,
  resizeRectFromOrigin,
  SNAP_THRESHOLD_PX,
  type ResizeAxisFlags,
  type SnapRect,
} from '../src/features/boards/domain/board-snap';

function rect(id: string, x: number, y: number, width = 100, height = 100): SnapRect {
  return { id, x, y, width, height };
}

/** `ResizeAxisFlags` для тестов — читается как старый `direction: [dx, dy]`
 * (`x`/`y` — активна ли ось, `invertX`/`invertY` — подвижен ли левый/верхний
 * край), но явно, без знака, который раньше путал рост/сжатие с краем
 * (см. пояснение в `board-snap.ts`). */
function axisFlags(
  x: 'inactive' | 'left' | 'right',
  y: 'inactive' | 'top' | 'bottom',
): ResizeAxisFlags {
  return {
    xActive: x !== 'inactive',
    invertX: x === 'left',
    yActive: y !== 'inactive',
    invertY: y === 'top',
  };
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
    // a: x=103, y=104, 100x100. b: x=100, y=100, 50x50 (разный размер — не
    // должно сработать двустороннее совпадение из 22.5, тестируем только
    // базовый снап по двум осям). left diff=3, top diff=4, оба < 8
    const result = computeSnapGuides(
      [rect('a', 103, 104, 100, 100)],
      [rect('b', 100, 100, 50, 50)],
    );
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
    // a и c оба снапятся на левый край b; у b другая ширина (20, не 100), чтобы
    // не сработало двустороннее совпадение размера из 22.5 — тест проверяет
    // именно объединение нескольких элементов в одну линию
    const result = computeSnapGuides(
      [rect('a', 102, 100), rect('c', 105, 300)],
      [rect('b', 100, 200, 20, 100)],
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

describe('двусторонняя подсветка при совпадении размера — move (22.5)', () => {
  it('показывает гид и для left, и для right, если после снапа совпала ширина', () => {
    // a снапнется по left на b (diff2); у a и b одинаковая ширина 100 —
    // после сдвига right тоже совпадёт с b.right (и center с center), хотя
    // раньше показывался только left (тот, что определил сам сдвиг)
    const result = computeSnapGuides(
      [rect('a', 102, 100, 100, 100)],
      [rect('b', 100, 300, 100, 100)],
    );
    expect(result.positions.get('a')).toEqual({ x: 100, y: 100 });
    const vGuides = result.guides.filter((g) => g.orientation === 'vertical');
    expect(vGuides.map((g) => g.position).sort((x, y) => x - y)).toEqual([100, 150, 200]);
    expect(vGuides.every((g) => g.targetIds.includes('b'))).toBe(true);
  });

  it('не показывает лишний гид при разных размерах — обычный случай, одна линия', () => {
    const result = computeSnapGuides(
      [rect('a', 102, 100, 100, 100)],
      [rect('b', 100, 300, 50, 50)],
    );
    const vGuides = result.guides.filter((g) => g.orientation === 'vertical');
    expect(vGuides).toHaveLength(1);
    expect(vGuides[0]!.position).toBe(100);
  });
});

describe('computeResizeSnapGuides', () => {
  it('снапит правый край (direction=[1,0]) к левому краю статичного элемента, x не двигается', () => {
    // resizing: right=100. b: left=105 (x=105), diff=5 < 8
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      axisFlags('right', 'inactive'),
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
      axisFlags('left', 'inactive'),
      [rect('b', 45, 0, 20, 20)],
    );
    // right edge (150) должен остаться на месте: x + width = 45 + 105 = 150
    expect(result.rect).toMatchObject({ x: 45, width: 105 });
    expect(result.rect.x + result.rect.width).toBe(150);
  });

  it('не трогает ось, которая не участвует в этом resize-жесте (xActive=false)', () => {
    // только Y активна, X-совпадение (пусть и в пороге) игнорируется
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      axisFlags('inactive', 'bottom'),
      [rect('b', 103, 0, 100, 100)], // X-края почти совпадают, но X здесь неактивен
    );
    expect(result.rect).toMatchObject({ x: 0, width: 100 });
    expect(result.guides.every((g) => g.orientation !== 'vertical')).toBe(true);
  });

  it('не снапит за пределами порога — rect не меняется, guides пустой', () => {
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      axisFlags('right', 'bottom'),
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
      axisFlags('right', 'bottom'),
      // bx.y=50 (не 0) — иначе неподвижный верхний край a (y=0) случайно совпал
      // бы с bx.top и добавил вторую (валидную, но не относящуюся к этому
      // тесту) направляющую из 22.5; здесь проверяем только конфликт осей
      [rect('bx', 106, 50, 10, 10), rect('by', 0, 103, 10, 10)],
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
      axisFlags('right', 'bottom'),
      [rect('bx', 106, 0, 10, 10)],
      SNAP_THRESHOLD_PX,
      { lockAspectRatio: true },
    );
    expect(result.rect).toMatchObject({ width: 106, height: 106 });
  });
});

describe('двусторонняя подсветка при совпадении размера — resize (22.5)', () => {
  it('подсвечивает и неподвижный, и активный край, если оба независимо совпали', () => {
    // resizing a: x=0, width=100 → left=0 (анкер, неподвижен — активна правая
    // сторона). Анкер совпадает с правым краем anchorNeighbor (0); активный
    // (правый) край тянется к левому краю activeNeighbor (105) — два разных
    // соседа, оба совпадения независимы друг от друга
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      axisFlags('right', 'inactive'),
      [rect('anchorNeighbor', -20, 200, 20, 20), rect('activeNeighbor', 105, 0, 50, 50)],
    );
    expect(result.rect).toMatchObject({ x: 0, width: 105 });
    const vGuides = result.guides.filter((g) => g.orientation === 'vertical');
    expect(vGuides).toHaveLength(2);
    expect(vGuides.map((g) => g.position).sort((x, y) => x - y)).toEqual([0, 105]);
    expect(vGuides.map((g) => g.targetIds[0]).sort()).toEqual(['activeNeighbor', 'anchorNeighbor']);
  });

  it('без совпадения активного края неподвижный не проверяется — гидов нет', () => {
    // anchorNeighbor.right=0 совпал бы с анкером a.left=0, но активный (правый)
    // край ни с чем не совпадает — по условию задачи оба края должны найти
    // совпадение НЕЗАВИСИМО, одного анкера недостаточно
    const result = computeResizeSnapGuides(
      rect('a', 0, 0, 100, 100),
      axisFlags('right', 'inactive'),
      [rect('anchorNeighbor', -20, 200, 20, 20)],
    );
    expect(result.guides).toEqual([]);
  });
});

describe('SNAP_THRESHOLD_PX', () => {
  it('константа порога доступна для экспорта', () => {
    expect(SNAP_THRESHOLD_PX).toBe(8);
  });
});

describe('resizeAxisFlags (27.08.2026 — регрессия «стикер во фрейме улетает при resize»)', () => {
  const origin = rect('a', 50, 50, 100, 100);

  it('неинвертирующий хендл (bottom-right), РОСТ: x/y резайзера не меняются от старта → invert=false', () => {
    const flags = resizeAxisFlags(50, 50, origin, 50, 50, 140, 130);
    expect(flags).toEqual({ xActive: true, invertX: false, yActive: true, invertY: false });
  });

  it('тот же неинвертирующий хендл, СЖАТИЕ: x/y резайзера всё ещё не меняются → invert=false несмотря на уменьшение размера', () => {
    // Именно этот сценарий раньше давал баг: старый код судил инверсию по
    // знаку роста/сжатия (`direction`), а не по факту движения координаты —
    // сжатие через тот же самый (неподвижный) хендл ошибочно считалось
    // инвертирующим, и x/y пересчитывались, хотя резайзер их не двигал.
    const flags = resizeAxisFlags(50, 50, origin, 50, 50, 70, 80);
    expect(flags).toEqual({ xActive: true, invertX: false, yActive: true, invertY: false });
  });

  it('инвертирующий хендл (top-left), РОСТ: x/y резайзера уходят от старта → invert=true', () => {
    // Рост через top-left — x/y уменьшаются (двигаются от старта)
    const flags = resizeAxisFlags(50, 50, origin, 10, 20, 140, 130);
    expect(flags).toEqual({ xActive: true, invertX: true, yActive: true, invertY: true });
  });

  it('тот же инвертирующий хендл, СЖАТИЕ: x/y резайзера всё ещё уходят от старта → invert=true', () => {
    const flags = resizeAxisFlags(50, 50, origin, 80, 70, 70, 80);
    expect(flags).toEqual({ xActive: true, invertX: true, yActive: true, invertY: true });
  });

  it('чистое вертикальное перетаскивание — width не меняется → xActive=false', () => {
    const flags = resizeAxisFlags(50, 50, origin, 50, 50, 100, 130);
    expect(flags).toEqual({ xActive: false, invertX: false, yActive: true, invertY: false });
  });
});

describe('resizeRectFromOrigin', () => {
  const origin = rect('a', 50, 50, 100, 100);

  it('неинвертирующий хендл: x/y не двигаются ни при росте, ни при сжатии', () => {
    const flags: ResizeAxisFlags = { xActive: true, invertX: false, yActive: true, invertY: false };
    expect(resizeRectFromOrigin(origin, 140, 130, flags)).toMatchObject({
      x: 50,
      y: 50,
      width: 140,
      height: 130,
    });
    expect(resizeRectFromOrigin(origin, 70, 80, flags)).toMatchObject({
      x: 50,
      y: 50,
      width: 70,
      height: 80,
    });
  });

  it('инвертирующий хендл: противоположный край (right/bottom) остаётся на месте', () => {
    const flags: ResizeAxisFlags = { xActive: true, invertX: true, yActive: true, invertY: true };
    // origin: right=150, bottom=150
    const grown = resizeRectFromOrigin(origin, 140, 130, flags);
    expect(grown.x + grown.width).toBe(150);
    expect(grown.y + grown.height).toBe(150);
    const shrunk = resizeRectFromOrigin(origin, 70, 80, flags);
    expect(shrunk.x + shrunk.width).toBe(150);
    expect(shrunk.y + shrunk.height).toBe(150);
  });

  it('оси независимы: инверсия по X не задевает Y и наоборот', () => {
    const flags: ResizeAxisFlags = { xActive: true, invertX: true, yActive: true, invertY: false };
    const result = resizeRectFromOrigin(origin, 70, 80, flags);
    expect(result.x + result.width).toBe(150); // X инвертирован — правый край фиксирован
    expect(result.y).toBe(50); // Y не инвертирован — верх фиксирован
  });
});

describe('равные отступы (gap) — 22.6', () => {
  it('(a) зазор до соседа совпал с эталонным зазором ГДЕ-ТО ЕЩЁ на доске — снапит и подсвечивает оба', () => {
    // Эталон: A(0..100) и B(300..400) — статичная пара, gap=200.
    // Перетаскиваемый d изначально x=498..598, справа сосед D(800..900):
    // gapRight = 800-598=202, diff=2 < 8 — совпало с эталонным 200.
    // Слева тоже есть сосед (B, gap=98), но diff=102 — мимо порога, не мешает.
    const A = rect('A', 0, 0, 100, 100);
    const B = rect('B', 300, 0, 100, 100);
    const D = rect('D', 800, 0, 100, 100);
    const dragged = rect('d', 498, 0, 100, 100);

    const result = computeEqualGapGuides([dragged], [A, B, D]);

    // Снап делает зазор РОВНО 200: новый d.x = 800 - 200 - 100 = 500
    expect(result.positions.get('d')).toEqual({ x: 500, y: 0 });
    expect(result.guides).toHaveLength(2);
    expect(result.guides.every((g) => g.axis === 'horizontal' && g.gap === 200)).toBe(true);
    // Один гид — сам зазор d↔D (после снапа: 600..800), другой — эталонный A↔B (100..300)
    const spans = result.guides.map((g) => [g.from, g.to]).sort((a, b) => a[0]! - b[0]!);
    expect(spans).toEqual([
      [100, 300],
      [600, 800],
    ]);
  });

  it('(b) распределение поровну: d между двумя статичными соседями с почти равными зазорами', () => {
    // L(0..100), d(150..200) — gapLeft=50; R(254..354) — gapRight=54, diff=4 < 8.
    // Снап выставляет оба зазора РОВНО по среднему (52): d.x = 100+52 = 152
    const L = rect('L', 0, 0, 100, 100);
    const R = rect('R', 254, 0, 100, 100);
    const dragged = rect('d', 150, 0, 50, 50);

    const result = computeEqualGapGuides([dragged], [L, R]);

    expect(result.positions.get('d')).toEqual({ x: 152, y: 0 });
    expect(result.guides).toHaveLength(2);
    expect(result.guides.every((g) => g.gap === 52)).toBe(true);
    const spans = result.guides.map((g) => [g.from, g.to]).sort((a, b) => a[0]! - b[0]!);
    // L↔d: 100..152; d↔R: 202..254
    expect(spans).toEqual([
      [100, 152],
      [202, 254],
    ]);
  });

  it('(b) приоритетнее (a): если d между соседями и их зазоры уже близки, эталон где-то ещё игнорируется', () => {
    // Эталон где-то на доске: E(0..100), F(300..400), gap=200 — намеренно
    // ДАЛЕКО от d, чтобы не совпасть ни с одним из её собственных зазоров.
    // d между L и R с близкими зазорами (тест (b)) — должен сработать именно
    // «распределение», а не искать совпадение с эталонным 200.
    const E = rect('E', 0, 1000, 100, 100);
    const F = rect('F', 300, 1000, 100, 100);
    const L = rect('L', 0, 0, 100, 100);
    const R = rect('R', 254, 0, 100, 100);
    const dragged = rect('d', 150, 0, 50, 50);

    const result = computeEqualGapGuides([dragged], [E, F, L, R]);

    expect(result.positions.get('d')).toEqual({ x: 152, y: 0 });
    expect(result.guides.filter((g) => g.gap === 52)).toHaveLength(2);
    expect(result.guides.some((g) => g.gap === 200)).toBe(false);
  });

  it('нет совпадения — зазор дальше порога, guides и positions пустые', () => {
    const A = rect('A', 0, 0, 100, 100);
    const B = rect('B', 300, 0, 100, 100); // gap A↔B = 200
    const D = rect('D', 900, 0, 100, 100); // gap d↔D = 900-598=302, diff=102
    const dragged = rect('d', 498, 0, 100, 100);

    const result = computeEqualGapGuides([dragged], [A, B, D]);

    expect(result.guides).toEqual([]);
    expect(result.positions.size).toBe(0);
  });

  it('меньше 3 объектов на доске — нет эталонных зазоров, результат пустой', () => {
    const A = rect('A', 0, 0, 100, 100);
    const dragged = rect('d', 300, 0, 100, 100);

    const result = computeEqualGapGuides([dragged], [A]);

    expect(result.guides).toEqual([]);
    expect(result.positions.size).toBe(0);
  });

  it('ось Y работает так же, как X (зеркально) — эталонный зазор по вертикали', () => {
    // Эталон: A(0..100) и B(300..400) по Y, gap=200.
    // d снизу от статичного D по вертикали, gapTop к D почти равен эталону.
    const A = rect('A', 0, 0, 100, 100);
    const B = rect('B', 0, 300, 100, 100);
    const D = rect('D', 0, 800, 100, 100);
    const dragged = rect('d', 0, 498, 100, 100);

    const result = computeEqualGapGuides([dragged], [A, B, D]);

    expect(result.positions.get('d')).toEqual({ x: 0, y: 500 });
    expect(result.guides.every((g) => g.axis === 'vertical' && g.gap === 200)).toBe(true);
  });

  it('игнорирует соседей, не пересекающихся по перпендикулярной оси (разные «строки»/«столбцы»)', () => {
    // D формально «справа» от d по X, но их Y-диапазоны не пересекаются —
    // не сосед в этом смысле, gapRight не должен считаться вовсе.
    const A = rect('A', 0, 0, 100, 100);
    const B = rect('B', 300, 0, 100, 100); // gap A↔B = 200 (эталон)
    const D = rect('D', 800, 5000, 100, 100); // далеко по Y — не «сосед» d
    const dragged = rect('d', 498, 0, 100, 100);

    const result = computeEqualGapGuides([dragged], [A, B, D]);

    expect(result.guides).toEqual([]);
    expect(result.positions.size).toBe(0);
  });
});

describe('линейка точных расстояний (Alt/Option) — 22.8', () => {
  it('показывает зазор до ближайшего соседа с каждой из 4 сторон, БЕЗ порога совпадения', () => {
    // d окружён соседями со всех сторон разными, ничем не связанными зазорами —
    // в отличие от computeEqualGapGuides здесь совпадение не требуется вовсе.
    // d: x=200,y=200,w=100,h=100 → left=200,right=300,top=200,bottom=300
    const left = rect('L', 0, 200, 100, 100); // right=100, gapLeft = 200-100=100
    const right = rect('R', 450, 200, 100, 100); // gapRight = 450-300=150
    const top = rect('T', 200, 0, 100, 100); // bottom=100, gapTop = 200-100=100
    const bottom = rect('B', 200, 500, 100, 100); // gapBottom = 500-300=200
    const dragged = rect('d', 200, 200, 100, 100);

    const result = computeMeasureGuides([dragged], [left, right, top, bottom]);

    expect(result).toHaveLength(4);
    const byAxis = (axis: 'horizontal' | 'vertical') => result.filter((g) => g.axis === axis);
    expect(
      byAxis('horizontal')
        .map((g) => g.gap)
        .sort((a, b) => a - b),
    ).toEqual([100, 150]);
    expect(
      byAxis('vertical')
        .map((g) => g.gap)
        .sort((a, b) => a - b),
    ).toEqual([100, 200]);
  });

  it('без соседей с какой-то стороны — просто нет гида на эту сторону, не падает', () => {
    const right = rect('right', 300, 0, 100, 100);
    const dragged = rect('d', 0, 0, 100, 100);

    const result = computeMeasureGuides([dragged], [right]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ axis: 'horizontal', gap: 200 });
  });

  it('без единого соседа — пустой результат', () => {
    const dragged = rect('d', 0, 0, 100, 100);
    expect(computeMeasureGuides([dragged], [])).toEqual([]);
  });

  it('не считает соседей, не пересекающихся по перпендикулярной оси', () => {
    const farRow = rect('far', 300, 5000, 100, 100); // formально справа, но другая «строка»
    const dragged = rect('d', 0, 0, 100, 100);

    expect(computeMeasureGuides([dragged], [farRow])).toEqual([]);
  });
});
