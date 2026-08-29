import type { BoardDiagramUmlCompartmentContent } from '@estimate/shared';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

import { useBoardSessionStore } from '../src/stores/board-session';
import { useBoardDiagramProperties } from '../src/features/boards/composables/use-board-diagram-properties';

function classContent(
  overrides: Partial<BoardDiagramUmlCompartmentContent> = {},
): BoardDiagramUmlCompartmentContent {
  return {
    type: 'diagram',
    notation: 'uml',
    kind: 'class',
    text: 'Order',
    attributes: [],
    operations: [],
    ...overrides,
  };
}

function mountProperties(content: BoardDiagramUmlCompartmentContent, canEdit = true) {
  const TestWrapper = defineComponent({
    setup() {
      const contentRef = ref(content);
      const canEditRef = ref(canEdit);
      const result = useBoardDiagramProperties({
        itemId: 'item-1',
        canEdit: canEditRef,
        content: contentRef,
      });
      return { canEdit: canEditRef, content: contentRef, ...result };
    },
    template: '<div></div>',
  });
  return mount(TestWrapper);
}

describe('useBoardDiagramProperties (23.3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('commit() отправляет item.patch с очищенными атрибутами/операциями', () => {
    const boardSession = useBoardSessionStore();
    const applyOps = vi.spyOn(boardSession, 'applyOps').mockResolvedValue(0);
    const wrapper = mountProperties(classContent());

    wrapper.vm.attributes.push({ name: 'id', dataType: 'string', visibility: 'private' });
    wrapper.vm.commit();

    expect(applyOps).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'item.patch',
        id: 'item-1',
        patch: {
          content: {
            type: 'diagram',
            notation: 'uml',
            kind: 'class',
            text: 'Order',
            attributes: [{ name: 'id', dataType: 'string', visibility: 'private' }],
            operations: [],
          },
        },
      }),
    ]);

    wrapper.unmount();
  });

  it('строка с пустым именем не попадает в патч (тихо отбрасывается)', () => {
    const boardSession = useBoardSessionStore();
    const applyOps = vi.spyOn(boardSession, 'applyOps').mockResolvedValue(0);
    const wrapper = mountProperties(classContent());

    wrapper.vm.attributes.push({ name: '   ', dataType: 'string', visibility: 'public' });
    wrapper.vm.commit();

    // Пустой черновик эквивалентен исходному content (attributes: []) — no-op, applyOps не зовётся
    expect(applyOps).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('enum — operations всегда пустой массив в патче, даже если черновик что-то содержал', () => {
    const boardSession = useBoardSessionStore();
    const applyOps = vi.spyOn(boardSession, 'applyOps').mockResolvedValue(0);
    const wrapper = mountProperties(classContent({ kind: 'enum', text: 'Status' }));

    wrapper.vm.attributes.push({ name: 'ACTIVE', dataType: '', visibility: 'public' });
    wrapper.vm.commit();

    expect(applyOps).toHaveBeenCalledWith([
      expect.objectContaining({
        patch: {
          content: expect.objectContaining({
            kind: 'enum',
            // видимость enum-литерала всегда 'public', dataType не сохраняется
            attributes: [{ name: 'ACTIVE', visibility: 'public' }],
            operations: [],
          }),
        },
      }),
    ]);

    wrapper.unmount();
  });

  it('commit() — no-op, если lockedBy (другой участник держит блокировку)', () => {
    const boardSession = useBoardSessionStore();
    boardSession.editingByItem.set('item-1', { participantId: 'u2', name: 'Мария' });
    const applyOps = vi.spyOn(boardSession, 'applyOps').mockResolvedValue(0);
    const wrapper = mountProperties(classContent());

    expect(wrapper.vm.lockedBy).toMatchObject({ participantId: 'u2' });

    wrapper.vm.attributes.push({ name: 'id', dataType: '', visibility: 'public' });
    wrapper.vm.commit();

    expect(applyOps).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('onPanelFocusIn/onPanelFocusOut шлют awareness active=true/false', async () => {
    const boardSession = useBoardSessionStore();
    const sendAwareness = vi.spyOn(boardSession, 'sendAwareness');
    const wrapper = mountProperties(classContent());

    wrapper.vm.onPanelFocusIn();
    await nextTick();
    expect(sendAwareness).toHaveBeenCalledWith('editing', { itemId: 'item-1', active: true });

    const outEvent = { relatedTarget: null } as unknown as FocusEvent;
    wrapper.vm.onPanelFocusOut(outEvent, null);
    await nextTick();
    expect(sendAwareness).toHaveBeenCalledWith('editing', { itemId: 'item-1', active: false });

    wrapper.unmount();
  });

  it('onPanelFocusOut не гасит editing, если фокус ушёл на другой элемент ВНУТРИ панели', async () => {
    const boardSession = useBoardSessionStore();
    const sendAwareness = vi.spyOn(boardSession, 'sendAwareness');
    const wrapper = mountProperties(classContent());

    wrapper.vm.onPanelFocusIn();
    await nextTick();
    sendAwareness.mockClear();

    const panelEl = document.createElement('div');
    const innerField = document.createElement('input');
    panelEl.appendChild(innerField);
    const outEvent = { relatedTarget: innerField } as unknown as FocusEvent;
    wrapper.vm.onPanelFocusOut(outEvent, panelEl);
    await nextTick();

    expect(sendAwareness).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('removeAttribute/removeOperation коммитят немедленно', () => {
    const boardSession = useBoardSessionStore();
    const applyOps = vi.spyOn(boardSession, 'applyOps').mockResolvedValue(0);
    const wrapper = mountProperties(
      classContent({
        attributes: [{ name: 'id', visibility: 'public' }],
        operations: [{ name: 'save', visibility: 'public' }],
      }),
    );

    wrapper.vm.removeAttribute(0);
    expect(applyOps).toHaveBeenCalledTimes(1);

    wrapper.vm.removeOperation(0);
    expect(applyOps).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it('addAttribute/addOperation уважают лимит каталога (24)', () => {
    const wrapper = mountProperties(
      classContent({
        attributes: Array.from({ length: 24 }, (_, i) => ({
          name: `a${i}`,
          visibility: 'public' as const,
        })),
      }),
    );

    expect(wrapper.vm.canAddAttribute).toBe(false);
    const before = wrapper.vm.attributes.length;
    wrapper.vm.addAttribute();
    expect(wrapper.vm.attributes.length).toBe(before);

    wrapper.unmount();
  });
});
