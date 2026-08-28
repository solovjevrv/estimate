import type { BoardItemContent, BoardTextRun } from '@estimate/shared';
import { describe, expect, it } from 'vitest';

import {
  applyMarkToRange,
  getActiveMarks,
  getSelectionOffsets,
  HIGHLIGHT_CSS,
  insertPlainTextAtCaret,
  markCssProperties,
  renderRunsInto,
  runsFromContent,
  runsPlainText,
  selectRange,
  serializeRuns,
  toggleBoolMark,
  truncateRuns,
} from '../src/features/boards/rich-text/board-rich-text';

describe('runsFromContent', () => {
  it('возвращает runs как есть, если они заданы', () => {
    const runs: BoardTextRun[] = [{ text: 'a' }, { text: 'b', marks: { bold: true } }];
    const content: BoardItemContent = { type: 'sticky', text: 'ab', runs };
    expect(runsFromContent(content)).toBe(runs);
  });

  it('строит один run из text, если runs не заданы', () => {
    const content: BoardItemContent = { type: 'sticky', text: 'привет' };
    expect(runsFromContent(content)).toEqual([{ text: 'привет' }]);
  });

  it('пустой text без runs — пустой массив', () => {
    const content: BoardItemContent = { type: 'sticky', text: '' };
    expect(runsFromContent(content)).toEqual([]);
  });

  it('картинка — пустой массив', () => {
    const content: BoardItemContent = {
      type: 'image',
      url: '/api/boards/1/assets/abc.webp',
      width: 100,
      height: 100,
    };
    expect(runsFromContent(content)).toEqual([]);
  });

  it('стикер — пустой массив', () => {
    const content: BoardItemContent = { type: 'sticker', pack: 'ragememes', id: '01' };
    expect(runsFromContent(content)).toEqual([]);
  });
});

describe('runsPlainText', () => {
  it('конкатенирует текст всех runs', () => {
    expect(runsPlainText([{ text: 'При' }, { text: 'вет', marks: { bold: true } }])).toBe('Привет');
  });
});

describe('markCssProperties', () => {
  it('без меток — пустой объект', () => {
    expect(markCssProperties()).toEqual({});
    expect(markCssProperties({})).toEqual({});
  });

  it('bold/italic — отдельные свойства', () => {
    expect(markCssProperties({ bold: true })).toMatchObject({ fontWeight: '800' });
    expect(markCssProperties({ italic: true })).toMatchObject({ fontStyle: 'italic' });
  });

  it('underline+strike объединяются в textDecorationLine', () => {
    expect(markCssProperties({ underline: true, strike: true }).textDecorationLine).toBe(
      'underline line-through',
    );
    expect(markCssProperties({ strike: true }).textDecorationLine).toBe('line-through');
  });

  it('highlight — фон из HIGHLIGHT_CSS', () => {
    expect(markCssProperties({ highlight: 'yellow' }).backgroundColor).toBe(HIGHLIGHT_CSS.yellow);
  });

  it('link — подчёркивание, цвет и курсор, даже без явного underline', () => {
    const css = markCssProperties({ link: 'https://example.com' });
    expect(css.textDecorationLine).toBe('underline');
    expect(css.cursor).toBe('pointer');
    expect(css.color).toBeTruthy();
  });
});

describe('getActiveMarks', () => {
  const runs: BoardTextRun[] = [
    { text: 'Привет ', marks: { bold: true } },
    { text: 'мир', marks: { bold: true, italic: true } },
    { text: '!' },
  ];

  it('метка активна, только если она стоит на ВСЁМ диапазоне', () => {
    // [0,7) — целиком первый run, только bold
    expect(getActiveMarks(runs, 0, 7)).toEqual({ bold: true });
  });

  it('пересечение двух runs с разными метками — общее подмножество', () => {
    // [3,10) пересекает "Привет "(bold) и "мир"(bold+italic) — общее: bold
    expect(getActiveMarks(runs, 3, 10)).toEqual({ bold: true });
  });

  it('диапазон без форматирования — пустой объект', () => {
    expect(getActiveMarks(runs, 10, 11)).toEqual({});
  });

  it('вырожденный диапазон (start>=end) — пустой объект', () => {
    expect(getActiveMarks(runs, 5, 5)).toEqual({});
  });
});

describe('applyMarkToRange / toggleBoolMark', () => {
  it('применяет метку только к части run, разрезая границы', () => {
    const runs: BoardTextRun[] = [{ text: 'Привет мир' }];
    const next = applyMarkToRange(runs, 7, 10, (m) => ({ ...m, bold: true }));
    expect(next).toEqual([{ text: 'Привет ' }, { text: 'мир', marks: { bold: true } }]);
  });

  it('склеивает соседние runs с одинаковыми метками после патча', () => {
    const runs: BoardTextRun[] = [
      { text: 'При', marks: { bold: true } },
      { text: 'вет', marks: { bold: true } },
    ];
    // Патч не меняет метки — при повторной сборке runs должны схлопнуться в один
    const next = applyMarkToRange(runs, 0, 6, (m) => ({ ...m }));
    expect(next).toEqual([{ text: 'Привет', marks: { bold: true } }]);
  });

  it('toggleBoolMark включает метку, если она не стоит равномерно, и выключает, если стоит', () => {
    const runs: BoardTextRun[] = [{ text: 'жирный' }];
    const bolded = toggleBoolMark(runs, 0, 6, 'bold');
    expect(bolded).toEqual([{ text: 'жирный', marks: { bold: true } }]);

    const unbolded = toggleBoolMark(bolded, 0, 6, 'bold');
    expect(unbolded).toEqual([{ text: 'жирный' }]);
  });

  it('вырожденный диапазон не меняет runs', () => {
    const runs: BoardTextRun[] = [{ text: 'текст' }];
    expect(applyMarkToRange(runs, 2, 2, (m) => ({ ...m, bold: true }))).toBe(runs);
  });
});

describe('truncateRuns', () => {
  it('обрезает по максимальной суммарной длине, разрезая run', () => {
    const runs: BoardTextRun[] = [{ text: 'При' }, { text: 'вет', marks: { bold: true } }];
    expect(truncateRuns(runs, 4)).toEqual([{ text: 'При' }, { text: 'в', marks: { bold: true } }]);
  });

  it('отбрасывает runs, полностью выходящие за предел', () => {
    const runs: BoardTextRun[] = [{ text: 'При' }, { text: 'вет' }];
    expect(truncateRuns(runs, 3)).toEqual([{ text: 'При' }]);
  });
});

describe('renderRunsInto / serializeRuns — DOM round-trip', () => {
  function makeEl(): HTMLDivElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  it('обычный текст без меток — один текстовый узел', () => {
    const el = makeEl();
    renderRunsInto(el, [{ text: 'просто текст' }]);
    expect(el.childNodes).toHaveLength(1);
    expect(el.childNodes[0]!.nodeType).toBe(Node.TEXT_NODE);
    expect(serializeRuns(el)).toEqual([{ text: 'просто текст' }]);
  });

  it('форматированный run — span с data-marks, переживает сериализацию обратно', () => {
    const el = makeEl();
    const runs: BoardTextRun[] = [
      { text: 'обычный ' },
      { text: 'жирный', marks: { bold: true, highlight: 'green' } },
      { text: ' конец' },
    ];
    renderRunsInto(el, runs);
    expect(serializeRuns(el)).toEqual(runs);
  });

  it('пустые runs не создают узлов', () => {
    const el = makeEl();
    renderRunsInto(el, [{ text: '' }]);
    expect(el.childNodes).toHaveLength(0);
    expect(serializeRuns(el)).toEqual([]);
  });

  it('перерисовка очищает предыдущее содержимое', () => {
    const el = makeEl();
    renderRunsInto(el, [{ text: 'старое', marks: { italic: true } }]);
    renderRunsInto(el, [{ text: 'новое' }]);
    expect(serializeRuns(el)).toEqual([{ text: 'новое' }]);
  });
});

describe('selectRange / getSelectionOffsets — DOM round-trip', () => {
  function makeEl(runs: BoardTextRun[]): HTMLDivElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    renderRunsInto(el, runs);
    return el;
  }

  it('восстанавливает выделение внутри одного run и считывает те же смещения обратно', () => {
    const el = makeEl([{ text: 'Привет мир' }]);
    selectRange(el, 2, 5);
    expect(getSelectionOffsets(el)).toEqual({ start: 2, end: 5 });
  });

  it('восстанавливает выделение, пересекающее границу форматированного run', () => {
    const el = makeEl([{ text: 'обычный ' }, { text: 'жирный', marks: { bold: true } }]);
    selectRange(el, 5, 12);
    expect(getSelectionOffsets(el)).toEqual({ start: 5, end: 12 });
  });

  it('свёрнутое выделение (start===end) — getSelectionOffsets возвращает null', () => {
    const el = makeEl([{ text: 'текст' }]);
    selectRange(el, 3, 3);
    expect(getSelectionOffsets(el)).toBeNull();
  });
});

describe('insertPlainTextAtCaret', () => {
  it('вставляет текст в точке курсора и продвигает каретку за него', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    renderRunsInto(el, [{ text: 'Привт' }]);
    selectRange(el, 4, 4); // между "Прив" и "т"

    insertPlainTextAtCaret('е');

    expect(el.textContent).toBe('Привет');
    expect(getSelectionOffsets(el)).toBeNull(); // каретка свёрнута после вставки
  });
});
