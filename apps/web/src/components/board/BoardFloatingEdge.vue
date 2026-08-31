<script setup lang="ts">
import { BOARD_EDGE_LABEL_MAX_LENGTH, type BoardEdge } from '@estimate/shared';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  Position,
  useVueFlow,
  type EdgeProps,
} from '@vue-flow/core';
import { computed, inject, nextTick, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_PENDING_EDGE_EDIT_ID_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { resolveEdgeColor } from '../../features/boards/config/board-item-defaults';
import { useEdgeCurveOffset } from '../../features/boards/composables/use-edge-curve-offset';
import { useEdgeReconnect } from '../../features/boards/composables/use-edge-reconnect';
import {
  closestSampleIndex,
  type EdgeAnchorParams,
  type EdgeAnchorSide,
  getEdgeAnchorParams,
  getOffsetCurvePath,
  lerpEdgeAnchorParams,
  offsetAlongNormal,
  outwardGapPoint,
  type PathSample,
  tangentAtSample,
} from '../../features/boards/domain/floating-edge-geometry';
import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<EdgeProps<BoardEdge>>();

const { t } = useI18n();
const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const pendingEdgeEditId = inject(BOARD_PENDING_EDGE_EDIT_ID_KEY, ref(null));
const {
  project,
  vueFlowRef,
  viewport,
  getNodes,
  getEdges,
  addSelectedEdges,
  removeSelectedElements,
} = useVueFlow();

/**
 * Клик по подписи выделяет связь (тулбар всплывает) — раньше не работало
 * (найдено пользователем): `EdgeLabelRenderer` рендерит подпись в отдельный
 * HTML-оверлей поверх канваса, а не внутрь `.vue-flow__edge` конкретной связи,
 * поэтому нативное выделение связи по клику (внутренний механизм Vue Flow,
 * привязанный к его собственным SVG-элементам) на эту подпись не срабатывает
 * в принципе — щёлкнуть нужно было именно по самой линии. Выделяем вручную.
 */
function selectThisEdge(): void {
  const edge = getEdges.value.find((candidate) => candidate.id === props.id);
  if (!edge) return;
  removeSelectedElements();
  addSelectedEdges([edge]);
}

/** Не задан в data.style.color (12.9) — точка 'dot' красится так же, как линия/маркер */
const dotColor = computed(() => resolveEdgeColor(props.data.style.color));

/**
 * Перевод нашей неймпрового `EdgeAnchorSide` в `Position` Vue Flow — единственная
 * точка, где рендерер-layer знает о типах Vue Flow. Внешний SVG-результат отличается
 * только именованием полей в `EdgeAnchorParams` (sourceSide/targetSide вместо
 * Position), сами пути строятся теми же вызовами `getSmoothStepPath`/`getBezierPath`.
 */
function toVueFlowPosition(side: EdgeAnchorSide): Position {
  switch (side) {
    case 'top':
      return Position.Top;
    case 'bottom':
      return Position.Bottom;
    case 'left':
      return Position.Left;
    case 'right':
      return Position.Right;
  }
}

const params = computed(() =>
  getEdgeAnchorParams(
    props.sourceNode,
    props.targetNode,
    props.data.sourceHandle,
    props.data.targetHandle,
  ),
);

/**
 * Сглаживание точек крепления при перемещении подключённой карточки ДРУГИМ
 * участником (12.19) — throttled-патчи позиции (~80мс, `BOARD_DRAG_THROTTLE_MS`)
 * без интерполяции давали дискретные скачки пути связи, хотя сама карточка уже
 * сглаживается CSS-переходом transform (12.6, `BoardCanvas.vue`) и подпись —
 * тоже CSS-переходом (12.18, `.board-edge-label` ниже). Для SVG `d` CSS
 * transition ненадёжен (не interpolable свойство без риска расхождения между
 * рендером и `getPointAtLength` в разных браузерах), поэтому интерполируются
 * сами координаты (`lerpEdgeAnchorParams`) через rAF, а path пересчитывается
 * заново на каждом кадре — `renderedAnchor` ниже заменяет `params` всюду, где
 * рендерится видимая геометрия (path/mid/маркеры-точки), сам `params` остаётся
 * «сырой» целью, к которой едет анимация.
 *
 * Отключается (мгновенный снап без анимации), если хотя бы одна из подключённых
 * карточек тащится ЛОКАЛЬНО этим пользователем (`node.dragging` — Vue Flow-нативный
 * флаг, выставляется исключительно её собственным pointer-драгом, не патчами
 * извне, — иначе линия отставала бы от курсора при обычном перетаскивании), либо
 * изменилась сторона крепления (дискретный выбор, не непрерывная величина —
 * интерполировать нечего, скачок и так мгновенный).
 */
const EDGE_ANCHOR_TRANSITION_MS = 120;
const renderedAnchor = ref<EdgeAnchorParams>(params.value);
let anchorAnimationFrame: number | null = null;
let anchorTweenFrom: EdgeAnchorParams = params.value;
let anchorTweenStart = 0;

function cancelAnchorTween(): void {
  if (anchorAnimationFrame === null) return;
  cancelAnimationFrame(anchorAnimationFrame);
  anchorAnimationFrame = null;
}

function stepAnchorTween(target: EdgeAnchorParams, now: number): void {
  const t = Math.min(1, (now - anchorTweenStart) / EDGE_ANCHOR_TRANSITION_MS);
  renderedAnchor.value = lerpEdgeAnchorParams(anchorTweenFrom, target, t);
  anchorAnimationFrame = t < 1 ? requestAnimationFrame((n) => stepAnchorTween(target, n)) : null;
}

watch(params, (next) => {
  const isLocalDrag = props.sourceNode.dragging || props.targetNode.dragging;
  const sideChanged =
    next.sourceSide !== renderedAnchor.value.sourceSide ||
    next.targetSide !== renderedAnchor.value.targetSide;
  cancelAnchorTween();
  if (isLocalDrag || sideChanged) {
    renderedAnchor.value = next;
    return;
  }
  anchorTweenFrom = renderedAnchor.value;
  anchorTweenStart = performance.now();
  anchorAnimationFrame = requestAnimationFrame((now) => stepAnchorTween(next, now));
});

/**
 * Ручное перецепление конца связи (12.20) — логика вынесена в composable
 * (`use-edge-reconnect.ts`, там же подробности приёма): здесь только адаптация
 * к пропсам/стору этого компонента. Объявлено здесь (а не рядом с реальным
 * использованием `onReconnectPointer*` ниже), потому что `dragReconnectPreview`
 * читается уже в `activeAnchor`/`pathData` сразу следом — `toWorldPoint`
 * ниже по файлу, но это `function`-объявление, оно поднимается целиком.
 */
const reconnect = useEdgeReconnect({
  canEdit: () => canEdit.value,
  edgeId: () => props.id,
  currentSourceItemId: () => props.data.sourceItemId,
  currentTargetItemId: () => props.data.targetItemId,
  currentSourceHandle: () => props.data.sourceHandle,
  currentTargetHandle: () => props.data.targetHandle,
  getNodes: () => getNodes.value,
  toWorldPoint,
  applyOps: (ops) => void boardSession.applyOps(ops),
});
const {
  dragReconnectPreview,
  onReconnectPointerDown,
  onReconnectPointerMove,
  onReconnectPointerUp,
} = reconnect;

/**
 * Точки крепления с учётом активного локального перецепления конца —
 * во время такого драга перетаскиваемый конец должен мгновенно следовать за
 * курсором (не за `renderedAnchor`, который реагирует на реальную позицию
 * карточки), не дожидаясь коммита.
 */
const activeAnchor = computed<EdgeAnchorParams>(() => {
  const preview = dragReconnectPreview.value;
  if (!preview) return renderedAnchor.value;
  return preview.end === 'source'
    ? { ...renderedAnchor.value, sx: preview.x, sy: preview.y }
    : { ...renderedAnchor.value, tx: preview.x, ty: preview.y };
});

/**
 * Зазор перед карточкой (12.20, Miro-приём, решение пользователя 20.08.2026) —
 * линия связи не идёт вплотную до границы карточки, а останавливается на
 * `EDGE_ANCHOR_GAP` px раньше, и ручка переподключения (шаблон ниже) сидит
 * РОВНО в этой же точке — не отдельной геометрией поверх линии (была версия,
 * где линия и ручка считались по разным зазорам — 8px у линии против 20px у
 * ручки, чтобы обойти перекрытие с `.board-connect-handle`; по факту ручка
 * визуально отрывалась от конца линии, найдено пользователем на скриншотах
 * 20.08.2026). Единое значение достаточно большое (20px), чтобы: 1) самого
 * перекрытия с `.board-connect-handle` не было в принципе (тот при `:hover`
 * карточки простирается максимум на ~7px наружу от границы); 2) было легко
 * попасть курсором и потянуть — тот самый Miro-эффект «край карточки
 * заметно свободен под захват». Зазор задаётся ДО построения кривой
 * (сдвигаются сами точки, которые видит `pathData` ниже). Во время
 * АКТИВНОГО драга своего конца зазор снимается — конец должен идти точно
 * за курсором.
 */
const EDGE_ANCHOR_GAP = 20;

const renderAnchor = computed<EdgeAnchorParams>(() => {
  const anchor = activeAnchor.value;
  const preview = dragReconnectPreview.value;
  const source =
    preview?.end === 'source'
      ? { x: anchor.sx, y: anchor.sy }
      : outwardGapPoint({ x: anchor.sx, y: anchor.sy }, anchor.sourceSide, EDGE_ANCHOR_GAP);
  const target =
    preview?.end === 'target'
      ? { x: anchor.tx, y: anchor.ty }
      : outwardGapPoint({ x: anchor.tx, y: anchor.ty }, anchor.targetSide, EDGE_ANCHOR_GAP);
  return { ...anchor, sx: source.x, sy: source.y, tx: target.x, ty: target.y };
});

const straightMid = computed(() => ({
  x: (renderAnchor.value.sx + renderAnchor.value.tx) / 2,
  y: (renderAnchor.value.sy + renderAnchor.value.ty) / 2,
}));

/**
 * Ручка изгиба связи (12.17) — логика вынесена в composable
 * (`use-edge-curve-offset.ts`, там же подробности приёма). `dragOffsetPreview`
 * нужен уже в `pathData`/`curveHandlePosition` ниже, `toWorldPoint`/`straightMid`
 * читаются через геттеры — `toWorldPoint` определён дальше по файлу как
 * `function`, объявление поднимается целиком.
 */
const curveOffset = useEdgeCurveOffset({
  canEdit: () => canEdit.value,
  edgeId: () => props.id,
  currentStyle: () => props.data.style,
  currentCurveOffset: () => props.data.style.curveOffset ?? null,
  getStraightMid: () => straightMid.value,
  toWorldPoint,
  applyOps: (ops) => void boardSession.applyOps(ops),
});
const {
  dragOffsetPreview,
  onCurveHandlePointerDown,
  onCurveHandlePointerMove,
  onCurveHandlePointerUp,
  resetCurveOffset,
} = curveOffset;

const pathData = computed(() => {
  const { sx, sy, tx, ty, sourceSide, targetSide } = renderAnchor.value;
  const line = props.data.style.line;

  if (line === 'orthogonal') {
    return getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: toVueFlowPosition(sourceSide),
      targetX: tx,
      targetY: ty,
      targetPosition: toVueFlowPosition(targetSide),
      borderRadius: 8,
    });
  }
  if (line === 'curved') {
    const activeOffset = dragOffsetPreview.value ?? props.data.style.curveOffset ?? null;
    if (activeOffset) {
      return getOffsetCurvePath(sx, sy, tx, ty, activeOffset);
    }
    return getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: toVueFlowPosition(sourceSide),
      targetX: tx,
      targetY: ty,
      targetPosition: toVueFlowPosition(targetSide),
    });
  }
  return getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });
});

const path = computed(() => pathData.value[0]);
const labelX = computed(() => pathData.value[1]);
const labelY = computed(() => pathData.value[2]);

const curveHandlePosition = computed(() => {
  if (dragOffsetPreview.value) {
    return {
      x: straightMid.value.x + dragOffsetPreview.value.x,
      y: straightMid.value.y + dragOffsetPreview.value.y,
    };
  }
  const stored = props.data.style.curveOffset;
  if (stored) {
    return { x: straightMid.value.x + stored.x, y: straightMid.value.y + stored.y };
  }
  return { x: labelX.value, y: labelY.value };
});

/**
 * Подпись пишется прямо на стрелке (Miro-паттерн, решение пользователя
 * 07.08.2026), без отдельного поля в тулбаре и без белой подложки — просто
 * текст поверх холста. Вход в редактирование — либо двойной клик по самой
 * линии (ловится на уровне `<VueFlow>` через `@edge-double-click`, т.к.
 * HTML-оверлей подписи, когда её ещё нет, не перекрывает SVG-путь), либо
 * двойной клик по уже существующей подписи (ловится локально ниже — сам
 * оверлей перекрывает путь под собой), либо кнопка «текст» в
 * `BoardEdgeToolbar.vue`. Оба внешних входа проходят через общий
 * `pendingEdgeEditId`, тот же приём, что `pendingEditId` у стикеров/фигур.
 *
 * Для пустой связи сразу подставляется и выделяется слово-заглушка (как в
 * Miro) — видно, что сюда можно печатать, и первый же символ перезаписывает
 * её целиком. Если уйти не напечатав ничего, заглушка не сохраняется.
 */
const EDGE_LABEL_MAX_WIDTH_CH = 28;

const editing = ref(false);
const draftText = ref('');
const inputEl = useTemplateRef<HTMLTextAreaElement>('labelInput');

function placeholderWord(): string {
  return t('board.edgeLabelPlaceholder');
}

async function startEditing(): Promise<void> {
  if (editing.value || !canEdit.value) return;
  draftText.value = props.data.label ?? placeholderWord();
  editing.value = true;
  await nextTick();
  resizeLabelInput();
  inputEl.value?.focus();
  inputEl.value?.select();
}

watch(pendingEdgeEditId, (id) => {
  if (id !== props.id) return;
  pendingEdgeEditId.value = null;
  void startEditing();
});

function commitEditing(): void {
  if (!editing.value) return;
  editing.value = false;
  const wasEmpty = !props.data.label;
  const rawText = draftText.value.trim();
  const text = wasEmpty && rawText === placeholderWord() ? '' : rawText;
  const label = text ? text.slice(0, BOARD_EDGE_LABEL_MAX_LENGTH) : null;
  if (label === (props.data.label ?? null)) return;
  void boardSession.applyOps([
    {
      type: 'edge.patch',
      clientOpId: globalThis.crypto.randomUUID(),
      id: props.id,
      patch: { label },
    },
  ]);
}

function cancelEditing(): void {
  editing.value = false;
}

/**
 * Авторазмер textarea (аналог `field-sizing` без Safari-проблем): ширина — по
 * самой длинной строке `draftText.split('\n')` в диапазоне `2..EDGE_LABEL_MAX_WIDTH_CH`
 * ch, высота — по `scrollHeight`, чтобы расти по числу строк без вертикального скролла.
 * Длинные слова переносятся CSS (`overflow-wrap: anywhere`), а ширина жёстко ограничена
 * 28ch, поэтому подпись не выходит за пределы даже без пробелов.
 */
const labelInputStyle = computed(() => {
  const longest = draftText.value.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
  const cols = Math.min(EDGE_LABEL_MAX_WIDTH_CH, Math.max(2, longest + 1));
  return { width: `${cols}ch` } as const;
});

/**
 * Стили текста подписи (12.18) — размер/выравнивание/цвет/начертание, по
 * образцу аналогичных полей `BoardItemStyle` у стикеров/фигур, но один
 * переключатель на весь текст (не per-символьная разметка `BoardTextRun.marks`,
 * 12.13 — подпись связи короткая строка без rich-text редактора). Не заданы —
 * прежнее поведение (13px, center, авто-цвет от темы через `resolveEdgeColor`,
 * вес 600, без курсива/подчёркивания/зачёркивания — то, что было жёстко
 * зашито в CSS до этой фичи).
 */
const labelTextStyle = computed(() => {
  const decorations: string[] = [];
  if (props.data.style.labelUnderline) decorations.push('underline');
  if (props.data.style.labelStrike) decorations.push('line-through');
  return {
    fontSize: `${props.data.style.labelFontSize ?? 13}px`,
    textAlign: props.data.style.labelTextAlign ?? 'center',
    color: resolveEdgeColor(props.data.style.labelTextColor),
    fontWeight: props.data.style.labelBold ? 700 : 600,
    fontStyle: props.data.style.labelItalic ? 'italic' : 'normal',
    textDecoration: decorations.length ? decorations.join(' ') : 'none',
  };
});

/** Обнуляем inline-height: иначе `scrollHeight` отражает прежний (больший) размер,
 *  и textarea не схлопнется при удалении строк — классический трюк для автороста. */
function resizeLabelInput(): void {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = '0';
  el.style.height = `${el.scrollHeight}px`;
}

watch(draftText, async () => {
  await nextTick();
  resizeLabelInput();
});

/**
 * Любой keydown внутри textarea останавливает всплытие в Vue Flow / глобальные
 * hotkeys (`.stop`). Обычный Enter НЕ prevent-им — он вставляет `\n` и не завершает
 * редактирование; Ctrl+Enter / Cmd+Enter завершают через blur → commitEditing.
 */
function onLabelKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelEditing();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    inputEl.value?.blur();
  }
}

/** Экранные px → мировые координаты холста — общая утилита для ручки изгиба
 *  (12.17), перецепления конца связи (12.20) и позиционирования подписи. */
function toWorldPoint(event: PointerEvent): { x: number; y: number } {
  const rect = vueFlowRef.value?.getBoundingClientRect();
  if (!rect) return straightMid.value;
  return project({ x: event.clientX - rect.left, y: event.clientY - rect.top });
}

/**
 * Дискретная выборка отрисованного пути (12.18) — источник геометрии и для
 * позиционирования подписи вдоль РЕАЛЬНОЙ кривой (не по прямой между точками
 * крепления — та версия заметно расходилась с видимой формой у сильно
 * изогнутых связей, найдено пользователем при ручной проверке), и для
 * поиска ближайшей к курсору точки при драге. Путь строится по-разному в
 * зависимости от типа линии (`getSmoothStepPath`/`getBezierPath`/
 * `getOffsetCurvePath`), поэтому вместо трёх разных формул касательной
 * берём геометрию из самого браузера (`SVGPathElement.getPointAtLength`)
 * через невидимый технический `<path>` с тем же `d`, что и у видимого
 * `<BaseEdge>`. Пересчитывается через `nextTick` после каждого изменения
 * `path` — читать `getTotalLength()` в этом же тике означало бы читать ещё
 * не обновлённый DOM (гонка рендера).
 */
const LABEL_PATH_SAMPLE_COUNT = 120;
const geometryPathEl = useTemplateRef<SVGPathElement>('geometryPathEl');
const labelPathSamples = ref<PathSample[] | null>(null);

function samplePath(): PathSample[] | null {
  const el = geometryPathEl.value;
  if (!el) return null;
  let total: number;
  try {
    total = el.getTotalLength();
  } catch {
    return null;
  }
  if (!Number.isFinite(total) || total <= 0) return null;
  const samples: PathSample[] = [];
  for (let i = 0; i <= LABEL_PATH_SAMPLE_COUNT; i++) {
    const point = el.getPointAtLength((total * i) / LABEL_PATH_SAMPLE_COUNT);
    samples.push({ x: point.x, y: point.y });
  }
  return samples;
}

watch(
  path,
  async () => {
    await nextTick();
    labelPathSamples.value = samplePath();
  },
  { immediate: true },
);

const LABEL_OFFSET_RESET_EPSILON = 4; // px, как у CURVE_OFFSET_RESET_EPSILON
const LABEL_DRAG_THRESHOLD = 3; // px — ниже порога это клик/dblclick, не драг
/** Miro-подобное ограничение (12.18): вдоль кривой — свободно (следует за её формой), поперёк — небольшой отступ */
const LABEL_PERPENDICULAR_MAX = 32;

const dragLabelOffsetPreview = ref<{ t: number; distance: number } | null>(null);

/**
 * Позиция подписи (12.18) — точка на выборке пути при параметре `t` (доля
 * длины пути 0..1, дефолт 0.5 — геометрическая середина, как до фичи),
 * сдвинутая вдоль нормали пути в этой точке на `distance` px. И `t`, и
 * касательная берутся из `labelPathSamples`, поэтому при драге подпись
 * следует форме кривой, а не прямой между точками крепления.
 * `labelX`/`labelY` (аналитическая середина/апекс) — только fallback, пока
 * выборка ещё не готова (до первого `nextTick`).
 */
const labelPosition = computed(() => {
  const samples = labelPathSamples.value;
  if (!samples || samples.length < 2) return { x: labelX.value, y: labelY.value };
  const active = dragLabelOffsetPreview.value ??
    props.data.style.labelOffset ?? {
      t: 0.5,
      distance: 0,
    };
  const index = Math.max(
    0,
    Math.min(samples.length - 1, Math.round(active.t * (samples.length - 1))),
  );
  const point = samples[index]!;
  const tangent = tangentAtSample(samples, index);
  return offsetAlongNormal(point, tangent, active.distance);
});

/**
 * Перетаскивание подписи связи (12.18) — сама подпись является «хватом»,
 * нет отдельной ручки. Позиция во время драга «магнитится» к ближайшей точке
 * на РЕАЛЬНОЙ отрисованной кривой (курсор не обязан идти точно по линии,
 * важна лишь проекция на неё). Коммит одним edge.patch на pointerup
 * (labelOffset: {t, distance}), без нового WS-события.
 */
const labelDragStart = ref<{ x: number; y: number } | null>(null);

function pointerToLabelOffset(event: PointerEvent): { t: number; distance: number } | null {
  const samples = labelPathSamples.value;
  if (!samples || samples.length < 2) return null;
  const world = toWorldPoint(event);
  const index = closestSampleIndex(samples, world);
  const point = samples[index]!;
  const tangent = tangentAtSample(samples, index);
  const dx = world.x - point.x;
  const dy = world.y - point.y;
  const rawDistance = dx * -tangent.y + dy * tangent.x;
  const distance = Math.max(
    -LABEL_PERPENDICULAR_MAX,
    Math.min(LABEL_PERPENDICULAR_MAX, rawDistance),
  );
  return { t: index / (samples.length - 1), distance };
}

function onLabelPointerDown(event: PointerEvent): void {
  if (!canEdit.value || editing.value) return;
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
  labelDragStart.value = toWorldPoint(event);
  window.addEventListener('keydown', onLabelDragKeydown);
}

function onLabelPointerMove(event: PointerEvent): void {
  if (!labelDragStart.value) return;
  const point = toWorldPoint(event);
  const moved = Math.hypot(point.x - labelDragStart.value.x, point.y - labelDragStart.value.y);
  if (!dragLabelOffsetPreview.value && moved < LABEL_DRAG_THRESHOLD) return;
  const offset = pointerToLabelOffset(event);
  if (offset) dragLabelOffsetPreview.value = offset;
}

function onLabelPointerUp(): void {
  labelDragStart.value = null;
  window.removeEventListener('keydown', onLabelDragKeydown);
  selectThisEdge();
  const offset = dragLabelOffsetPreview.value;
  dragLabelOffsetPreview.value = null;
  if (!offset) return; // не было реального драга — обычный клик
  commitLabelOffset(isNearDefaultLabelPosition(offset) ? null : offset);
}

/**
 * «Отпустили около исходной точки» — сравнение в мировых px, а не по
 * `t`/`distance` напрямую: расстояние по параметру пути нелинейно
 * относительно экранного расстояния, особенно на резких изгибах.
 */
function isNearDefaultLabelPosition(offset: { t: number; distance: number }): boolean {
  const samples = labelPathSamples.value;
  if (!samples || samples.length < 2) return false;
  const base = { x: labelX.value, y: labelY.value };
  const index = Math.max(
    0,
    Math.min(samples.length - 1, Math.round(offset.t * (samples.length - 1))),
  );
  const point = offsetAlongNormal(
    samples[index]!,
    tangentAtSample(samples, index),
    offset.distance,
  );
  return Math.hypot(point.x - base.x, point.y - base.y) < LABEL_OFFSET_RESET_EPSILON;
}

function onLabelDragKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  labelDragStart.value = null;
  dragLabelOffsetPreview.value = null;
  window.removeEventListener('keydown', onLabelDragKeydown);
}

function commitLabelOffset(offset: { t: number; distance: number } | null): void {
  if (offset === (props.data.style.labelOffset ?? null)) return;
  void boardSession.applyOps([
    {
      type: 'edge.patch',
      clientOpId: globalThis.crypto.randomUUID(),
      id: props.id,
      patch: { style: { ...props.data.style, labelOffset: offset } },
    },
  ]);
}

/**
 * «Разрыв» линии под подписью (12.18) — по образцу Miro: у текста НЕТ
 * собственного фона, вместо этого у самой связи вырезается прямоугольная
 * дыра в её видимом месте через SVG-маску (`mask`, применяется к
 * `<BaseEdge>` через его `:style`, т.к. произвольные attrs он не
 * пробрасывает — см. комментарий у testid ниже). Раньше читаемость
 * подписи над линией решалась полупрозрачной подложкой позади текста —
 * по просьбе пользователя заменено на этот приём: подложки нет вовсе, есть
 * геометрический разрыв самой стрелки.
 *
 * Размер дыры — реальный отрисованный размер подписи (`ResizeObserver`),
 * экранные px делятся на текущий zoom, чтобы получить мировые единицы —
 * те же, что у `path`/`labelPosition`.
 */
const LABEL_GAP_PADDING = 3;
const labelEl = useTemplateRef<HTMLDivElement>('labelEl');
const labelWorldSize = ref<{ width: number; height: number }>({ width: 0, height: 0 });
let labelSizeObserver: ResizeObserver | null = null;

function updateLabelWorldSize(): void {
  const el = labelEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const zoom = viewport.value.zoom || 1;
  labelWorldSize.value = { width: rect.width / zoom, height: rect.height / zoom };
}

watch(labelEl, (el) => {
  labelSizeObserver?.disconnect();
  labelSizeObserver = null;
  if (!el) return;
  labelSizeObserver = new ResizeObserver(updateLabelWorldSize);
  labelSizeObserver.observe(el);
  updateLabelWorldSize();
});

const labelGapMaskId = computed(() => `board-edge-label-gap-${props.id}`);

const labelGapRect = computed(() => {
  if (!(editing.value || props.data.label)) return null;
  const width = labelWorldSize.value.width + LABEL_GAP_PADDING * 2;
  const height = labelWorldSize.value.height + LABEL_GAP_PADDING * 2;
  if (width <= 0 || height <= 0) return null;
  const pos = labelPosition.value;
  return { x: pos.x - width / 2, y: pos.y - height / 2, width, height };
});

const edgePathStyle = computed(() => {
  if (!labelGapRect.value) return props.style;
  return { ...props.style, mask: `url(#${labelGapMaskId.value})` };
});

/**
 * Драг прерывается без pointerup, если компонент размонтируется раньше
 * (другой участник удалил связь, undo/redo, виртуализация Vue Flow при
 * скролле) — браузер сам снимает pointer capture с удалённого узла, поэтому
 * наш pointerup никогда не придёт. Без этого слушатель Escape навсегда
 * оставался бы висеть на window.
 */
onUnmounted(() => {
  window.removeEventListener('keydown', onLabelDragKeydown);
  curveOffset.cleanup();
  reconnect.cleanup();
  labelSizeObserver?.disconnect();
  cancelAnchorTween();
});
</script>

<template>
  <!-- BaseEdge не пробрасывает произвольные attrs в SVG path; testid ставим на
       реальный SVG-контейнер, не меняя геометрию или bubbling событий Vue Flow.
       @dblclick — прямой локальный обработчик (не через Vue Flow-нативное
       `@edge-double-click`/`pendingEdgeEditId`, тот путь ненадёжен: не
       срабатывает на пустой связи без подписи, воспроизводится и без
       правок этой задачи, найдено при ручной проверке). Ловит нативный
       dblclick, всплывающий от любого дочернего элемента (мой invisible
       geometry-path не мешает — pointer-events:none, событие всё равно
       долетает до реального пути/интеракшн-пути Vue Flow под курсором). -->
  <g data-testid="board-edge" @dblclick.stop="startEditing">
    <!-- Технический путь только для геометрии (getPointAtLength/getTotalLength,
         12.18) — не рендерится: fill/stroke=none, вне hit-testing. -->
    <path ref="geometryPathEl" :d="path" fill="none" stroke="none" style="pointer-events: none" />

    <!-- Дыра под подписью (12.18) — см. докблок edgePathStyle/labelGapRect выше.
         x/y/width/height у самой <mask> обязательны: дефолтная область маски
         (-10% -10% 120% 120%) считается от вьюпорта SVG, а не от пути связи —
         в мировых px канваса это обрезает всю стрелку целиком (найдено
         пользователем — связь становилась невидимой при добавлении подписи). -->
    <mask
      v-if="labelGapRect"
      :id="labelGapMaskId"
      maskUnits="userSpaceOnUse"
      x="-100000"
      y="-100000"
      width="200000"
      height="200000"
    >
      <rect x="-100000" y="-100000" width="200000" height="200000" fill="white" />
      <rect
        :x="labelGapRect.x"
        :y="labelGapRect.y"
        :width="labelGapRect.width"
        :height="labelGapRect.height"
        fill="black"
      />
    </mask>

    <BaseEdge
      :id="id"
      :path="path"
      :marker-start="markerStart"
      :marker-end="markerEnd"
      :style="edgePathStyle"
    />
    <!-- 'dot' — не встроенный тип маркера Vue Flow (умеет рисовать только arrow/arrowclosed),
         рисуем сами поверх пути -->
    <circle
      v-if="data.style.markerStart === 'dot'"
      :cx="renderAnchor.sx"
      :cy="renderAnchor.sy"
      r="4"
      :fill="dotColor"
    />
    <circle
      v-if="data.style.markerEnd === 'dot'"
      :cx="renderAnchor.tx"
      :cy="renderAnchor.ty"
      r="4"
      :fill="dotColor"
    />
    <!-- Без сохранённого curveOffset ручка сидит ровно в midpoint пути — той же
         точке, по которой целится двойной клик для входа в редактирование
         подписи (см. @dblclick на <g> выше). Первый клик двойного клика
         выделяет связь → эта ручка появляется (v-if по selected) точно под
         курсором → второй клик того же жеста попадает уже в неё, а не в путь.
         @dblclick без .stop — resetCurveOffset() безопасный no-op без
         сохранённого смещения (commitCurveOffset сравнивает с текущим и не
         шлёт патч), событие всплывает к <g> и всё равно открывает редактор. -->
    <circle
      v-if="canEdit && data.style.line === 'curved' && selected"
      data-testid="board-edge-curve-handle"
      class="board-edge-curve-handle nodrag nopan"
      :cx="curveHandlePosition.x"
      :cy="curveHandlePosition.y"
      r="5"
      @pointerdown.stop="onCurveHandlePointerDown"
      @pointermove.stop="onCurveHandlePointerMove"
      @pointerup.stop="onCurveHandlePointerUp"
      @dblclick="resetCurveOffset"
    />
    <!-- Ручное перецепление конца связи на другую сторону/карточку (12.20) —
         видимы только когда связь выделена (клик по линии), по образцу ручки
         изгиба выше. Позиция — та же точка, что и видимый конец линии
         (renderAnchor, зазор перед карточкой выше) — ручка и линия физически
         совпадают, а не расходятся на изогнутой связи. -->
    <circle
      v-if="canEdit && selected"
      data-testid="board-edge-reconnect-handle"
      data-endpoint="source"
      class="board-edge-reconnect-handle nodrag nopan"
      :cx="renderAnchor.sx"
      :cy="renderAnchor.sy"
      r="6"
      @pointerdown.stop="onReconnectPointerDown('source', $event)"
      @pointermove.stop="onReconnectPointerMove"
      @pointerup.stop="onReconnectPointerUp"
    />
    <circle
      v-if="canEdit && selected"
      data-testid="board-edge-reconnect-handle"
      data-endpoint="target"
      class="board-edge-reconnect-handle nodrag nopan"
      :cx="renderAnchor.tx"
      :cy="renderAnchor.ty"
      r="6"
      @pointerdown.stop="onReconnectPointerDown('target', $event)"
      @pointermove.stop="onReconnectPointerMove"
      @pointerup.stop="onReconnectPointerUp"
    />
  </g>

  <EdgeLabelRenderer>
    <div
      v-if="editing || data.label"
      ref="labelEl"
      data-testid="board-edge-label"
      class="board-edge-label nodrag nopan"
      :class="{
        'board-edge-label--draggable': canEdit && !editing,
        'board-edge-label--dragging': dragLabelOffsetPreview !== null || dragOffsetPreview !== null,
      }"
      :style="{
        transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
      }"
      @dblclick.stop="startEditing"
      @pointerdown.stop="onLabelPointerDown"
      @pointermove.stop="onLabelPointerMove"
      @pointerup.stop="onLabelPointerUp"
    >
      <textarea
        v-if="editing"
        ref="labelInput"
        v-model="draftText"
        :maxlength="BOARD_EDGE_LABEL_MAX_LENGTH"
        rows="1"
        spellcheck="false"
        data-testid="board-edge-label-input"
        class="board-edge-label-input"
        :style="[labelInputStyle, labelTextStyle]"
        @keydown.stop="onLabelKeydown"
        @blur="commitEditing"
      />
      <span
        v-else
        data-testid="board-edge-label-text"
        class="board-edge-label-text"
        :style="labelTextStyle"
        >{{ data.label }}</span
      >
    </div>
  </EdgeLabelRenderer>
</template>

<style scoped>
.board-edge-label {
  position: absolute;
  pointer-events: all;
  /* Чужие перемещения карточек долетают throttled-патчами — без сглаживания
     подпись, катающаяся по кривой вместе с ней, дёргается так же резко, как
     сама связь (тот же приём, что у карточек, 12.6, BoardCanvas.vue). Не
     во время СВОЕГО активного драга — иначе курсор будет отставать. */
  transition: transform 120ms linear;
}

.board-edge-label--dragging {
  transition: none;
}

.board-edge-curve-handle {
  fill: var(--ui-color-primary-500);
  stroke: var(--brand-surface, #fff);
  stroke-width: 1.5px;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.12s ease;
  /* .vue-flow__edge (обёртка Vue Flow вокруг этого компонента) задаёт
     pointer-events: visibleStroke — попадание указателя только по контуру,
     не по заливке. Без явного override клик/драг по видимому кружку не
     долетает вообще (та же ловушка, что уже обошли для .board-edge-label). */
  pointer-events: all;
}
.board-edge-curve-handle:hover,
g:hover .board-edge-curve-handle {
  opacity: 1;
}

/* Ручка перецепления конца связи (12.20) — визуально отличается от ручки
   изгиба (полая, не залитая), чтобы не смешивать «двигает форму кривой» и
   «двигает КУДА стрелка крепится». pointer-events: all — та же ловушка
   .vue-flow__edge, что и у ручки изгиба выше. */
/* Видима всегда, пока связь выделена (рендерится только тогда — v-if в
   шаблоне), БЕЗ дополнительного скрытия по :hover — иначе, как только курсор
   уходит с самой линии по пути к ручке (она вынесена наружу от карточки),
   ручка гаснет раньше, чем пользователь успевает её схватить (баг, найден
   пользователем 20.08.2026: «вижу точки только пока не увожу мышку»). */
.board-edge-reconnect-handle {
  fill: var(--brand-surface, #fff);
  stroke: var(--ui-color-primary-500);
  stroke-width: 2px;
  cursor: grab;
  transition: stroke-width 0.12s ease;
  pointer-events: all;
}
.board-edge-reconnect-handle:hover {
  stroke-width: 3px;
}

/* Без подложки (12.18, Miro-паттерн) — читаемость над линией даёт разрыв
   самой стрелки (SVG-маска у BaseEdge, см. labelGapRect в <script>), а не
   фон/гало позади текста. font-size/text-align/color задаются inline через
   labelTextStyle (12.18) — управляются тулбаром, здесь только дефолты для
   остальных свойств. */
.board-edge-label--draggable {
  cursor: grab;
}
.board-edge-label--draggable:active {
  cursor: grabbing;
}

.board-edge-label-text {
  display: inline-block;
  line-height: 1.4;
  /* 28ch — жёсткий лимит ширины подписи, согласован с EDGE_LABEL_MAX_WIDTH_CH */
  max-inline-size: 28ch;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  cursor: text;
}

.board-edge-label-input {
  display: block;
  box-sizing: border-box;
  /* min-height ровно на одну строку — line-height × font-size */
  min-height: 1.4em;
  font-family: inherit;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  resize: none;
  overflow: hidden;
  border: none;
  outline: none;
}
</style>
