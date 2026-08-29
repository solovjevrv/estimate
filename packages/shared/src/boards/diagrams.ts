/**
 * Типы и контракт данных для UML/BPMN-диаграмм на досках (Epic 23). Отдельный
 * файл, а не расширение entities.ts, по тому же принципу, что personal-stickers.ts
 * и giphy.ts — самостоятельный поддомен, не требующий правки основного
 * BoardItemContent union (см. границы задачи 23.1 в PROGRESS.md — это делает 23.2).
 */

import type { BoardTextRun } from './entities';
import { BOARD_ITEM_TEXT_MAX_LENGTH } from './entities';

// ---------------------------------------------------------------------------
// Нотации и каталог kind
// ---------------------------------------------------------------------------

export type BoardDiagramNotation = 'uml' | 'bpmn';
export const BOARD_DIAGRAM_NOTATIONS: readonly BoardDiagramNotation[] = ['uml', 'bpmn'];

export type UmlDiagramKind =
  'actor' | 'use-case' | 'class' | 'interface' | 'enum' | 'component' | 'database';
export const UML_DIAGRAM_KINDS: readonly UmlDiagramKind[] = [
  'actor',
  'use-case',
  'class',
  'interface',
  'enum',
  'component',
  'database',
];

export type BpmnDiagramKind =
  | 'event-start'
  | 'event-intermediate'
  | 'event-end'
  | 'task'
  | 'subprocess'
  | 'gateway-exclusive'
  | 'gateway-parallel'
  | 'pool'
  | 'lane'
  | 'data-object'
  | 'text-annotation';
export const BPMN_DIAGRAM_KINDS: readonly BpmnDiagramKind[] = [
  'event-start',
  'event-intermediate',
  'event-end',
  'task',
  'subprocess',
  'gateway-exclusive',
  'gateway-parallel',
  'pool',
  'lane',
  'data-object',
  'text-annotation',
];

/** BPMN-события — общий подтип, переиспользуется в eventDefinition-проверках */
export type BpmnEventKind = 'event-start' | 'event-intermediate' | 'event-end';
/** BPMN-контейнеры (23.4 сделает их настоящими parentId-контейнерами) */
export type BpmnContainerKind = 'pool' | 'lane';

export type BoardDiagramKind = UmlDiagramKind | BpmnDiagramKind;

// ---------------------------------------------------------------------------
// UML структурированные свойства (class/interface/enum)
// ---------------------------------------------------------------------------

export type UmlVisibility = 'public' | 'private' | 'protected' | 'package';
export const UML_VISIBILITIES: readonly UmlVisibility[] = [
  'public',
  'private',
  'protected',
  'package',
];

export const UML_MEMBER_NAME_MAX_LENGTH = 80;
export const UML_MEMBER_DATA_TYPE_MAX_LENGTH = 60;
export const UML_CLASS_MAX_ATTRIBUTES = 24;
export const UML_CLASS_MAX_OPERATIONS = 24;
export const UML_OPERATION_MAX_PARAMETERS = 8;

/** Атрибут класса ИЛИ литерал enum (для enum — используется только `name`, см. UmlCompartmentContent) */
export interface UmlClassMember {
  name: string;
  /** Тип поля — свободная строка (сигнатура, которую вводит пользователь), не валидируется как реальный язык */
  dataType?: string;
  visibility: UmlVisibility;
}

export interface UmlClassOperation extends UmlClassMember {
  parameters?: UmlClassMember[];
}

// ---------------------------------------------------------------------------
// BPMN eventDefinition
// ---------------------------------------------------------------------------

export type BpmnEventDefinition = 'none' | 'message' | 'timer' | 'error' | 'signal';
export const BPMN_EVENT_DEFINITIONS: readonly BpmnEventDefinition[] = [
  'none',
  'message',
  'timer',
  'error',
  'signal',
];

/**
 * Допустимые eventDefinition по типу события — упрощённый MVP-набор из OMG
 * BPMN 2.0 §10.4–10.6 (без различения catch/throw у intermediate, без редких
 * escalation/compensation — вне объёма MVP). `timer` недопустим у end-события
 * (нельзя «ждать таймер» в конце процесса), остальные комбинации разрешены.
 */
export const BPMN_EVENT_DEFINITIONS_BY_KIND: Readonly<
  Record<BpmnEventKind, readonly BpmnEventDefinition[]>
> = {
  'event-start': ['none', 'message', 'timer', 'signal'],
  'event-intermediate': ['none', 'message', 'timer', 'signal', 'error'],
  'event-end': ['none', 'message', 'signal', 'error'],
};

export function isBpmnEventDefinitionAllowed(
  kind: BpmnEventKind,
  eventDefinition: BpmnEventDefinition,
): boolean {
  return BPMN_EVENT_DEFINITIONS_BY_KIND[kind].includes(eventDefinition);
}

// ---------------------------------------------------------------------------
// Contents — по одному интерфейсу на kind (или на группу kind с одинаковой
// структурой), тот же принцип, что BoardStickyContent/BoardTextContent в
// entities.ts (небольшое дублирование полей ради ясности вместо общего
// параметризованного типа).
// ---------------------------------------------------------------------------

interface BoardDiagramContentBase {
  type: 'diagram';
  notation: BoardDiagramNotation;
  /** Текстовая метка узла; конкатенация `runs` обязана совпадать с `text` — та же проверка, что у sticky/shape (см. board-ops.ts, будущая 23.2) */
  text: string;
  runs?: BoardTextRun[];
}

export interface BoardDiagramUmlActorContent extends BoardDiagramContentBase {
  notation: 'uml';
  kind: 'actor';
}

export interface BoardDiagramUmlUseCaseContent extends BoardDiagramContentBase {
  notation: 'uml';
  kind: 'use-case';
}

/**
 * class/interface/enum — общая «компартмент»-структура (заголовок + список +
 * список). Для `enum` в `attributes` лежат литералы значения (используется
 * только `name`, `dataType`/`visibility` присутствуют в типе, но игнорируются
 * при рендере), `operations` для `enum` обязан быть пустым массивом. Для
 * `interface` `attributes` рендерится, только если непустой (канонический UML
 * для интерфейса — как правило только операции, но не запрещает атрибуты).
 */
export interface BoardDiagramUmlCompartmentContent extends BoardDiagramContentBase {
  notation: 'uml';
  kind: 'class' | 'interface' | 'enum';
  attributes: UmlClassMember[];
  operations: UmlClassOperation[];
}

export interface BoardDiagramUmlComponentContent extends BoardDiagramContentBase {
  notation: 'uml';
  kind: 'component';
}

export interface BoardDiagramUmlDatabaseContent extends BoardDiagramContentBase {
  notation: 'uml';
  kind: 'database';
}

export interface BoardDiagramBpmnEventContent extends BoardDiagramContentBase {
  notation: 'bpmn';
  kind: BpmnEventKind;
  eventDefinition: BpmnEventDefinition;
}

export interface BoardDiagramBpmnTaskContent extends BoardDiagramContentBase {
  notation: 'bpmn';
  kind: 'task';
}

/** MVP — плоский прямоугольник, без collapsed/expanded (см. 23.7) */
export interface BoardDiagramBpmnSubprocessContent extends BoardDiagramContentBase {
  notation: 'bpmn';
  kind: 'subprocess';
}

export interface BoardDiagramBpmnGatewayContent extends BoardDiagramContentBase {
  notation: 'bpmn';
  kind: 'gateway-exclusive' | 'gateway-parallel';
}

/** pool/lane — 23.4 сделает их parentId-контейнерами, здесь только форма content */
export interface BoardDiagramBpmnContainerContent extends BoardDiagramContentBase {
  notation: 'bpmn';
  kind: BpmnContainerKind;
}

export interface BoardDiagramBpmnDataObjectContent extends BoardDiagramContentBase {
  notation: 'bpmn';
  kind: 'data-object';
}

export interface BoardDiagramBpmnTextAnnotationContent extends BoardDiagramContentBase {
  notation: 'bpmn';
  kind: 'text-annotation';
}

/** Дискриминированный union по `notation`+`kind` — добавляется в BoardItemContent в 23.2, не здесь */
export type BoardDiagramContent =
  | BoardDiagramUmlActorContent
  | BoardDiagramUmlUseCaseContent
  | BoardDiagramUmlCompartmentContent
  | BoardDiagramUmlComponentContent
  | BoardDiagramUmlDatabaseContent
  | BoardDiagramBpmnEventContent
  | BoardDiagramBpmnTaskContent
  | BoardDiagramBpmnSubprocessContent
  | BoardDiagramBpmnGatewayContent
  | BoardDiagramBpmnContainerContent
  | BoardDiagramBpmnDataObjectContent
  | BoardDiagramBpmnTextAnnotationContent;

// ---------------------------------------------------------------------------
// DiagramNodeSpec — versioned, UI-независимый каталог геометрии/ограничений
// ---------------------------------------------------------------------------

/**
 * Спецификация одного kind — источник дефолтной геометрии и resize-ограничений
 * для будущего `BoardDiagramNode.vue` (23.2/23.3/23.4). В отличие от всех
 * остальных типов элементов доски (где min/max/lockAspectRatio захардкожены
 * пропос в конкретном `Board*Node.vue`, см. `BoardStickyNode.vue`/
 * `BoardShapeNode.vue`), здесь один Vue-компонент обслуживает 18 разных kind
 * с разными требованиями к пропорциям — поэтому параметры обязаны читаться
 * динамически по `getDiagramNodeSpec(notation, kind)`, а не быть статичными.
 */
export interface DiagramNodeSpec {
  /** Неизменяемый id — НЕ равен `${notation}:${kind}` напрямую, чтобы версионирование (см. `version`) не требовало менять id уже созданных элементов */
  id: string;
  notation: BoardDiagramNotation;
  kind: BoardDiagramKind;
  /** Версия спецификации — растёт, если в будущем меняется геометрия/constraints набора, не создание нового kind */
  version: number;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  lockAspectRatio: boolean;
  /** true у pool/lane — используется 23.4 при обобщении isBoardContainer */
  isContainer: boolean;
}

export const DIAGRAM_NODE_SPECS: readonly DiagramNodeSpec[] = [
  {
    id: 'uml-actor',
    notation: 'uml',
    kind: 'actor',
    version: 1,
    defaultWidth: 60,
    defaultHeight: 110,
    minWidth: 40,
    minHeight: 70,
    maxWidth: 200,
    maxHeight: 360,
    lockAspectRatio: true,
    isContainer: false,
  },
  {
    id: 'uml-use-case',
    notation: 'uml',
    kind: 'use-case',
    version: 1,
    defaultWidth: 160,
    defaultHeight: 90,
    minWidth: 80,
    minHeight: 50,
    maxWidth: 480,
    maxHeight: 280,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'uml-class',
    notation: 'uml',
    kind: 'class',
    version: 1,
    defaultWidth: 220,
    defaultHeight: 160,
    minWidth: 140,
    minHeight: 80,
    maxWidth: 600,
    maxHeight: 800,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'uml-interface',
    notation: 'uml',
    kind: 'interface',
    version: 1,
    defaultWidth: 200,
    defaultHeight: 120,
    minWidth: 140,
    minHeight: 70,
    maxWidth: 600,
    maxHeight: 700,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'uml-enum',
    notation: 'uml',
    kind: 'enum',
    version: 1,
    defaultWidth: 200,
    defaultHeight: 140,
    minWidth: 140,
    minHeight: 70,
    maxWidth: 600,
    maxHeight: 700,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'uml-component',
    notation: 'uml',
    kind: 'component',
    version: 1,
    defaultWidth: 180,
    defaultHeight: 100,
    minWidth: 100,
    minHeight: 60,
    maxWidth: 480,
    maxHeight: 320,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'uml-database',
    notation: 'uml',
    kind: 'database',
    version: 1,
    defaultWidth: 120,
    defaultHeight: 140,
    minWidth: 70,
    minHeight: 90,
    maxWidth: 320,
    maxHeight: 400,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'bpmn-event-start',
    notation: 'bpmn',
    kind: 'event-start',
    version: 1,
    defaultWidth: 56,
    defaultHeight: 56,
    minWidth: 40,
    minHeight: 40,
    maxWidth: 120,
    maxHeight: 120,
    lockAspectRatio: true,
    isContainer: false,
  },
  {
    id: 'bpmn-event-intermediate',
    notation: 'bpmn',
    kind: 'event-intermediate',
    version: 1,
    defaultWidth: 56,
    defaultHeight: 56,
    minWidth: 40,
    minHeight: 40,
    maxWidth: 120,
    maxHeight: 120,
    lockAspectRatio: true,
    isContainer: false,
  },
  {
    id: 'bpmn-event-end',
    notation: 'bpmn',
    kind: 'event-end',
    version: 1,
    defaultWidth: 56,
    defaultHeight: 56,
    minWidth: 40,
    minHeight: 40,
    maxWidth: 120,
    maxHeight: 120,
    lockAspectRatio: true,
    isContainer: false,
  },
  {
    id: 'bpmn-task',
    notation: 'bpmn',
    kind: 'task',
    version: 1,
    defaultWidth: 160,
    defaultHeight: 90,
    minWidth: 100,
    minHeight: 60,
    maxWidth: 480,
    maxHeight: 280,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'bpmn-subprocess',
    notation: 'bpmn',
    kind: 'subprocess',
    version: 1,
    defaultWidth: 220,
    defaultHeight: 130,
    minWidth: 140,
    minHeight: 80,
    maxWidth: 640,
    maxHeight: 400,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'bpmn-gateway-exclusive',
    notation: 'bpmn',
    kind: 'gateway-exclusive',
    version: 1,
    defaultWidth: 70,
    defaultHeight: 70,
    minWidth: 50,
    minHeight: 50,
    maxWidth: 140,
    maxHeight: 140,
    lockAspectRatio: true,
    isContainer: false,
  },
  {
    id: 'bpmn-gateway-parallel',
    notation: 'bpmn',
    kind: 'gateway-parallel',
    version: 1,
    defaultWidth: 70,
    defaultHeight: 70,
    minWidth: 50,
    minHeight: 50,
    maxWidth: 140,
    maxHeight: 140,
    lockAspectRatio: true,
    isContainer: false,
  },
  {
    id: 'bpmn-pool',
    notation: 'bpmn',
    kind: 'pool',
    version: 1,
    defaultWidth: 640,
    defaultHeight: 220,
    minWidth: 320,
    minHeight: 140,
    maxWidth: 10_000,
    maxHeight: 10_000,
    lockAspectRatio: false,
    isContainer: true,
  },
  {
    id: 'bpmn-lane',
    notation: 'bpmn',
    kind: 'lane',
    version: 1,
    defaultWidth: 640,
    defaultHeight: 140,
    minWidth: 320,
    minHeight: 90,
    maxWidth: 10_000,
    maxHeight: 10_000,
    lockAspectRatio: false,
    isContainer: true,
  },
  {
    id: 'bpmn-data-object',
    notation: 'bpmn',
    kind: 'data-object',
    version: 1,
    defaultWidth: 60,
    defaultHeight: 80,
    minWidth: 40,
    minHeight: 50,
    maxWidth: 160,
    maxHeight: 220,
    lockAspectRatio: false,
    isContainer: false,
  },
  {
    id: 'bpmn-text-annotation',
    notation: 'bpmn',
    kind: 'text-annotation',
    version: 1,
    defaultWidth: 180,
    defaultHeight: 70,
    minWidth: 100,
    minHeight: 40,
    maxWidth: 480,
    maxHeight: 240,
    lockAspectRatio: false,
    isContainer: false,
  },
];

export function getDiagramNodeSpec(
  notation: BoardDiagramNotation,
  kind: string,
): DiagramNodeSpec | undefined {
  return DIAGRAM_NODE_SPECS.find((spec) => spec.notation === notation && spec.kind === kind);
}

/**
 * Собирает валидный content для только что создаваемого diagram-элемента —
 * единственный источник правды за пределами kind, требующих structured-поля
 * (class/interface/enum — `attributes`/`operations`; BPMN-события —
 * `eventDefinition`). До 23.3 создание (`use-board-creation.ts`) строило
 * `{ type: 'diagram', notation, kind, text: '' }` через небезопасный
 * `as BoardDiagramContent` — для class/interface/enum это молча производило
 * невалидный content (нет `attributes`/`operations`), который сервер отклонил
 * бы первым же `item.create`. Здесь по kind собирается корректная форма.
 */
export function createDefaultDiagramContent(
  notation: BoardDiagramNotation,
  kind: BoardDiagramKind,
): BoardDiagramContent {
  if (notation === 'uml' && (kind === 'class' || kind === 'interface' || kind === 'enum')) {
    return { type: 'diagram', notation, kind, text: '', attributes: [], operations: [] };
  }
  if (
    notation === 'bpmn' &&
    (kind === 'event-start' || kind === 'event-intermediate' || kind === 'event-end')
  ) {
    return { type: 'diagram', notation, kind, text: '', eventDefinition: 'none' };
  }
  return { type: 'diagram', notation, kind, text: '' } as BoardDiagramContent;
}

// ---------------------------------------------------------------------------
// Семантика связей
// ---------------------------------------------------------------------------

export type UmlEdgeSemantic =
  'association' | 'dependency' | 'generalization' | 'realization' | 'aggregation' | 'composition';
export const UML_EDGE_SEMANTICS: readonly UmlEdgeSemantic[] = [
  'association',
  'dependency',
  'generalization',
  'realization',
  'aggregation',
  'composition',
];

export type BpmnEdgeSemantic = 'sequence' | 'message' | 'association';
export const BPMN_EDGE_SEMANTICS: readonly BpmnEdgeSemantic[] = [
  'sequence',
  'message',
  'association',
];

export type BoardDiagramEdgeSemantic =
  { notation: 'uml'; kind: UmlEdgeSemantic } | { notation: 'bpmn'; kind: BpmnEdgeSemantic };

const BPMN_FLOW_KINDS: readonly BpmnDiagramKind[] = [
  'event-start',
  'event-intermediate',
  'event-end',
  'task',
  'subprocess',
  'gateway-exclusive',
  'gateway-parallel',
];

function isUmlEdgeCompatible(
  semantic: UmlEdgeSemantic,
  sourceKind: UmlDiagramKind,
  targetKind: UmlDiagramKind,
): boolean {
  switch (semantic) {
    case 'association':
      // actor--use-case — канонический случай; остальные пары структурных элементов тоже разрешены
      return true;
    case 'dependency':
      return sourceKind !== 'actor' && targetKind !== 'actor';
    case 'generalization':
      return (
        (sourceKind === 'class' && targetKind === 'class') ||
        (sourceKind === 'interface' && targetKind === 'interface')
      );
    case 'realization':
      return (sourceKind === 'class' || sourceKind === 'component') && targetKind === 'interface';
    case 'aggregation':
    case 'composition':
      return sourceKind === 'class' && targetKind === 'class';
    default:
      return false;
  }
}

/**
 * Упрощённая MVP-проверка — не различает sequence/message по факту
 * принадлежности разным pool (это требует знать parentId-цепочку, а не
 * только content, и остаётся ответственностью сервера/23.4). Здесь только
 * «эта пара kind вообще годится для этого типа связи».
 */
function isBpmnEdgeCompatible(
  semantic: BpmnEdgeSemantic,
  sourceKind: BpmnDiagramKind,
  targetKind: BpmnDiagramKind,
): boolean {
  switch (semantic) {
    case 'sequence':
    case 'message':
      return BPMN_FLOW_KINDS.includes(sourceKind) && BPMN_FLOW_KINDS.includes(targetKind);
    case 'association':
      return (
        sourceKind === 'text-annotation' ||
        sourceKind === 'data-object' ||
        targetKind === 'text-annotation' ||
        targetKind === 'data-object'
      );
    default:
      return false;
  }
}

/**
 * Проверяет допустимость семантики связи между парой diagram-элементов —
 * только совместимость типов (не геометрию, не существование элементов, не
 * принадлежность pool/lane). Используется и сервером при `edge.create`/
 * `edge.patch` (23.2/23.5), и клиентом для UX-подсветки недопустимой цели
 * коннектора при перетаскивании.
 */
export function isDiagramEdgeSemanticCompatible(
  semantic: BoardDiagramEdgeSemantic,
  source: BoardDiagramContent,
  target: BoardDiagramContent,
): boolean {
  if (source.notation !== semantic.notation || target.notation !== semantic.notation) return false;
  if (semantic.notation === 'uml' && source.notation === 'uml' && target.notation === 'uml') {
    return isUmlEdgeCompatible(semantic.kind, source.kind, target.kind);
  }
  if (semantic.notation === 'bpmn' && source.notation === 'bpmn' && target.notation === 'bpmn') {
    return isBpmnEdgeCompatible(semantic.kind, source.kind, target.kind);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Runtime-валидация payload'а (используется 23.2 в серверном validateContent)
// ---------------------------------------------------------------------------

function isValidMember(value: unknown): value is UmlClassMember {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    v.name.length > 0 &&
    v.name.length <= UML_MEMBER_NAME_MAX_LENGTH &&
    (v.dataType === undefined ||
      (typeof v.dataType === 'string' && v.dataType.length <= UML_MEMBER_DATA_TYPE_MAX_LENGTH)) &&
    UML_VISIBILITIES.includes(v.visibility as UmlVisibility)
  );
}

/**
 * Чистая runtime-проверка payload'а diagram-контента — первый фильтр перед
 * более узкими проверками в серверном `validateContent` (23.2: сервер
 * дополнительно проверит там же общие вещи — длину `text`, соответствие
 * `runs` тексту, — по тому же паттерну, что уже есть для sticky/shape).
 * НЕ проверяет геометрию (x/y/width/height — общий `validateGeometry`,
 * единый для всех типов элементов, 23.2 решает, сверять ли width/height
 * дополнительно с `DiagramNodeSpec.min/maxWidth/Height` по конкретному kind).
 */
export function isValidDiagramContent(value: unknown): value is BoardDiagramContent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type !== 'diagram') return false;
  if (v.notation !== 'uml' && v.notation !== 'bpmn') return false;
  if (typeof v.text !== 'string' || v.text.length > BOARD_ITEM_TEXT_MAX_LENGTH) return false;
  if (typeof v.kind !== 'string') return false;

  const spec = getDiagramNodeSpec(v.notation, v.kind);
  if (!spec) return false;

  if (v.notation === 'uml' && (v.kind === 'class' || v.kind === 'interface' || v.kind === 'enum')) {
    if (!Array.isArray(v.attributes) || v.attributes.length > UML_CLASS_MAX_ATTRIBUTES)
      return false;
    if (!v.attributes.every(isValidMember)) return false;
    if (!Array.isArray(v.operations) || v.operations.length > UML_CLASS_MAX_OPERATIONS)
      return false;
    if (v.kind === 'enum' && v.operations.length > 0) return false;
    if (
      !v.operations.every((op) => {
        if (!isValidMember(op)) return false;
        const parameters = (op as UmlClassOperation).parameters;
        return parameters === undefined || Array.isArray(parameters);
      })
    ) {
      return false;
    }
  }

  if (
    v.notation === 'bpmn' &&
    (v.kind === 'event-start' || v.kind === 'event-intermediate' || v.kind === 'event-end')
  ) {
    if (!isBpmnEventDefinitionAllowed(v.kind, v.eventDefinition as BpmnEventDefinition))
      return false;
  }

  return true;
}
