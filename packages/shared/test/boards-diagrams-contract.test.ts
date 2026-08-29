import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BOARD_DIAGRAM_NOTATIONS,
  BPMN_DIAGRAM_KINDS,
  BPMN_EDGE_SEMANTICS,
  BPMN_EVENT_DEFINITIONS_BY_KIND,
  DIAGRAM_NODE_SPECS,
  UML_DIAGRAM_KINDS,
  UML_EDGE_SEMANTICS,
  createDefaultDiagramContent,
  getDiagramNodeSpec,
  isBpmnEventDefinitionAllowed,
  isDiagramEdgeSemanticCompatible,
  isValidDiagramContent,
  type BoardDiagramContent,
  type BoardDiagramEdgeSemantic,
} from '../src/index';

describe('каталог нотаций (23.1)', () => {
  it('фиксирует полный набор kind по каждой нотации', () => {
    expect(UML_DIAGRAM_KINDS).toHaveLength(7);
    expect(BPMN_DIAGRAM_KINDS).toHaveLength(11);
    expect(BOARD_DIAGRAM_NOTATIONS).toEqual(['uml', 'bpmn']);
  });

  it('DIAGRAM_NODE_SPECS покрывает каждый kind ровно один раз', () => {
    expect(DIAGRAM_NODE_SPECS).toHaveLength(18);
    const seen = new Set(DIAGRAM_NODE_SPECS.map((s) => `${s.notation}:${s.kind}`));
    expect(seen.size).toBe(18);
  });

  it('getDiagramNodeSpec находит спеку и не находит неизвестный kind', () => {
    expect(getDiagramNodeSpec('uml', 'class')?.id).toBe('uml-class');
    expect(getDiagramNodeSpec('bpmn', 'pool')?.isContainer).toBe(true);
    expect(getDiagramNodeSpec('uml', 'nonexistent')).toBeUndefined();
  });

  it('pool/lane помечены isContainer, остальные — нет', () => {
    for (const spec of DIAGRAM_NODE_SPECS) {
      const expected = spec.kind === 'pool' || spec.kind === 'lane';
      expect(spec.isContainer).toBe(expected);
    }
  });
});

describe('eventDefinition (23.1)', () => {
  it('timer недопустим у event-end', () => {
    expect(isBpmnEventDefinitionAllowed('event-end', 'timer')).toBe(false);
    expect(isBpmnEventDefinitionAllowed('event-start', 'timer')).toBe(true);
  });

  it('none допустим везде', () => {
    for (const kind of Object.keys(BPMN_EVENT_DEFINITIONS_BY_KIND) as Array<
      keyof typeof BPMN_EVENT_DEFINITIONS_BY_KIND
    >) {
      expect(isBpmnEventDefinitionAllowed(kind, 'none')).toBe(true);
    }
  });
});

describe('совместимость связей (23.1)', () => {
  const actor: BoardDiagramContent = {
    type: 'diagram',
    notation: 'uml',
    kind: 'actor',
    text: 'User',
  };
  const useCase: BoardDiagramContent = {
    type: 'diagram',
    notation: 'uml',
    kind: 'use-case',
    text: 'Login',
  };
  const classA: BoardDiagramContent = {
    type: 'diagram',
    notation: 'uml',
    kind: 'class',
    text: 'A',
    attributes: [],
    operations: [],
  };
  const interfaceA: BoardDiagramContent = {
    type: 'diagram',
    notation: 'uml',
    kind: 'interface',
    text: 'IA',
    attributes: [],
    operations: [],
  };

  it('association допустим между actor и use-case', () => {
    const semantic: BoardDiagramEdgeSemantic = { notation: 'uml', kind: 'association' };
    expect(isDiagramEdgeSemanticCompatible(semantic, actor, useCase)).toBe(true);
  });

  it('generalization недопустим между разными kind (class -> interface)', () => {
    const semantic: BoardDiagramEdgeSemantic = { notation: 'uml', kind: 'generalization' };
    expect(isDiagramEdgeSemanticCompatible(semantic, classA, interfaceA)).toBe(false);
  });

  it('realization допустим class -> interface', () => {
    const semantic: BoardDiagramEdgeSemantic = { notation: 'uml', kind: 'realization' };
    expect(isDiagramEdgeSemanticCompatible(semantic, classA, interfaceA)).toBe(true);
  });

  it('семантика другой нотации несовместима (uml vs bpmn kind)', () => {
    const bpmnTask: BoardDiagramContent = {
      type: 'diagram',
      notation: 'bpmn',
      kind: 'task',
      text: 'T',
    };
    const semantic: BoardDiagramEdgeSemantic = { notation: 'uml', kind: 'association' };
    expect(isDiagramEdgeSemanticCompatible(semantic, actor, bpmnTask)).toBe(false);
  });

  it('фиксирует полный набор значений семантики связей', () => {
    expect(UML_EDGE_SEMANTICS).toHaveLength(6);
    expect(BPMN_EDGE_SEMANTICS).toEqual(['sequence', 'message', 'association']);
  });
});

describe('isValidDiagramContent (23.1)', () => {
  it('принимает валидный class с атрибутами', () => {
    expect(
      isValidDiagramContent({
        type: 'diagram',
        notation: 'uml',
        kind: 'class',
        text: 'Order',
        attributes: [{ name: 'id', visibility: 'private', dataType: 'string' }],
        operations: [],
      }),
    ).toBe(true);
  });

  it('отклоняет enum с непустым operations', () => {
    expect(
      isValidDiagramContent({
        type: 'diagram',
        notation: 'uml',
        kind: 'enum',
        text: 'Status',
        attributes: [{ name: 'ACTIVE', visibility: 'public' }],
        operations: [{ name: 'oops', visibility: 'public' }],
      }),
    ).toBe(false);
  });

  it('отклоняет неизвестный kind', () => {
    expect(
      isValidDiagramContent({ type: 'diagram', notation: 'uml', kind: 'nonexistent', text: 'x' }),
    ).toBe(false);
  });

  it('отклоняет BPMN-событие с недопустимым eventDefinition', () => {
    expect(
      isValidDiagramContent({
        type: 'diagram',
        notation: 'bpmn',
        kind: 'event-end',
        text: 'Done',
        eventDefinition: 'timer',
      }),
    ).toBe(false);
  });

  it('отклоняет не-объект и объект без type', () => {
    expect(isValidDiagramContent(null)).toBe(false);
    expect(isValidDiagramContent('diagram')).toBe(false);
    expect(isValidDiagramContent({ notation: 'uml', kind: 'actor', text: 'x' })).toBe(false);
  });

  it('отклоняет operation без обязательных полей, даже если parameters — валидный массив', () => {
    // Регрессия на баг с приоритетом && / || в проверке operations: невалидный
    // member (нет name/visibility) с `parameters: []` раньше проходил проверку,
    // потому что `Array.isArray(parameters)` перекрывал результат isValidMember
    // через отсутствие скобок в `A && B || C`.
    expect(
      isValidDiagramContent({
        type: 'diagram',
        notation: 'uml',
        kind: 'class',
        text: 'Order',
        attributes: [],
        operations: [{ parameters: [] }],
      }),
    ).toBe(false);
  });
});

describe('createDefaultDiagramContent (23.3)', () => {
  it('заполняет attributes/operations для class/interface/enum', () => {
    for (const kind of ['class', 'interface', 'enum'] as const) {
      const content = createDefaultDiagramContent('uml', kind);
      expect(isValidDiagramContent(content)).toBe(true);
      expect(content).toMatchObject({ attributes: [], operations: [] });
    }
  });

  it('заполняет eventDefinition для BPMN-событий', () => {
    for (const kind of ['event-start', 'event-intermediate', 'event-end'] as const) {
      const content = createDefaultDiagramContent('bpmn', kind);
      expect(isValidDiagramContent(content)).toBe(true);
      expect(content).toMatchObject({ eventDefinition: 'none' });
    }
  });

  it('не добавляет лишних полей у простых kind', () => {
    const content = createDefaultDiagramContent('uml', 'actor');
    expect(isValidDiagramContent(content)).toBe(true);
    expect(content).toEqual({ type: 'diagram', notation: 'uml', kind: 'actor', text: '' });
  });
});

describe('типовая форма union (23.1)', () => {
  it('BoardDiagramContent дискриминируется по notation+kind', () => {
    expectTypeOf<BoardDiagramContent['type']>().toEqualTypeOf<'diagram'>();
    expectTypeOf<BoardDiagramContent['notation']>().toEqualTypeOf<'uml' | 'bpmn'>();
  });
});
