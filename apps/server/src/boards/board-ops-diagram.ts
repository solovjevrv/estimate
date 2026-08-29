/**
 * Валидация diagram-элементов (23.1/23.2) — вынесена из `board-ops.ts`
 * отдельным файлом, чтобы не раздувать основной файл валидации операций
 * доски за лимит ESLint `max-lines`; логически это прямое продолжение
 * `validateContent`/`validateGeometry` там же, не отдельный домен.
 */
import {
  BOARD_DIAGRAM_NOTATIONS,
  BPMN_DIAGRAM_KINDS,
  UML_DIAGRAM_KINDS,
  getDiagramNodeSpec,
  isValidDiagramContent,
  type BoardDiagramContent,
  type BoardDiagramKind,
  type BoardDiagramNotation,
  type BoardTextRun,
  type DiagramNodeSpec,
} from '@estimate/shared';

import { ValidationError } from '../errors';

interface RawDiagramContent {
  notation?: unknown;
  kind?: unknown;
  text?: unknown;
  runs?: unknown;
  attributes?: unknown;
  operations?: unknown;
  eventDefinition?: unknown;
}

/**
 * `text`/`runs` уже провалидированы вызывающим кодом (общий паттерн с
 * sticky/shape/text в `board-ops.ts`) — здесь только notation/kind/структура.
 */
export function buildDiagramContent(
  c: RawDiagramContent,
  text: string,
  runs: BoardTextRun[] | undefined,
): BoardDiagramContent {
  if (!BOARD_DIAGRAM_NOTATIONS.includes(c.notation as BoardDiagramNotation)) {
    throw new ValidationError('Недопустимая нотация диаграммы');
  }
  const notation = c.notation as BoardDiagramNotation;
  // kind ∈ per-notation catalog; тот же чек есть в isValidDiagramContent,
  // но здесь даём понятное сообщение до clean-объекта
  const allowedKinds = (
    notation === 'uml' ? UML_DIAGRAM_KINDS : BPMN_DIAGRAM_KINDS
  ) as readonly string[];
  if (!allowedKinds.includes(c.kind as string)) {
    throw new ValidationError('Недопустимый тип элемента диаграммы');
  }
  const kind = c.kind as BoardDiagramKind;
  const clean: Record<string, unknown> = {
    type: 'diagram' as const,
    notation,
    kind,
    text,
    ...(runs ? { runs } : {}),
  };
  // Структурные поля переносятся только у kind, которым они реально нужны
  // (isValidDiagramContent их обязательно потребует) — иначе UML
  // class/interface/enum и BPMN-события никогда не проходили бы валидацию,
  // теряя attributes/operations/eventDefinition при построении clean-объекта.
  // Остальные произвольные поля клиента («evil: true» и т.п.) сюда не
  // попадают и отбрасываются.
  if (notation === 'uml' && (kind === 'class' || kind === 'interface' || kind === 'enum')) {
    clean.attributes = c.attributes;
    clean.operations = c.operations;
  }
  if (
    notation === 'bpmn' &&
    (kind === 'event-start' || kind === 'event-intermediate' || kind === 'event-end')
  ) {
    clean.eventDefinition = c.eventDefinition;
  }
  if (!isValidDiagramContent(clean)) {
    throw new ValidationError('Недопустимое содержимое диаграммы');
  }
  return clean;
}

/**
 * Per-kind ограничения размера diagram-элемента (23.1 `DiagramNodeSpec`) для
 * `validateGeometry` — `undefined` для остальных типов (общие границы) и для
 * заведомо невалидного kind (validateContent отклонит операцию следом в этом
 * же вызове `applyBoardOp`, здесь достаточно безопасного fallback).
 */
export function resolveDiagramGeometrySpec(
  contentType: string,
  content: { notation?: unknown; kind?: unknown } | undefined,
): DiagramNodeSpec | undefined {
  if (contentType !== 'diagram' || !content) return undefined;
  return getDiagramNodeSpec(content.notation as BoardDiagramNotation, content.kind as string);
}
