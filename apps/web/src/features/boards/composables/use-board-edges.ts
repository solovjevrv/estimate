import type {
  BoardColorHex,
  BoardEdge,
  BoardEdgeStyle,
  BoardOp,
  BoardTextAlign,
} from '@poker/shared';
import { computed, ref, type ComputedRef, type Ref } from 'vue';

import { uuid } from '../../../features/boards/infrastructure/uuid';
import type {
  BoardFlowEdge,
  BoardFlowNode,
} from '../../../features/boards/adapters/vue-flow-adapter';

/**
 * Минимальная структурная форма события connect из Vue Flow (12.9) — composable
 * не импортирует `@vue-flow/core`, поэтому Canvas адаптирует emit к этой
 * форме. `source`/`target` defendively nullable: Vue Flow гарантирует строки,
 * но проверка в `onConnect` остаётся на случай пустого/отменённого соединения.
 */
export interface BoardEdgeConnection {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Только `id` нужно редактору подписи — остальное Vue Flow не даёт в dblclick. */
export interface BoardEdgeDoubleClickEvent {
  edge: Pick<BoardFlowEdge, 'id'>;
}

export interface BoardViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface UseBoardEdgesOptions {
  canEdit: () => boolean;
  getNodes: () => BoardFlowNode[];
  getEdges: () => BoardFlowEdge[];
  getSelectedEdges: () => BoardFlowEdge[];
  getViewport: () => BoardViewport;
  applyOps: (ops: BoardOp[]) => void;
  activeTool: () => string;
  setActiveTool: (tool: string) => void;
  resolveEdgeColor: (color: BoardColorHex | undefined) => BoardColorHex;
  breakFollowOnEdit: () => void;
}

export interface UseBoardEdgesResult {
  pendingEdgeEditId: Ref<string | null>;
  edgeToolbarPosition: ComputedRef<{ left: number; top: number } | null>;
  selectedEdgeStyle: ComputedRef<BoardEdgeStyle>;
  selectedEdgeColor: ComputedRef<BoardColorHex>;
  selectedEdgeLabelFontSize: ComputedRef<number>;
  selectedEdgeLabelTextAlign: ComputedRef<BoardTextAlign>;
  selectedEdgeLabelTextColor: ComputedRef<BoardColorHex>;
  selectedEdgeLabelBold: ComputedRef<boolean>;

  onConnect: (connection: BoardEdgeConnection) => void;
  onEdgeDoubleClick: (event: BoardEdgeDoubleClickEvent) => void;
  addTextToSelectedEdge: () => void;
  deleteSelectedEdges: () => void;

  patchEdgeLine: (line: BoardEdge['style']['line']) => void;
  patchEdgeDash: (dash: BoardEdge['style']['dash']) => void;
  patchEdgeMarkerStart: (marker: BoardEdge['style']['markerStart']) => void;
  patchEdgeMarkerEnd: (marker: BoardEdge['style']['markerEnd']) => void;
  patchEdgeColor: (color: BoardColorHex) => void;
  previewEdgeColor: (color: BoardColorHex) => void;
  cancelEdgeColorPreview: (originalColor: BoardColorHex) => void;
  patchEdgeLabelFontSize: (size: number) => void;
  patchEdgeLabelTextAlign: (align: BoardTextAlign) => void;
  patchEdgeLabelTextColor: (color: BoardColorHex) => void;
  patchEdgeLabelBold: (bold: boolean) => void;
}

/**
 * Управление связями доски (12.8–12.9): создание `edge.create`, позиция и
 * состояние `BoardEdgeToolbar`, форматирование стиля (line/markers/color) и
 * live-preview цвета, а также открытие редактора подписи.
 *
 * Вынесено из `BoardCanvas.vue`/`useBoardSelection` — composable не зависит от
 * `@vue-flow/core`: координаты viewport/холста и цвета достаются через
 * адаптерные callbacks. Протокол `edge.*` и shared-типы не меняются.
 */
export function useBoardEdges(options: UseBoardEdgesOptions): UseBoardEdgesResult {
  const selectedEdges = computed(() => options.getSelectedEdges());

  /**
   * id редактируемой подписи — живёт здесь, а холст merely `provide`-ит его
   * через `BOARD_PENDING_EDGE_EDIT_ID_KEY`, чтобы `BoardFloatingEdge.vue` открывал
   * редактор по id (см. board-canvas-keys.ts).
   */
  const pendingEdgeEditId = ref<string | null>(null);

  /* ----------------------- Позиция тулбара связи ----------------------- */

  /**
   * Плавающий тулбар над выделенной связью (12.9): midpoint между позициями source
   * и target узлов, затем проецируется через viewport. Если нет edit-доступа,
   * выделения или одной из нод — `null` (тулбар не рисуется).
   */
  const edgeToolbarPosition = computed(() => {
    const selected = selectedEdges.value;
    if (!options.canEdit() || selected.length === 0) return null;
    const nodeMap = new Map(options.getNodes().map((node) => [node.id, node]));
    const edge = selected[0]!;
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) return null;
    const x = (sourceNode.position.x + targetNode.position.x) / 2;
    const y = (sourceNode.position.y + targetNode.position.y) / 2;
    const viewport = options.getViewport();
    return {
      left: viewport.x + x * viewport.zoom,
      top: viewport.y + y * viewport.zoom,
    };
  });

  /* --------------------- Состояние выделенной связи --------------------- */

  /** Стиль первой выделенной связи с fallback-ом (12.9). */
  const selectedEdgeStyle = computed<BoardEdgeStyle>(() => {
    const style = selectedEdges.value[0]?.data?.style;
    if (style) return style;
    return { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' };
  });

  /** Цвет кружка-триггера тулбара всегда литералом — резолвим автоот темы. */
  const selectedEdgeColor = computed<BoardColorHex>(() =>
    options.resolveEdgeColor(selectedEdgeStyle.value.color),
  );

  /** Резолвнутые значения стиля текста подписи (12.18) — те же дефолты, что в BoardFloatingEdge.vue */
  const selectedEdgeLabelFontSize = computed<number>(
    () => selectedEdgeStyle.value.labelFontSize ?? 13,
  );
  const selectedEdgeLabelTextAlign = computed<BoardTextAlign>(
    () => selectedEdgeStyle.value.labelTextAlign ?? 'center',
  );
  const selectedEdgeLabelTextColor = computed<BoardColorHex>(() =>
    options.resolveEdgeColor(selectedEdgeStyle.value.labelTextColor),
  );
  const selectedEdgeLabelBold = computed<boolean>(() => !!selectedEdgeStyle.value.labelBold);

  /* ----------------------- Live-preview цвета ----------------------- */

  /**
   * Сессия «превью кастомного цвета» из UColorPicker (18.4): drag красит объект
   * live через ту же `applyOps`, что и коммит. Чтобы отмена (закрытие попапа
   * без «Применить») точно прошла по тем же связям, что и превью — а не по
   * текущему выделению (которое к моменту закрытия уже может быть снято),
   * фиксируем id один раз в начале сессии.
   */
  let edgeColorPreviewIds: string[] | null = null;

  function previewEdgeColor(color: BoardColorHex): void {
    if (edgeColorPreviewIds === null) {
      const selected = selectedEdges.value;
      edgeColorPreviewIds = selected.map((edge) => edge.id);
    }
    const ops: BoardOp[] = [];
    for (const id of edgeColorPreviewIds) {
      const edge = options.getEdges().find((candidate) => candidate.id === id);
      if (!edge) continue;
      ops.push({
        type: 'edge.patch',
        clientOpId: uuid(),
        id,
        patch: { style: { ...edge.data.style, color } },
      });
    }
    if (ops.length) void options.applyOps(ops);
  }

  /**
   * Коммит цвета: патчит все связи, выбранные в момент действия (одним батчем),
   * и завершает preview-сессию — так последующий `cancelEdgeColorPreview`
   * ничего не откатывает (цвет уже зафиксирован сервером).
   */
  function patchEdgeColor(color: BoardColorHex): void {
    edgeColorPreviewIds = null;
    const ops: BoardOp[] = [];
    for (const edge of selectedEdges.value) {
      ops.push({
        type: 'edge.patch',
        clientOpId: uuid(),
        id: edge.id,
        patch: { style: { ...edge.data.style, color } },
      });
    }
    if (ops.length) void options.applyOps(ops);
  }

  /**
   * Откат брошенного preview по зафиксированным в начале сессии id. Литерал
   * originalColor нужен протоколу: `undefined` при сериализации Socket.IO
   * отбрасывается, и сервер сохранил бы preview-цвет.
   */
  function cancelEdgeColorPreview(originalColor: BoardColorHex): void {
    const ids = edgeColorPreviewIds;
    edgeColorPreviewIds = null;
    if (!ids?.length) return;
    const edges = options.getEdges();
    const ops: BoardOp[] = [];
    for (const id of ids) {
      const edge = edges.find((candidate) => candidate.id === id);
      if (!edge) continue;
      ops.push({
        type: 'edge.patch',
        clientOpId: uuid(),
        id,
        patch: { style: { ...edge.data.style, color: originalColor } },
      });
    }
    if (ops.length) void options.applyOps(ops);
  }

  /* ------------------- Операции над выделенными связями ------------------- */

  /**
   * Батч `edge.patch` по всем выделенным связям: каждый op сохраняет прочие
   * поля `style` через spread текущего `edge.data.style`.
   */
  function patchSelectedEdge(patchByEdge: (edge: BoardFlowEdge) => BoardOp): void {
    const ops = selectedEdges.value.map(patchByEdge);
    if (ops.length) void options.applyOps(ops);
  }

  function patchEdgeLine(line: BoardEdge['style']['line']): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, line } },
    }));
  }

  function patchEdgeDash(dash: BoardEdge['style']['dash']): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, dash } },
    }));
  }

  function patchEdgeMarkerStart(marker: BoardEdge['style']['markerStart']): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, markerStart: marker } },
    }));
  }

  function patchEdgeMarkerEnd(marker: BoardEdge['style']['markerEnd']): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, markerEnd: marker } },
    }));
  }

  /* --------------------- Стиль текста подписи (12.18) --------------------- */

  function patchEdgeLabelFontSize(size: number): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, labelFontSize: size } },
    }));
  }

  function patchEdgeLabelTextAlign(align: BoardTextAlign): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, labelTextAlign: align } },
    }));
  }

  function patchEdgeLabelTextColor(color: BoardColorHex): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, labelTextColor: color } },
    }));
  }

  function patchEdgeLabelBold(bold: boolean): void {
    patchSelectedEdge((edge) => ({
      type: 'edge.patch',
      clientOpId: uuid(),
      id: edge.id,
      patch: { style: { ...edge.data.style, labelBold: bold } },
    }));
  }

  /* ----------------------- Создание / подпись ----------------------- */

  /**
   * Создание связи по connect (12.9). Генерирует id и clientOpId через uuid,
   * сохраняет handles события и дефолтный стиль. Инструмент «Стрелка» — лишь
   * affordance, после соединения он возвращается на «Выделение»; прочие
   * инструменты не меняются.
   */
  function onConnect(connection: BoardEdgeConnection): void {
    if (!options.canEdit()) return;
    if (connection.source === null || connection.target === null) return;
    options.breakFollowOnEdit();
    const id = uuid();
    void options.applyOps([
      {
        type: 'edge.create',
        clientOpId: uuid(),
        edge: {
          id,
          sourceItemId: connection.source,
          targetItemId: connection.target,
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
          label: null,
          style: { line: 'curved', dash: 'solid', markerStart: 'none', markerEnd: 'arrow' },
        },
      },
    ]);
    if (options.activeTool() === 'arrow') options.setActiveTool('select');
  }

  function onEdgeDoubleClick(event: BoardEdgeDoubleClickEvent): void {
    if (!options.canEdit()) return;
    options.breakFollowOnEdit();
    pendingEdgeEditId.value = event.edge.id;
  }

  function addTextToSelectedEdge(): void {
    if (!options.canEdit()) return;
    const edge = selectedEdges.value[0];
    if (!edge) return;
    options.breakFollowOnEdit();
    pendingEdgeEditId.value = edge.id;
  }

  function deleteSelectedEdges(): void {
    if (!options.canEdit()) return;
    options.breakFollowOnEdit();
    patchSelectedEdge((edge) => ({
      type: 'edge.delete',
      clientOpId: uuid(),
      id: edge.id,
    }));
  }

  return {
    pendingEdgeEditId,
    edgeToolbarPosition,
    selectedEdgeStyle,
    selectedEdgeColor,
    selectedEdgeLabelFontSize,
    selectedEdgeLabelTextAlign,
    selectedEdgeLabelTextColor,
    selectedEdgeLabelBold,
    onConnect,
    onEdgeDoubleClick,
    addTextToSelectedEdge,
    deleteSelectedEdges,
    patchEdgeLine,
    patchEdgeDash,
    patchEdgeMarkerStart,
    patchEdgeMarkerEnd,
    patchEdgeColor,
    previewEdgeColor,
    cancelEdgeColorPreview,
    patchEdgeLabelFontSize,
    patchEdgeLabelTextAlign,
    patchEdgeLabelTextColor,
    patchEdgeLabelBold,
  };
}
