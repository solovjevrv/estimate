import type { BoardDiagramKind, BoardDiagramNotation } from '@estimate/shared';

/**
 * Diagram-инструмент несёт notation+kind вместо отдельного строкового
 * варианта на каждый kind (23.1 давало 2 kind — `diagram-uml-actor`/
 * `diagram-bpmn-task` хватало; 23.3 добавляет ещё 5 UML kind, 23.4 добавит
 * BPMN — перечисление всех вариантов строкой не масштабируется). См. решение
 * в комментарии `BoardToolbar.vue`, предвосхитившее этот рефакторинг в 23.2.
 */
export interface BoardDiagramTool {
  tool: 'diagram';
  notation: BoardDiagramNotation;
  kind: BoardDiagramKind;
}

export type BoardTool =
  'select' | 'sticky' | 'shape' | 'text' | 'image' | 'arrow' | 'frame' | BoardDiagramTool;

export function isDiagramTool(tool: BoardTool): tool is BoardDiagramTool {
  return typeof tool === 'object' && tool.tool === 'diagram';
}
