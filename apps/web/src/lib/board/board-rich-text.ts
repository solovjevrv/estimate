/**
 * Форматирование текста по выделению (12.13) — стикеры/фигуры хранят текст
 * как массив `BoardTextRun` (непрерывные фрагменты с одинаковым набором
 * меток), а не сырой HTML: рендерим программно (`<span>`/`<a>`, собранные
 * кодом), поэтому не нужен `v-html` и санитайзер — тот же принцип «белый
 * список токенов», что уже используют `fontFamily`/`textAlign`/цвет (12.7/12.9).
 *
 * Contenteditable-элемент — единственный источник правды во время
 * редактирования (без постоянно синхронизируемого reactive-стейта): DOM
 * читается через `serializeRuns()` только когда реально нужно (переключение
 * форматирования, коммит), а не на каждый ввод символа. DOM-«форма» строго
 * контролируется — только текстовые узлы и `<span data-marks="...">`
 * (JSON форматирования во `data`-атрибуте, не парсинг computed style назад)
 * — Enter/paste перехватываются и вставляются вручную через Range API, чтобы
 * браузер никогда не добавил свои `<div>`/`<br>`/скопированную разметку.
 */
import type { Ref } from 'vue';

import type {
  BoardHighlightColor,
  BoardItemContent,
  BoardTextMark,
  BoardTextRun,
} from '@poker/shared';

/**
 * DOM-узел, уход фокуса в который НЕ должен коммитить редактирование текста
 * (12.13) — используется в двух местах (`use-rich-text-editing.ts#onEditableBlur`
 * и `use-board-hotkeys.ts#isEditableTarget`, обе проверки обязаны совпадать).
 *
 * Сознательно узкий, не «весь `BoardSelectionToolbar`» — более ранняя версия
 * матчила `.board-selection-toolbar` целиком и тем самым защищала от коммита
 * ЛЮБОЙ клик по тулбару (Цвет/Форма/Дублировать/Удалить), хотя эти кнопки не
 * зависят от `editableEl` и не должны мешать обычному коммиту-на-blur — из-за
 * этого клик «Дублировать» посреди набора текста больше не сохранял черновик
 * (правильный коммит просто не срабатывал), а глобальные хоткеи переставали
 * работать после любого клика по тулбару, пока фокус не уходил ещё куда-то.
 * Найдено ревью, не живой проверкой — сценарий («выделить, начать печатать,
 * кликнуть Дублировать не блюрясь явно») не был в ручных тестах.
 *
 * Кнопки, которым ДЕЙСТВИТЕЛЬНО нужно не отпускать фокус с contenteditable
 * (начертание/маркер/триггер ссылки), гасят `mousedown.prevent` в
 * `BoardSelectionToolbar.vue` — тогда фокус физически не уходит, и эта
 * проверка вообще не требуется. Единственное МЕСТО, где фокус обязан уйти
 * по-настоящему — поле URL ссылки (туда нужно печатать) — и только его попап
 * несёт `data-board-text-toolbar`. Reka телепортирует содержимое попапа в
 * `document.body`, вне поддерева тулбара — поэтому нужен явный атрибут, не
 * просто класс родителя.
 */
export const BOARD_TEXT_TOOLBAR_SELECTOR = '[data-board-text-toolbar]';

/**
 * Мост между тулбаром выделения (живёт в `BoardCanvas.vue`, зум-независимые
 * экранные координаты) и contenteditable внутри конкретного узла Vue Flow
 * (`BoardStickyNode.vue`/`BoardShapeNode.vue`) — тот же provide/inject-приём,
 * что уже используют `BOARD_PENDING_EDIT_ID_KEY` и соседи (`board-canvas-keys.ts`).
 * Узел, входящий в редактирование текста, публикует сюда свой хэндл; тулбар
 * читает `activeMarks` (пресс-стейт кнопок) и дёргает методы, не зная ничего
 * про DOM конкретного узла.
 */
export interface BoardTextEditorHandle {
  itemId: string;
  /** `null` — нет активного (не свёрнутого) выделения текста внутри элемента */
  activeMarks: Ref<BoardTextMark | null>;
  toggle(key: 'bold' | 'italic' | 'underline' | 'strike'): void;
  setHighlight(color: BoardHighlightColor | null): void;
  setLink(url: string | null): void;
}

/**
 * Стикеры/фигуры сами закрашены пастельным цветом (не белым, как страница
 * обычного текстового редактора) — полупрозрачная заливка того же тона легко
 * тонет в фоне карточки (нашли на живой проверке: жёлтый маркер на дефолтном
 * жёлтом стикере `#FCEB96` почти не читался). Насыщенность/непрозрачность
 * заметно выше «книжного» маркера, плюс тонкая тёмная обводка (`markCssProperties`)
 * — граница держит контраст даже когда заливка и маркер близки по тону.
 */
export const HIGHLIGHT_CSS: Record<BoardHighlightColor, string> = {
  yellow: 'rgb(255 209 26 / 88%)',
  green: 'rgb(74 214 110 / 82%)',
  blue: 'rgb(77 150 250 / 78%)',
  pink: 'rgb(240 84 165 / 78%)',
};

const MARK_KEYS = ['bold', 'italic', 'underline', 'strike'] as const;
type BoolMarkKey = (typeof MARK_KEYS)[number];

export function runsFromContent(content: BoardItemContent): BoardTextRun[] {
  // Картинка и эмодзи не имеют текстового содержимого — возвращаем пустой массив
  if (content.type === 'image' || content.type === 'emoji') return [];
  if (content.runs && content.runs.length > 0) return content.runs;
  return content.text ? [{ text: content.text }] : [];
}

export function runsPlainText(runs: BoardTextRun[]): string {
  return runs.map((run) => run.text).join('');
}

function marksEqual(a?: BoardTextMark, b?: BoardTextMark): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function hasMarks(marks?: BoardTextMark): marks is BoardTextMark {
  return !!marks && Object.keys(marks).length > 0;
}

/**
 * CSS для одного run — используется и для отрисовки в contenteditable
 * (`Object.assign(el.style, ...)`, принимает camelCase-свойства как и любое
 * присваивание `HTMLElement.style`), и для режима просмотра (`:style` в Vue,
 * которому нужен обычный `Record<string,string>`, а не `CSSStyleDeclaration`
 * с её нестроковыми методами).
 */
export function markCssProperties(marks?: BoardTextMark): Record<string, string> {
  if (!hasMarks(marks)) return {};
  const css: Record<string, string> = {};
  if (marks.bold) css.fontWeight = '800';
  if (marks.italic) css.fontStyle = 'italic';
  const decorations = [
    marks.underline || marks.link ? 'underline' : '',
    marks.strike ? 'line-through' : '',
  ].filter(Boolean);
  if (decorations.length > 0) css.textDecorationLine = decorations.join(' ');
  if (marks.highlight) {
    css.backgroundColor = HIGHLIGHT_CSS[marks.highlight];
    css.borderRadius = '3px';
    // Тонкая тёмная граница держит видимость независимо от того, насколько
    // маркер близок по тону к заливке стикера/фигуры под ним
    css.boxShadow = 'inset 0 0 0 1px rgb(0 0 0 / 18%)';
  }
  if (marks.link) {
    css.color = 'var(--ui-primary)';
    css.cursor = 'pointer';
  }
  return css;
}

/** Разбивает `runs` на границе символьной позиции `pos` (не трогает уже совпадающие границы) */
function splitAt(runs: BoardTextRun[], pos: number): BoardTextRun[] {
  let acc = 0;
  const out: BoardTextRun[] = [];
  for (const run of runs) {
    const len = run.text.length;
    if (pos > acc && pos < acc + len) {
      const cut = pos - acc;
      out.push({ text: run.text.slice(0, cut), ...(run.marks ? { marks: run.marks } : {}) });
      out.push({ text: run.text.slice(cut), ...(run.marks ? { marks: run.marks } : {}) });
    } else {
      out.push(run);
    }
    acc += len;
  }
  return out;
}

function splitRunsAt(runs: BoardTextRun[], positions: number[]): BoardTextRun[] {
  let result = runs;
  for (const pos of [...new Set(positions)].sort((a, b) => a - b)) {
    result = splitAt(result, pos);
  }
  return result;
}

function normalizeMarks(marks: BoardTextMark): BoardTextMark | undefined {
  const clean: BoardTextMark = {};
  if (marks.bold) clean.bold = true;
  if (marks.italic) clean.italic = true;
  if (marks.underline) clean.underline = true;
  if (marks.strike) clean.strike = true;
  if (marks.highlight) clean.highlight = marks.highlight;
  if (marks.link) clean.link = marks.link;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function mergeAdjacentRuns(runs: BoardTextRun[]): BoardTextRun[] {
  const out: BoardTextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const last = out[out.length - 1];
    if (last && marksEqual(last.marks, run.marks)) {
      last.text += run.text;
    } else {
      out.push(run.marks ? { text: run.text, marks: run.marks } : { text: run.text });
    }
  }
  return out;
}

/** Метки, единые для ВСЕГО диапазона [start,end) — пресс-стейт кнопок тулбара */
export function getActiveMarks(runs: BoardTextRun[], start: number, end: number): BoardTextMark {
  if (start >= end) return {};
  let acc = 0;
  const inRange: (BoardTextMark | undefined)[] = [];
  for (const run of runs) {
    const s = acc;
    const e = acc + run.text.length;
    acc = e;
    if (e <= start || s >= end || run.text.length === 0) continue;
    inRange.push(run.marks);
  }
  if (inRange.length === 0) return {};
  const result: BoardTextMark = {};
  for (const key of MARK_KEYS) {
    if (inRange.every((m) => !!m?.[key])) result[key] = true;
  }
  const firstHighlight = inRange[0]?.highlight;
  if (firstHighlight && inRange.every((m) => m?.highlight === firstHighlight)) {
    result.highlight = firstHighlight;
  }
  const firstLink = inRange[0]?.link;
  if (firstLink && inRange.every((m) => m?.link === firstLink)) {
    result.link = firstLink;
  }
  return result;
}

/** Применяет `patch` к каждому run строго внутри [start,end), разрезая границы */
export function applyMarkToRange(
  runs: BoardTextRun[],
  start: number,
  end: number,
  patch: (marks: BoardTextMark) => BoardTextMark,
): BoardTextRun[] {
  if (start >= end) return runs;
  const split = splitRunsAt(runs, [start, end]);
  let acc = 0;
  const patched = split.map((run) => {
    const s = acc;
    const e = acc + run.text.length;
    acc = e;
    if (s >= start && e <= end && run.text.length > 0) {
      const nextMarks = normalizeMarks(patch(run.marks ?? {}));
      return nextMarks ? { text: run.text, marks: nextMarks } : { text: run.text };
    }
    return run;
  });
  return mergeAdjacentRuns(patched);
}

export function toggleBoolMark(
  runs: BoardTextRun[],
  start: number,
  end: number,
  key: BoolMarkKey,
): BoardTextRun[] {
  const active = getActiveMarks(runs, start, end);
  return applyMarkToRange(runs, start, end, (marks) => ({ ...marks, [key]: !active[key] }));
}

export function truncateRuns(runs: BoardTextRun[], maxLength: number): BoardTextRun[] {
  let remaining = maxLength;
  const out: BoardTextRun[] = [];
  for (const run of runs) {
    if (remaining <= 0) break;
    const text = run.text.slice(0, remaining);
    remaining -= text.length;
    if (text.length > 0) out.push(run.marks ? { text, marks: run.marks } : { text });
  }
  return out;
}

// --- DOM: contenteditable рендер/сериализация (только для режима редактирования) ---

function createRunNode(run: BoardTextRun): Text | HTMLSpanElement {
  if (!hasMarks(run.marks)) return document.createTextNode(run.text);
  const span = document.createElement('span');
  span.dataset.marks = JSON.stringify(run.marks);
  span.textContent = run.text;
  Object.assign(span.style, markCssProperties(run.marks));
  return span;
}

export function renderRunsInto(el: HTMLElement, runs: BoardTextRun[]): void {
  el.textContent = '';
  for (const run of runs) {
    if (run.text.length === 0) continue;
    el.appendChild(createRunNode(run));
  }
}

/** Читает текущее состояние contenteditable обратно в `runs` — единственный источник правды в момент вызова */
export function serializeRuns(el: HTMLElement): BoardTextRun[] {
  const runs: BoardTextRun[] = [];
  for (const node of Array.from(el.childNodes)) {
    let text = '';
    let marks: BoardTextMark | undefined;
    if (node.nodeType === Node.TEXT_NODE) {
      text = node.textContent ?? '';
    } else if (node instanceof HTMLElement) {
      text = node.textContent ?? '';
      if (node.dataset.marks) {
        try {
          marks = JSON.parse(node.dataset.marks) as BoardTextMark;
        } catch {
          marks = undefined;
        }
      }
    }
    if (text.length === 0) continue;
    const last = runs[runs.length - 1];
    if (last && marksEqual(last.marks, marks)) {
      last.text += text;
    } else {
      runs.push(marks ? { text, marks } : { text });
    }
  }
  return runs;
}

/** Символьное смещение узла+offset относительно всего текста `root` (для Range → [start,end)) */
function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').length;
  let sum = 0;
  node.childNodes.forEach((child) => (sum += textLength(child)));
  return sum;
}

function computeOffset(root: Node, target: Node, targetOffset: number): number {
  let total = 0;
  let found = -1;
  function walk(node: Node): boolean {
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        total += targetOffset;
      } else {
        const children = Array.from(node.childNodes);
        for (let i = 0; i < targetOffset && i < children.length; i++) {
          total += textLength(children[i]!);
        }
      }
      found = total;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent ?? '').length;
      return false;
    }
    for (const child of Array.from(node.childNodes)) {
      if (walk(child)) return true;
    }
    return false;
  }
  walk(root);
  return found === -1 ? total : found;
}

export function getSelectionOffsets(el: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;
  const a = computeOffset(el, range.startContainer, range.startOffset);
  const b = computeOffset(el, range.endContainer, range.endOffset);
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return start === end ? null : { start, end };
}

function locate(root: Node, pos: number): { node: Node; offset: number } | null {
  let acc = 0;
  function walk(node: Node): { node: Node; offset: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      if (pos <= acc + len) return { node, offset: pos - acc };
      acc += len;
      return null;
    }
    for (const child of Array.from(node.childNodes)) {
      const result = walk(child);
      if (result) return result;
    }
    return null;
  }
  return walk(root);
}

/** Восстанавливает выделение [start,end) в перерисованном DOM после переключения форматирования */
export function selectRange(el: HTMLElement, start: number, end: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  const startLoc = locate(el, start);
  const endLoc = locate(el, end);
  const range = document.createRange();
  if (startLoc && endLoc) {
    range.setStart(startLoc.node, startLoc.offset);
    range.setEnd(endLoc.node, endLoc.offset);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Вставка простого текста в точке курсора вручную (Enter/paste) — DOM всегда остаётся под нашим контролем */
export function insertPlainTextAtCaret(text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
