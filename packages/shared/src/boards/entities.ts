/** Общие типы и контракты, используемые фронтендом и бэкендом. */

import type { ReactionEmoji } from '../rooms';
import type { BoardAccessLevel, BoardShareRole } from './permissions';

/**
 * Доски (Epic 12+) — простой холст для брейншторма/планирования/ретро, по
 * образцу Miro. Командные (`teamId` заполнен) и личные (`teamId: null`),
 * аналогично комнатам (7.25). Набор типов элементов растёт по мере эпиков
 * (12.6 стикеры, 12.7 фигуры, 13.х текст/картинки/эмодзи/стикеры, 14.3 фреймы/группы) — новый тип не
 * требует миграции схемы благодаря дискриминированному union по `type`.
 */
export type BoardItemType =
  'sticky' | 'shape' | 'text' | 'image' | 'emoji' | 'sticker' | 'frame' | 'group';
export const BOARD_ITEM_TYPES: readonly BoardItemType[] = [
  'sticky',
  'shape',
  'text',
  'image',
  'emoji',
  'sticker',
  'frame',
  'group',
];

export type BoardShapeKind = 'rectangle' | 'rounded' | 'ellipse' | 'diamond';
export const BOARD_SHAPE_KINDS: readonly BoardShapeKind[] = [
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
];

/**
 * Цвет стикера/фигуры/связи (12.7) — hex-строка `#RRGGBB`, а не токен из
 * белого списка: пользователь может выбрать произвольный цвет, не только
 * из предложенной палитры. Сервер валидирует не членство в списке, а сам
 * формат строгим regex'ом (`boards/board-ops.ts`) — `#RRGGBB` физически не
 * может нести ничего, кроме шести hex-цифр, так что инъекции через это поле
 * не более возможны, чем при белом списке токенов.
 */
export const BOARD_COLOR_HEX_PATTERN = /^#[0-9a-f]{6}$/i;
export type BoardColorHex = string;

/** Предложенные свотчи в UI (палитра выбора) — не белый список для валидации */
export const BOARD_COLOR_PALETTE: readonly BoardColorHex[] = [
  '#FFFFFF',
  '#FCEB96',
  '#FCE269',
  '#FCB97D',
  '#D4E98C',
  '#B6E565',
  '#60D878',
  '#69DFCD',
  '#FFB8E8',
  '#FFA3E8',
  '#B4A7FA',
  '#FF9595',
  '#A8CAFF',
  '#8FE3FF',
  '#7DA9F6',
  '#1A1A1A',
];

export const BOARD_TITLE_MIN_LENGTH = 1;
export const BOARD_TITLE_MAX_LENGTH = 120;
export const BOARD_ITEM_TEXT_MAX_LENGTH = 2000;
/** Подпись связи (12.8) — короткая аннотация на стрелке, не текст целого стикера */
export const BOARD_EDGE_LABEL_MAX_LENGTH = 200;
/** Максимальное смещение точки изгиба связи (12.17) — мировые px канваса, защита от мусорных значений */
export const BOARD_EDGE_CURVE_OFFSET_MAX = 4000;
/** Максимальный поперечный отступ подписи связи от линии (12.18) — мировые px канваса, защита от мусорных значений */
export const BOARD_EDGE_LABEL_OFFSET_MAX = 4000;
/** Заголовок фрейма/группы (14.3) — короткая метка контейнера */
export const BOARD_FRAME_TITLE_MAX_LENGTH = 200;
/** Потолок элементов на доску — защита от неограниченно растущего снимка (12.1) */
export const BOARD_MAX_ITEMS = 2000;
/** Верхняя граница модуля координаты (x/y) элемента доски — защита от переполнения при рендере */
export const BOARD_ITEM_MAX_COORDINATE = 1_000_000;
/** Верхняя граница ширины/высоты элемента доски */
export const BOARD_ITEM_MAX_SIZE = 10_000;
/** Картинки на доске (13.2) — максимальный размер исходного файла перед пережатием (8 МБ) */
export const BOARD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Допустимые MIME-типы для загрузки картинок на доску (JPEG, PNG, WebP, GIF) */
export const BOARD_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
/** Имя файла картинки доски — только случайный hex (см. BoardImagesService), никогда не из пользовательского ввода */
const BOARD_IMAGE_FILENAME_RE = /^[a-f0-9]{32}\.webp$/;

/** Строит относительный URL для отдачи через GET /api/boards/:id/assets/:filename (13.2) */
export function boardImageUrl(boardId: string, filename: string): string {
  return `/api/boards/${boardId}/assets/${filename}`;
}

/**
 * Проверяет, что url — это путь ИМЕННО к картинке этой доски, а не произвольная
 * строка под /api/boards/ (защита от SSRF/XSS через content.url и от подмены
 * картинки чужой доски).
 */
export function isBoardImageUrl(boardId: string, url: string): boolean {
  const prefix = boardImageUrl(boardId, '');
  return url.startsWith(prefix) && BOARD_IMAGE_FILENAME_RE.test(url.slice(prefix.length));
}

/**
 * Маркер-цвет выделения текста (12.13) — токен из фиксированной небольшой
 * палитры, не свободный hex (в отличие от заливки/цвета текста): попроще
 * UI-выбор для частого действия, и валидация — членство в списке, а не regex.
 */
export type BoardHighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
export const BOARD_HIGHLIGHT_COLORS: readonly BoardHighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
];

/**
 * Ссылка внутри текста (12.13) — только http(s), тот же принцип, что и у
 * ссылок Jira/Confluence комнаты (5.6, `rooms.service.ts#normalizeLink`), но
 * это НЕ общий источник правды — там независимый regex-литерал с тем же
 * смыслом, не импорт отсюда (разные домены: комната и доска не делят код).
 */
export const BOARD_TEXT_LINK_MAX_LENGTH = 500;
export const BOARD_TEXT_LINK_PATTERN = /^https?:\/\//i;

/**
 * Начертание фрагмента текста (12.13) — применяется не ко всему блоку текста
 * стикера/фигуры (это `BoardItemStyle`), а к диапазону символов внутри него
 * (`BoardTextRun.marks`), поэтому в одном стикере можно выделить жирным одно
 * слово. Каждое поле — самостоятельный булев/значимый тумблер, не CSS.
 */
export interface BoardTextMark {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: BoardHighlightColor;
  /** `http(s)://...`, см. `BOARD_TEXT_LINK_PATTERN` */
  link?: string;
}

/**
 * Один непрерывный фрагмент текста с одинаковым форматированием — стандартный
 * способ описать «rich text» без хранения сырого HTML (которое пришлось бы
 * рендерить через `v-html` и санитизировать на каждый чих). Конкатенация
 * `text` всех runs обязана совпадать с `BoardStickyContent.text`/
 * `BoardShapeContent.text` — сервер это проверяет (`board-ops.ts`).
 */
export interface BoardTextRun {
  text: string;
  marks?: BoardTextMark;
}

export interface BoardStickyContent {
  type: 'sticky';
  text: string;
  /** Не задано — обычный текст без форматирования (в т.ч. все элементы до 12.13) */
  runs?: BoardTextRun[];
}

export interface BoardShapeContent {
  type: 'shape';
  shape: BoardShapeKind;
  text: string;
  runs?: BoardTextRun[];
}

export interface BoardTextContent {
  type: 'text';
  text: string;
  runs?: BoardTextRun[];
}

export interface BoardImageContent {
  type: 'image';
  url: string;
  width: number;
  height: number;
}

export interface BoardEmojiContent {
  type: 'emoji';
  emoji: ReactionEmoji;
}

export interface BoardStickerContent {
  type: 'sticker';
  pack: string;
  id: string;
}

/**
 * Фрейм (14.3) — видимый контейнер с заголовком, в который вкладываются другие
 * элементы (их `parentId` указывает на фрейм). Фрейм сам не вкладывается ни в
 * один другой элемент (т.е. `parentId` у фрейма всегда null) — вложенность
 * исключена сознательно: проще модель, проще координаты и undo.
 */
export interface BoardFrameContent {
  type: 'frame';
  title: string;
}

/**
 * Группа (14.3) — невидимый контейнер (без заливки/рамки), тот же механизм
 * вложенности, что фрейм, но без хрома: создаётся действием «Группировать» на
 * выделении. Сервер не различает frame/group при выборе родителя — оба могут
 * быть `parentId` у других элементов.
 */
export interface BoardGroupContent {
  type: 'group';
}

/** Дискриминированный union по `type` — новый тип элемента не требует миграции схемы */
export type BoardItemContent =
  | BoardStickyContent
  | BoardShapeContent
  | BoardTextContent
  | BoardImageContent
  | BoardEmojiContent
  | BoardStickerContent
  | BoardFrameContent
  | BoardGroupContent;

/**
 * Фрейм и группа (14.3) — единственные типы, которые могут быть родителями
 * других элементов. Вынесена в `@poker/shared`, чтобы и сервер, и клиент
 * использовали одну и ту же проверку — сравните с `isBoardContainer` в
 * `board-ops.ts` (раньше локальная функция, сейас общая).
 */
export function isBoardContainer(contentType: string): boolean {
  return contentType === 'frame' || contentType === 'group';
}

/**
 * Начертание текста стикера/фигуры (12.9) — не произвольный CSS font-family,
 * а токен из двух шрифтов, уже загруженных на фронте (`main.css`):
 * `sans` — Manrope (тело, дефолт), `heading` — Sora (акцентный, жирный).
 * Так расширение не требует подгрузки новых веб-шрифтов.
 */
export type BoardFontFamily = 'sans' | 'heading';
export const BOARD_FONT_FAMILIES: readonly BoardFontFamily[] = ['sans', 'heading'];

export type BoardTextAlign = 'left' | 'center' | 'right';
export const BOARD_TEXT_ALIGNS: readonly BoardTextAlign[] = ['left', 'center', 'right'];

/**
 * Границы ручного размера шрифта (12.9). Шире дефолтного диапазона авто-fit
 * (`FIT_FONT_MIN/MAX` = 10–20 в `use-fit-font-size.ts`) — заданное здесь
 * значение является БАЗОВЫМ размером для дефолтной геометрии элемента. При
 * resize оно масштабируется вместе с боксом, а авто-fit при длинном тексте
 * всё равно может ужать итоговый шрифт вплоть до `BOARD_ITEM_FONT_SIZE_MIN`.
 */
export const BOARD_ITEM_FONT_SIZE_MIN = 10;
export const BOARD_ITEM_FONT_SIZE_MAX = 48;

export interface BoardItemStyle {
  color: BoardColorHex;
  /** Базовый размер для дефолтной геометрии; не задано — используется 20px */
  fontSize?: number;
  /** Не задано — `sans` (Manrope, как было до 12.9) */
  fontFamily?: BoardFontFamily;
  /** Цвет текста отдельно от заливки; не задано — автоконтраст от `color` (`readableTextColor`) */
  textColor?: BoardColorHex;
  /** Не задано — `center` (как было до 12.9) */
  textAlign?: BoardTextAlign;
}

/**
 * Реакция-эмодзи на стикере (12.12) — персистентная, в отличие от эфемерных
 * комнатных (`Reaction`, живут только в памяти процесса на раунд). Имя
 * денормализовано прямо в запись: у доски нет постоянного ростера всех, кто
 * когда-либо был на ней (только live-присутствие, `BoardPresence`), так что
 * подтянуть имя отключившегося автора позже неоткуда без отдельного запроса.
 */
export interface ItemReaction {
  userId: string;
  name: string;
  emoji: ReactionEmoji;
}

/**
 * Один пользователь — одна реакция на элемент; повторная присылка того же
 * эмодзи снимает её. Чистая функция без побочных эффектов — используется и
 * сервером (авторитетно, под блокировкой строки доски), и клиентом
 * (оптимистичное предсказание результата до ответа сервера), чтобы не
 * дублировать логику и не разойтись в двух местах.
 */
export function toggleItemReaction(
  reactions: ItemReaction[],
  userId: string,
  name: string,
  emoji: ReactionEmoji,
): ItemReaction[] {
  const existing = reactions.find((r) => r.userId === userId);
  const withoutExisting = reactions.filter((r) => r.userId !== userId);
  return existing?.emoji === emoji
    ? withoutExisting
    : [...withoutExisting, { userId, name, emoji }];
}

export interface BoardItem {
  id: string;
  boardId: string;
  /** Родитель во фрейме/группе (14.3) — id контейнера (frame/group), иначе null */
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Поворот в градусах — заложено заранее, UI появится позже */
  rotation: number;
  /** Порядок наложения: больше — выше */
  zIndex: number;
  content: BoardItemContent;
  style: BoardItemStyle;
  /** Реакции-эмодзи (12.12) — только на стикерах (`content.type === 'sticky'`), не на фигурах */
  reactions: ItemReaction[];
  createdBy: string | null;
  updatedAt: string;
}

export type BoardEdgeLineKind = 'straight' | 'orthogonal' | 'curved';
export const BOARD_EDGE_LINE_KINDS: readonly BoardEdgeLineKind[] = [
  'straight',
  'orthogonal',
  'curved',
];

export type BoardEdgeDash = 'solid' | 'dashed' | 'dotted';
export const BOARD_EDGE_DASH_KINDS: readonly BoardEdgeDash[] = ['solid', 'dashed', 'dotted'];

export type BoardEdgeMarker = 'none' | 'arrow' | 'dot';
export const BOARD_EDGE_MARKER_KINDS: readonly BoardEdgeMarker[] = ['none', 'arrow', 'dot'];

export interface BoardEdgeStyle {
  /**
   * Не задан — цвет вычисляется у каждого зрителя от ЕГО ТЕКУЩЕЙ темы (12.9,
   * см. `resolveEdgeColor` в `features/boards/config/board-item-defaults.ts` на фронте):
   * до этой правки цвет по умолчанию фиксировался на теме АВТОРА в момент
   * создания и хранился как обычный hex — стрелка, созданная в тёмной теме,
   * оставалась белой (и невидимой) и для тех, кто смотрит доску в светлой.
   * Как только пользователь явно выбирает цвет в тулбаре (палитра/кастомный
   * пикер) — сюда пишется конкретный hex и с этого момента он не зависит от
   * темы ни у кого, включая автора.
   */
  color?: BoardColorHex;
  line: BoardEdgeLineKind;
  dash: BoardEdgeDash;
  markerStart: BoardEdgeMarker;
  markerEnd: BoardEdgeMarker;
  /**
   * Смещение видимой точки изгиба (апекса) кривой связи от геометрической
   * середины прямой между точками крепления (12.17) — в мировых px канваса.
   * null/undefined — изгиб строится автоматически библиотечной getBezierPath
   * (поведение до этой фичи). {x:0,y:0} — КОНКРЕТНОЕ пользовательское смещение
   * (изгиб проходит через середину), а не «авто-кривая».
   */
  curveOffset?: { x: number; y: number } | null;
  /**
   * Ручное позиционирование подписи связи (12.18) вдоль РЕАЛЬНОГО
   * отрисованного пути (не по прямой между точками крепления — версия до
   * доработки 20.08.2026 считала смещение относительно прямой, что заметно
   * расходилось с видимой формой у сильно изогнутых связей, найдено
   * пользователем при ручной проверке). `t` — доля длины пути (0..1), где
   * сидит подпись; `distance` — отступ ПЕРПЕНДИКУЛЯРНО касательной пути в
   * этой точке, мировые px. И `t`, и касательная берутся из фактической
   * геометрии отрисованного `<path>` через `SVGPathElement.getPointAtLength`
   * (`BoardFloatingEdge.vue`), а не из аналитической формулы — единственный
   * способ учесть кривизну одинаково для straight/orthogonal/curved без
   * дублирования формулы каждого типа линии.
   * null/undefined — подпись сидит в геометрической середине пути (t=0.5,
   * distance=0; поведение до фичи). Клиент при драге ограничивает `distance`
   * небольшим фиксированным отступом (Miro-подобно, `LABEL_PERPENDICULAR_MAX`
   * в `BoardFloatingEdge.vue`) — это UX-поведение, не инвариант протокола:
   * сервер (`validateLabelOffset`) проверяет только числовые диапазоны
   * (`t` — 0..1, `distance` — `BOARD_EDGE_LABEL_OFFSET_MAX`).
   */
  labelOffset?: { t: number; distance: number } | null;
  /** Размер шрифта подписи связи (12.18) — не задано = 13 (поведение до фичи) */
  labelFontSize?: number;
  /** Выравнивание текста подписи связи (12.18) — не задано = 'center' (поведение до фичи) */
  labelTextAlign?: BoardTextAlign;
  /**
   * Цвет текста подписи связи (12.18), отдельно от цвета линии/маркеров
   * (`color`) — не задано: авто от темы через `resolveEdgeColor` (12.9),
   * тот же приём, что уже используется для цвета самой связи.
   */
  labelTextColor?: BoardColorHex;
  /**
   * Жирность текста подписи связи (12.18) — не задано/false: текущий
   * font-weight 600 (поведение до этой фичи, не «обычный» вес — подпись
   * изначально чуть жирнее тела текста стикеров ради читаемости над линией).
   * true — 700 (заметно жирнее). Один переключатель на весь текст подписи,
   * не per-символьная разметка (`BoardTextRun.marks`, как у стикеров/фигур,
   * 12.13) — подпись связи короткая строка без rich-text редактора.
   */
  labelBold?: boolean;
  /** Курсив текста подписи связи (12.18) — тот же паттерн, что labelBold: один
   * переключатель на весь текст, не задано/false = обычный стиль. */
  labelItalic?: boolean;
  /** Подчёркивание текста подписи связи (12.18) — тот же паттерн, что labelBold. */
  labelUnderline?: boolean;
  /** Зачёркивание текста подписи связи (12.18) — тот же паттерн, что labelBold.
   * Может сочетаться с labelUnderline (оба типа text-decoration одновременно,
   * как и у стикеров/фигур, 12.13). */
  labelStrike?: boolean;
}

export interface BoardEdge {
  id: string;
  boardId: string;
  sourceItemId: string;
  targetItemId: string;
  /** null — floating edge: конец цепляется к ближайшей стороне карточки (12.8) */
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string | null;
  style: BoardEdgeStyle;
}

export type BoardStatus = 'active' | 'archived';

export interface Board {
  id: string;
  /** Личная доска — null, командная — id команды (аналогично rooms.teamId, 7.25) */
  teamId: string | null;
  ownerId: string | null;
  title: string;
  status: BoardStatus;
  /** Номер изменения доски: растёт при каждой операции (12.4), по нему клиент отбрасывает отставшие рассылки */
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Ссылка на просмотр/правку — null, если шаринг выключен (по умолчанию) */
  shareRole: BoardShareRole | null;
}

/** Доска в списке — без содержимого, для «Мои доски»/страницы команды */
export interface BoardSummary extends Board {
  itemCount: number;
}

/** Полный снимок доски — элементы и связи разом, для открытия страницы доски */
export interface BoardSnapshot {
  board: Board;
  items: BoardItem[];
  edges: BoardEdge[];
  /** Доступ ЭТОГО вызывающего к доске — источник для canManage/canEdit на клиенте */
  access: BoardAccessLevel;
}
