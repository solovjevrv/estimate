/**
 * Оркестрация экспорта доски в PNG (15.5) — скриншот Vue Flow-вьюпорта через
 * `html-to-image` (единственная точка DOM-рендера картинки: библиотеки для
 * этого в проекте раньше не было). Живёт в `BoardCanvas.vue`, где уже есть
 * доступ к `useVueFlow()` и DOM холста — вынесен отдельно, чтобы не раздувать
 * сам компонент асинхронной логикой подготовки файла.
 *
 * Markdown-выгрузка (первая версия задачи) снята по решению пользователя
 * (31.08.2026) как лишняя.
 *
 * Сам composable не импортирует `@vue-flow/core` (архитектурная граница —
 * см. `no-restricted-imports` в eslint для `features/boards/**`) — координаты
 * приходят через `project()` (уже используется по тому же принципу в
 * `use-board-creation.ts`/`use-board-viewport.ts`), а не через типы Vue Flow.
 *
 * Границы экспорта считаются по РЕАЛЬНОМУ DOM (`measureNodesBounds`), а не по
 * `x/y/width/height` из данных элемента — заголовок фрейма рисуется
 * абсолютно спозиционированным `<div>` НАД рамкой (`BoardFrameNode.vue`,
 * `.board-frame-title-bar`, отрицательный `top`) и не входит в geometry
 * элемента; при экспорте по одной только geometry заголовок обрезался бы
 * верхним краем картинки — найдено пользователем на живой доске 31.08.2026.
 */
import { toBlob } from 'html-to-image';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { downloadBlob } from '../../../lib/download-file';
import { buildExportFilename } from '../domain/board-export';

/** Масштаб PNG относительно flow-координат — 2x для чёткости на retina-экранах */
const EXPORT_SCALE = 2;
/** Заголовок фрейма — единственный известный случай, когда контент узла выходит за его x/y/width/height */
const FRAME_TITLE_BAR_SELECTOR = '.board-frame-title-bar';

export interface ExportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ProjectFn = (point: { x: number; y: number }) => { x: number; y: number };
type MeasureBoundsFn = (
  viewportEl: HTMLElement,
  nodeIds: readonly string[],
  project: ProjectFn,
  canvasRect: DOMRect,
) => ExportRect | null;

function unionRect(a: ExportRect | null, b: ExportRect): ExportRect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Границы экспорта в flow-координатах по РЕАЛЬНОМУ DOM: для каждого узла —
 * его собственный `getBoundingClientRect()`, объединённый с заголовком
 * фрейма, если он есть (единственный известный overflow за пределы geometry
 * элемента). Экранные rect'ы переводятся в flow-координаты через `project()` —
 * тот же метод, что и клик по холсту (`use-board-creation.ts`), а не ручная
 * арифметика с viewport.x/y/zoom.
 */
function measureNodesBounds(
  viewportEl: HTMLElement,
  nodeIds: readonly string[],
  project: ProjectFn,
  canvasRect: DOMRect,
): ExportRect | null {
  let bounds: ExportRect | null = null;

  const include = (domRect: DOMRect): void => {
    const topLeft = project({ x: domRect.left - canvasRect.left, y: domRect.top - canvasRect.top });
    const bottomRight = project({
      x: domRect.right - canvasRect.left,
      y: domRect.bottom - canvasRect.top,
    });
    bounds = unionRect(bounds, {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    });
  };

  for (const id of nodeIds) {
    // id — UUID элемента доски, внутри кавычек атрибутного селектора не
    // нуждается в CSS.escape (тот нужен для unquoted-идентификаторов/#id)
    const nodeEl = viewportEl.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!nodeEl) continue;
    include(nodeEl.getBoundingClientRect());
    const titleBar = nodeEl.querySelector<HTMLElement>(FRAME_TITLE_BAR_SELECTOR);
    if (titleBar) include(titleBar.getBoundingClientRect());
  }

  return bounds;
}

export interface UseBoardExportOptions {
  boardTitle: () => string;
  itemCount: () => number;
  /** `.vue-flow__transformationpane` — единственный элемент с реальным transform холста (уже несёт data-testid="board-viewport") */
  getViewportEl: () => HTMLElement | null;
  getCanvasRect: () => DOMRect | undefined;
  /** Экран → flow-координаты, точка уже относительно canvas-контейнера (см. `use-board-creation.ts`) */
  project: ProjectFn;
  getAllNodeIds: () => string[];
  getSelectedNodeIds: () => string[];
  /** Инъекция для тестов — по умолчанию `toBlob` из `html-to-image` */
  toBlobImpl?: typeof toBlob;
  /** Инъекция для тестов — по умолчанию `measureNodesBounds` (реальный DOM) */
  measureBounds?: MeasureBoundsFn;
}

export interface UseBoardExport {
  open: Ref<boolean>;
  pending: Ref<boolean>;
  itemCount: ComputedRef<number>;
  hasSelection: ComputedRef<boolean>;
  runExport: (selectedOnly: boolean, marginPx: number) => Promise<void>;
}

export function useBoardExport(options: UseBoardExportOptions): UseBoardExport {
  const open = ref(false);
  const pending = ref(false);

  const itemCount = computed(options.itemCount);
  const hasSelection = computed(() => options.getSelectedNodeIds().length > 0);

  async function exportPng(selectedOnly: boolean, marginPx: number): Promise<void> {
    const viewportEl = options.getViewportEl();
    if (!viewportEl) throw new Error('board viewport element not found');
    const canvasRect = options.getCanvasRect();
    if (!canvasRect) throw new Error('board canvas element not found');

    const nodeIds = selectedOnly ? options.getSelectedNodeIds() : options.getAllNodeIds();
    const measure = options.measureBounds ?? measureNodesBounds;
    const bounds = measure(viewportEl, nodeIds, options.project, canvasRect);
    if (!bounds) throw new Error('nothing to export');

    const imageWidth = Math.round(bounds.width * EXPORT_SCALE + marginPx * 2);
    const imageHeight = Math.round(bounds.height * EXPORT_SCALE + marginPx * 2);
    const translateX = -bounds.x * EXPORT_SCALE + marginPx;
    const translateY = -bounds.y * EXPORT_SCALE + marginPx;

    const backgroundColor =
      getComputedStyle(document.documentElement).getPropertyValue('--brand-bg').trim() || undefined;

    const previousStyle = {
      transform: viewportEl.style.transform,
      width: viewportEl.style.width,
      height: viewportEl.style.height,
    };
    viewportEl.style.width = `${imageWidth}px`;
    viewportEl.style.height = `${imageHeight}px`;
    viewportEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${EXPORT_SCALE})`;

    try {
      const blob = await (options.toBlobImpl ?? toBlob)(viewportEl, {
        width: imageWidth,
        height: imageHeight,
        backgroundColor,
        // EXPORT_SCALE выше уже задаёт нужную чёткость через transform — без
        // pixelRatio: 1 html-to-image домножил бы ещё и на devicePixelRatio
        // устройства поверх нашего масштаба.
        pixelRatio: 1,
        // Шрифты Manrope/Sora грузятся с fonts.googleapis.com — кросс-origin
        // stylesheet без CORS, поэтому document.styleSheets[].cssRules кидает
        // SecurityError; html-to-image ловит её и уходит в фоллбэк (raw
        // fetch(href) + встраивание КАЖДОГО найденного в CSS шрифта как
        // data URL, в обход preferredFontFormat) — на живом прогоне e2e это
        // не просто медленно (30–90с), а один раз реально подвесило вкладку
        // так, что следующие тесты в том же браузере падали с "browser has
        // been closed". skipFonts полностью выключает этот путь — экспорт
        // рендерит текст системным фоллбэк-шрифтом вместо Manrope/Sora, но
        // не может зависнуть на чужом CORS-ресурсе.
        skipFonts: true,
      });
      if (!blob) throw new Error('export produced no image');
      downloadBlob(buildExportFilename(options.boardTitle()), blob);
    } finally {
      viewportEl.style.transform = previousStyle.transform;
      viewportEl.style.width = previousStyle.width;
      viewportEl.style.height = previousStyle.height;
    }
  }

  async function runExport(selectedOnly: boolean, marginPx: number): Promise<void> {
    pending.value = true;
    try {
      await exportPng(selectedOnly, marginPx);
      open.value = false;
    } finally {
      pending.value = false;
    }
  }

  return { open, pending, itemCount, hasSelection, runExport };
}
