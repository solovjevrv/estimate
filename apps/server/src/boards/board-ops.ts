/**
 * Применение операций доски — чистая логика без БД (12.4). `BoardsService`
 * загружает текущие элементы/связи в `BoardOpState`, прогоняет через
 * `applyBoardOp` весь батч по очереди (валидирует и мутирует состояние),
 * а затем персистит результат. Ошибка любой операции в батче отклоняет
 * его целиком — уже проверенные предыдущие операции в этом же вызове
 * при этом не сохраняются, так как персистится только валидный батч.
 */
import {
  BOARD_COLOR_HEX_PATTERN,
  BOARD_EDGE_LABEL_MAX_LENGTH,
  BOARD_EDGE_CURVE_OFFSET_MAX,
  BOARD_EDGE_LABEL_OFFSET_MAX,
  BOARD_EDGE_DASH_KINDS,
  BOARD_EDGE_LINE_KINDS,
  BOARD_EDGE_MARKER_KINDS,
  BOARD_FONT_FAMILIES,
  BOARD_FRAME_TITLE_MAX_LENGTH,
  BOARD_HIGHLIGHT_COLORS,
  BOARD_ITEM_FONT_SIZE_MAX,
  BOARD_ITEM_FONT_SIZE_MIN,
  BOARD_ITEM_MAX_COORDINATE,
  BOARD_ITEM_MAX_SIZE,
  BOARD_ITEM_TEXT_MAX_LENGTH,
  BOARD_MAX_ITEMS,
  BOARD_SHAPE_KINDS,
  BOARD_TEXT_ALIGNS,
  BOARD_TEXT_LINK_MAX_LENGTH,
  BOARD_TEXT_LINK_PATTERN,
  isBoardImageUrl,
  REACTION_EMOJIS,
  toggleItemReaction,
  isBoardContainer,
  type BoardEdgeDash,
  type BoardEdge,
  type BoardItem,
  type BoardItemContent,
  type BoardItemStyle,
  type BoardOp,
  type BoardTextMark,
  type BoardTextRun,
} from '@poker/shared';

import { ValidationError } from '../errors';

export interface BoardOpState {
  items: Map<string, BoardItem>;
  edges: Map<string, BoardEdge>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(id: unknown, what: string): string {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new ValidationError(`Некорректный id ${what}`);
  }
  return id;
}

function requireFinite(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`Некорректное значение поля «${field}»`);
  }
  return value;
}

/**
 * Цвет — hex-строка `#RRGGBB` (12.7, не токен из белого списка — пользователь
 * может выбрать произвольный цвет). Формат проверяется строгим regex'ом:
 * `#RRGGBB` физически не может нести ничего, кроме шести hex-цифр, так что
 * далее это значение безопасно использовать как CSS-цвет на клиенте.
 */
function requireColorHex(color: unknown, what: string): string {
  if (typeof color !== 'string' || !BOARD_COLOR_HEX_PATTERN.test(color)) {
    throw new ValidationError(`Недопустимый цвет ${what}`);
  }
  return color;
}

function validateFontSize(fontSize: unknown): number | undefined {
  if (fontSize === undefined || fontSize === null) return undefined;
  if (
    typeof fontSize !== 'number' ||
    !Number.isFinite(fontSize) ||
    fontSize < BOARD_ITEM_FONT_SIZE_MIN ||
    fontSize > BOARD_ITEM_FONT_SIZE_MAX
  ) {
    throw new ValidationError('Некорректный размер шрифта');
  }
  return fontSize;
}

function validateFontFamily(fontFamily: unknown): BoardItemStyle['fontFamily'] {
  if (fontFamily === undefined || fontFamily === null) return undefined;
  if (!(BOARD_FONT_FAMILIES as readonly unknown[]).includes(fontFamily)) {
    throw new ValidationError('Недопустимый шрифт');
  }
  return fontFamily as BoardItemStyle['fontFamily'];
}

function validateTextAlign(textAlign: unknown): BoardItemStyle['textAlign'] {
  if (textAlign === undefined || textAlign === null) return undefined;
  if (!(BOARD_TEXT_ALIGNS as readonly unknown[]).includes(textAlign)) {
    throw new ValidationError('Недопустимое выравнивание текста');
  }
  return textAlign as BoardItemStyle['textAlign'];
}

function validateStyle(style: unknown): BoardItemStyle {
  if (typeof style !== 'object' || style === null) {
    throw new ValidationError('Не указан стиль элемента');
  }
  const s = style as {
    color?: unknown;
    fontSize?: unknown;
    fontFamily?: unknown;
    textColor?: unknown;
    textAlign?: unknown;
  };
  const color = requireColorHex(s.color, 'элемента');
  const fontSize = validateFontSize(s.fontSize);
  const fontFamily = validateFontFamily(s.fontFamily);
  const textColor =
    s.textColor === undefined || s.textColor === null
      ? undefined
      : requireColorHex(s.textColor, 'текста');
  const textAlign = validateTextAlign(s.textAlign);
  return { color, fontSize, fontFamily, textColor, textAlign };
}

function validateCurveOffset(value: unknown): { x: number; y: number } | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') {
    throw new ValidationError('Некорректное смещение изгиба связи');
  }
  const { x, y } = value as { x?: unknown; y?: unknown };
  return {
    x: requireFinite(x, 'curveOffset.x', -BOARD_EDGE_CURVE_OFFSET_MAX, BOARD_EDGE_CURVE_OFFSET_MAX),
    y: requireFinite(y, 'curveOffset.y', -BOARD_EDGE_CURVE_OFFSET_MAX, BOARD_EDGE_CURVE_OFFSET_MAX),
  };
}

function validateLabelOffset(value: unknown): { x: number; y: number } | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') {
    throw new ValidationError('Некорректное смещение подписи связи');
  }
  const { x, y } = value as { x?: unknown; y?: unknown };
  return {
    x: requireFinite(x, 'labelOffset.x', -BOARD_EDGE_LABEL_OFFSET_MAX, BOARD_EDGE_LABEL_OFFSET_MAX),
    y: requireFinite(y, 'labelOffset.y', -BOARD_EDGE_LABEL_OFFSET_MAX, BOARD_EDGE_LABEL_OFFSET_MAX),
  };
}

function validateEdgeStyle(style: unknown): BoardEdge['style'] {
  if (typeof style !== 'object' || style === null) {
    throw new ValidationError('Не указан стиль связи');
  }
  const { color, line, markerStart, markerEnd, dash, curveOffset, labelOffset } = style as {
    color?: unknown;
    line?: unknown;
    markerStart?: unknown;
    markerEnd?: unknown;
    dash?: unknown;
    curveOffset?: unknown;
    labelOffset?: unknown;
  };
  // Не задан — цвет решается на фронте от темы зрителя (12.9), не хранится
  const validColor =
    color === undefined || color === null ? undefined : requireColorHex(color, 'связи');
  if (!(BOARD_EDGE_LINE_KINDS as readonly unknown[]).includes(line)) {
    throw new ValidationError('Недопустимый тип линии связи');
  }
  const validDash =
    dash === undefined || dash === null
      ? 'solid'
      : (BOARD_EDGE_DASH_KINDS as readonly unknown[]).includes(dash)
        ? (dash as BoardEdgeDash)
        : (() => {
            throw new ValidationError('Недопустимый стиль обводки связи');
          })();
  const validMarkerStart =
    markerStart === undefined || markerStart === null
      ? 'none'
      : (() => {
          if (!BOARD_EDGE_MARKER_KINDS.includes(markerStart as BoardEdge['style']['markerStart'])) {
            throw new ValidationError('Недопустимый наконечник начала связи');
          }
          return markerStart as BoardEdge['style']['markerStart'];
        })();
  const validMarkerEnd =
    markerEnd === undefined || markerEnd === null
      ? 'none'
      : (() => {
          if (!BOARD_EDGE_MARKER_KINDS.includes(markerEnd as BoardEdge['style']['markerEnd'])) {
            throw new ValidationError('Недопустимый наконечник конца связи');
          }
          return markerEnd as BoardEdge['style']['markerEnd'];
        })();
  return {
    color: validColor,
    line: line as BoardEdge['style']['line'],
    dash: validDash,
    markerStart: validMarkerStart,
    markerEnd: validMarkerEnd,
    curveOffset: validateCurveOffset(curveOffset),
    labelOffset: validateLabelOffset(labelOffset),
  };
}

function validateEdgeLabel(label: unknown): string | null {
  if (label === undefined || label === null) return null;
  if (typeof label !== 'string' || label.length > BOARD_EDGE_LABEL_MAX_LENGTH) {
    throw new ValidationError('Слишком длинная подпись связи');
  }
  return label;
}

/**
 * Начертание фрагмента текста (12.13) — каждое поле независимый белый список:
 * булевы тумблеры как есть, маркер — членство в фиксированной палитре (не
 * regex-цвет, UI сознательно сужен до нескольких пресетов), ссылка — тот же
 * `http(s)://`-regex, что и у ссылок Jira/Confluence комнаты (`rooms.service.ts`).
 */
function validateTextMark(mark: unknown): BoardTextMark | undefined {
  if (mark === undefined || mark === null) return undefined;
  if (typeof mark !== 'object') {
    throw new ValidationError('Недопустимое форматирование текста');
  }
  const m = mark as {
    bold?: unknown;
    italic?: unknown;
    underline?: unknown;
    strike?: unknown;
    highlight?: unknown;
    link?: unknown;
  };
  const result: BoardTextMark = {};
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    const value = m[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') {
      throw new ValidationError('Недопустимое форматирование текста');
    }
    if (value) result[key] = true;
  }
  if (m.highlight !== undefined && m.highlight !== null) {
    if (!(BOARD_HIGHLIGHT_COLORS as readonly unknown[]).includes(m.highlight)) {
      throw new ValidationError('Недопустимый цвет маркера');
    }
    result.highlight = m.highlight as BoardTextMark['highlight'];
  }
  if (m.link !== undefined && m.link !== null) {
    if (
      typeof m.link !== 'string' ||
      m.link.length > BOARD_TEXT_LINK_MAX_LENGTH ||
      !BOARD_TEXT_LINK_PATTERN.test(m.link)
    ) {
      throw new ValidationError('Недопустимая ссылка');
    }
    result.link = m.link;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Runs — опциональное форматированное представление `text` (12.13). Конкатенация
 * текста всех runs обязана буквально совпадать с уже провалидированным `text` —
 * это не только гигиена (клиент сам её так и строит), но и защита: без этой
 * проверки в `runs` можно было бы протащить произвольно длинный текст в обход
 * лимита `BOARD_ITEM_TEXT_MAX_LENGTH`, наложенного только на `text`.
 */
/**
 * Верхняя граница числа runs — без нее проверка «конкатенация runs == text»
 * ограничивает только суммарную длину ТЕКСТА, а не размер самого payload:
 * тысячи runs с пустым/однобуквенным текстом и длинной меткой (например,
 * ссылкой до `BOARD_TEXT_LINK_MAX_LENGTH` в каждом) раздули бы `content` до
 * мегабайта на один элемент, обходя цель `BOARD_ITEM_TEXT_MAX_LENGTH`. Реальный
 * текст в 2000 символов даже при частом чередовании меток не требует сотен
 * runs — лимит с большим запасом.
 */
const BOARD_ITEM_MAX_RUNS = 200;

function validateRuns(runs: unknown, text: string): BoardTextRun[] | undefined {
  if (runs === undefined || runs === null) return undefined;
  if (!Array.isArray(runs) || runs.length > BOARD_ITEM_MAX_RUNS) {
    throw new ValidationError('Недопустимое форматирование текста');
  }
  const result: BoardTextRun[] = runs.map((run) => {
    if (typeof run !== 'object' || run === null) {
      throw new ValidationError('Недопустимое форматирование текста');
    }
    const r = run as { text?: unknown; marks?: unknown };
    if (typeof r.text !== 'string' || r.text.length === 0) {
      throw new ValidationError('Недопустимое форматирование текста');
    }
    const marks = validateTextMark(r.marks);
    return marks ? { text: r.text, marks } : { text: r.text };
  });
  if (result.map((run) => run.text).join('') !== text) {
    throw new ValidationError('Форматирование текста не совпадает с его содержимым');
  }
  return result;
}

function validateContent(content: unknown, boardId: string): BoardItemContent {
  if (typeof content !== 'object' || content === null) {
    throw new ValidationError('Не указано содержимое элемента');
  }
  const c = content as {
    type?: unknown;
    text?: unknown;
    shape?: unknown;
    runs?: unknown;
    url?: unknown;
    width?: unknown;
    height?: unknown;
    emoji?: unknown;
    pack?: unknown;
    id?: unknown;
    title?: unknown;
  };

  // Для emoji — только сам символ из фиксированного набора, text/runs не требуются
  if (c.type === 'emoji') {
    if (!(REACTION_EMOJIS as readonly unknown[]).includes(c.emoji)) {
      throw new ValidationError('Недопустимый эмодзи');
    }
    return { type: 'emoji', emoji: c.emoji as (typeof REACTION_EMOJIS)[number] };
  }

  // Для sticker — pack и id обязательны, формат /^[a-z0-9-]{1,64}$/ (13.4)
  // Валидируем формат, но НЕ сверяем с манифестом (он только на фронте) —
  // компонент рендера на фронте сам покажет плейсхолдер для неизвестного pack/id.
  if (c.type === 'sticker') {
    const PACK_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
    if (typeof c.pack !== 'string' || c.pack.length === 0 || !PACK_ID_PATTERN.test(c.pack)) {
      throw new ValidationError('Недопустимый идентификатор пака стикеров');
    }
    if (typeof c.id !== 'string' || c.id.length === 0 || !PACK_ID_PATTERN.test(c.id)) {
      throw new ValidationError('Недопустимый идентификатор стикера');
    }
    return { type: 'sticker', pack: c.pack, id: c.id };
  }

  // Фрейм (14.3) — видимый контейнер с заголовком; title ≤ BOARD_FRAME_TITLE_MAX_LENGTH
  if (c.type === 'frame') {
    if (typeof c.title !== 'string' || c.title.length > BOARD_FRAME_TITLE_MAX_LENGTH) {
      throw new ValidationError('Слишком длинный заголовок фрейма');
    }
    return { type: 'frame', title: c.title };
  }

  // Группа (14.3) — невидимый контейнер, payload-полей нет
  if (c.type === 'group') {
    return { type: 'group' };
  }

  // Для image — url, width, height обязательны, text/runs не требуются
  if (c.type === 'image') {
    if (typeof c.url !== 'string' || c.url.length === 0) {
      throw new ValidationError('URL картинки обязателен');
    }
    // Валидируем, что URL — это путь именно к картинке этой доски, не произвольная
    // строка/чужая доска (защита от SSRF/XSS через content.url)
    if (!isBoardImageUrl(boardId, c.url)) {
      throw new ValidationError('Недопустимый URL картинки');
    }
    if (
      typeof c.width !== 'number' ||
      !Number.isFinite(c.width) ||
      c.width < 1 ||
      c.width > BOARD_ITEM_MAX_SIZE
    ) {
      throw new ValidationError('Некорректная ширина картинки');
    }
    if (
      typeof c.height !== 'number' ||
      !Number.isFinite(c.height) ||
      c.height < 1 ||
      c.height > BOARD_ITEM_MAX_SIZE
    ) {
      throw new ValidationError('Некорректная высота картинки');
    }
    return { type: 'image', url: c.url, width: c.width, height: c.height };
  }

  // Для остальных типов (sticky, shape, text) — text обязателен
  if (typeof c.text !== 'string' || c.text.length > BOARD_ITEM_TEXT_MAX_LENGTH) {
    throw new ValidationError('Слишком длинный текст элемента');
  }
  const runs = validateRuns(c.runs, c.text);
  if (c.type === 'sticky') {
    return { type: 'sticky', text: c.text, ...(runs ? { runs } : {}) };
  }
  if (c.type === 'shape') {
    if (!(BOARD_SHAPE_KINDS as readonly unknown[]).includes(c.shape)) {
      throw new ValidationError('Недопустимая форма фигуры');
    }
    return {
      type: 'shape',
      shape: c.shape as (typeof BOARD_SHAPE_KINDS)[number],
      text: c.text,
      ...(runs ? { runs } : {}),
    };
  }
  if (c.type === 'text') {
    return { type: 'text', text: c.text, ...(runs ? { runs } : {}) };
  }
  throw new ValidationError('Неизвестный тип элемента');
}

/** Геометрия общая для всех элементов — валидируется одинаково независимо от типа содержимого */
function validateGeometry(
  item: {
    x: unknown;
    y: unknown;
    width: unknown;
    height: unknown;
    rotation: unknown;
    zIndex: unknown;
    parentId: unknown;
    content?: { type?: unknown };
  },
  itemId: string,
  state: BoardOpState,
): Pick<BoardItem, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'zIndex' | 'parentId'> {
  // Родитель (14.3): null, либо id существующего контейнера (frame/group).
  // Вложенность запрещена: контейнер сам не может иметь родителя — из этого
  // неизбежно отсутствие циклов (родитель всегда верхнеуровневый). Инварианты:
  //  - контейнер (frame/group) всегда верхнеуровневый — у него parentId обязан быть null;
  //  - обычный элемент может иметь родителем только существующий контейнер,
  //    который сам никому не подчинён, и только не самого себя.
  const isContainer = isBoardContainer(item.content?.type as string);
  if (isContainer && item.parentId != null) {
    throw new ValidationError('Фрейм и группа не могут быть вложены в другой контейнер');
  }
  let parentId: string | null = null;
  if (!isContainer && item.parentId != null) {
    requireUuid(item.parentId, 'родителя');
    const parent = state.items.get(item.parentId as string);
    if (!parent || parent.id === itemId) {
      throw new ValidationError('Родитель не найден');
    }
    if (!isBoardContainer(parent.content.type)) {
      throw new ValidationError('Родителем может быть только фрейм или группа');
    }
    if (parent.parentId !== null) {
      throw new ValidationError('Вложенность фреймов и групп не поддерживается');
    }
    parentId = parent.id;
  }
  return {
    x: requireFinite(item.x, 'x', -BOARD_ITEM_MAX_COORDINATE, BOARD_ITEM_MAX_COORDINATE),
    y: requireFinite(item.y, 'y', -BOARD_ITEM_MAX_COORDINATE, BOARD_ITEM_MAX_COORDINATE),
    width: requireFinite(item.width, 'width', 1, BOARD_ITEM_MAX_SIZE),
    height: requireFinite(item.height, 'height', 1, BOARD_ITEM_MAX_SIZE),
    rotation: requireFinite(item.rotation, 'rotation', -360, 360),
    zIndex: requireFinite(item.zIndex, 'zIndex', -1_000_000, 1_000_000),
    parentId,
  };
}

/**
 * Применяет одну операцию к состоянию доски: валидирует и мутирует `state`
 * на месте. Бросает `ValidationError`/`NotFoundError`-подобные ошибки
 * (см. `../errors`) на любое несоответствие — вызывающий код должен
 * прерывать применение всего батча при первой же ошибке.
 */
export function applyBoardOp(
  state: BoardOpState,
  op: BoardOp,
  boardId: string,
  actor: { participantId: string; userId: string | null; name: string },
): void {
  switch (op.type) {
    case 'item.create': {
      const id = requireUuid(op.item.id, 'элемента');
      if (state.items.has(id)) {
        throw new ValidationError('Элемент с таким id уже существует');
      }
      if (state.items.size >= BOARD_MAX_ITEMS) {
        throw new ValidationError(`Превышен лимит элементов на доске (${BOARD_MAX_ITEMS})`);
      }
      const geometry = validateGeometry(op.item, id, state);
      const item: BoardItem = {
        id,
        boardId,
        ...geometry,
        content: validateContent(op.item.content, boardId),
        style: validateStyle(op.item.style),
        reactions: [],
        createdBy: actor.userId, // FK на users — гостю писать нельзя, поэтому null
        updatedAt: new Date().toISOString(),
      };
      state.items.set(id, item);
      break;
    }
    case 'item.patch': {
      const existing = state.items.get(op.id);
      if (!existing) {
        throw new ValidationError('Элемент не найден');
      }
      const merged = { ...existing, ...op.patch };
      const geometry = validateGeometry(merged, existing.id, state);
      const item: BoardItem = {
        ...existing,
        ...geometry,
        content:
          op.patch.content !== undefined
            ? validateContent(merged.content, boardId)
            : existing.content,
        style:
          op.patch.style !== undefined
            ? validateStyle({ ...existing.style, ...op.patch.style })
            : existing.style,
        updatedAt: new Date().toISOString(),
      };
      state.items.set(op.id, item);
      // Если патч демотировал контейнер (frame/group) до обычного элемента —
      // дети осираются (parentId → null), иначе остаются с висячим parentId
      // на не-контейнере, нарушая инвариант «только контейнер может быть родителем»
      if (isBoardContainer(existing.content.type) && !isBoardContainer(item.content.type)) {
        for (const child of state.items.values()) {
          if (child.parentId === op.id) child.parentId = null;
        }
      }
      break;
    }
    case 'item.delete': {
      if (!state.items.delete(op.id)) {
        throw new ValidationError('Элемент не найден');
      }
      // Связи существуют только вместе со своими элементами — БД удалит их каскадом,
      // но в состоянии текущего батча их тоже нужно убрать сразу: иначе следующая
      // в этом же батче операция ещё «видела» бы удалённый элемент через связь
      for (const [edgeId, edge] of state.edges) {
        if (edge.sourceItemId === op.id || edge.targetItemId === op.id) {
          state.edges.delete(edgeId);
        }
      }
      // Удаление контейнера (frame/group, 14.3) НЕ каскадит детей — они
      // осираются (parentId → null), остаются на доске. DB‑FK `ON DELETE
      // SET NULL` сделает то же самое с БД прозрачно; здесь зеркалим в памяти,
      // чтобы следующая операция в батче видела актуальное состояние.
      for (const child of state.items.values()) {
        if (child.parentId === op.id) child.parentId = null;
      }
      break;
    }
    case 'item.react': {
      const existing = state.items.get(op.id);
      if (!existing) {
        throw new ValidationError('Элемент не найден');
      }
      if (existing.content.type !== 'sticky') {
        throw new ValidationError('Реакции доступны только на стикерах');
      }
      if (!(REACTION_EMOJIS as readonly unknown[]).includes(op.emoji)) {
        throw new ValidationError('Недопустимый эмодзи реакции');
      }
      state.items.set(op.id, {
        ...existing,
        reactions: toggleItemReaction(
          existing.reactions,
          actor.participantId,
          actor.name,
          op.emoji,
        ),
        updatedAt: new Date().toISOString(),
      });
      break;
    }
    case 'edge.create': {
      const id = requireUuid(op.edge.id, 'связи');
      if (state.edges.has(id)) {
        throw new ValidationError('Связь с таким id уже существует');
      }
      const sourceItemId = requireUuid(op.edge.sourceItemId, 'исходного элемента');
      const targetItemId = requireUuid(op.edge.targetItemId, 'целевого элемента');
      if (sourceItemId === targetItemId) {
        throw new ValidationError('Связь не может соединять элемент с самим собой');
      }
      if (!state.items.has(sourceItemId) || !state.items.has(targetItemId)) {
        throw new ValidationError('Элемент связи не найден на доске');
      }
      state.edges.set(id, {
        id,
        boardId,
        sourceItemId,
        targetItemId,
        sourceHandle: op.edge.sourceHandle ?? null,
        targetHandle: op.edge.targetHandle ?? null,
        label: validateEdgeLabel(op.edge.label),
        style: validateEdgeStyle(op.edge.style),
      });
      break;
    }
    case 'edge.patch': {
      const existing = state.edges.get(op.id);
      if (!existing) {
        throw new ValidationError('Связь не найдена');
      }
      const merged = { ...existing, ...op.patch };
      state.edges.set(op.id, {
        ...existing,
        sourceHandle: merged.sourceHandle ?? null,
        targetHandle: merged.targetHandle ?? null,
        label: op.patch.label !== undefined ? validateEdgeLabel(op.patch.label) : existing.label,
        style:
          op.patch.style !== undefined && op.patch.style !== null
            ? validateEdgeStyle({ ...existing.style, ...op.patch.style })
            : existing.style,
      });
      break;
    }
    case 'edge.delete': {
      if (!state.edges.delete(op.id)) {
        throw new ValidationError('Связь не найдена');
      }
      break;
    }
  }
}
