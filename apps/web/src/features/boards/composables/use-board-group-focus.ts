import { ref, watch, type Ref } from 'vue';

import type { BoardSelectionNode } from '../adapters/vue-flow-adapter';

/**
 * Вход в группу (18.19, как в Miro/Figma). Вне группы клик по её участнику
 * выделяет группу целиком — иначе не видно, что элемент в группе, а драг
 * всё равно двигал бы её всю. Двойной клик по участнику «входит» в группу:
 * внутри неё клики выделяют отдельные элементы, следующий двойной клик — уже
 * редактирование текста.
 */
export function useBoardGroupFocus(
  /** Все живые узлы Vue Flow — `.selected` мутируется на них напрямую */
  getNodes: () => BoardSelectionNode[],
  selectedNodes: Readonly<Ref<BoardSelectionNode[]>>,
  selectOnlyNode: (node: BoardSelectionNode) => void,
) {
  /**
   * Группа, в которую вошли. Выход — как только в выделении не осталось её
   * участников (клик мимо, по другому элементу, по самой рамке группы).
   */
  const enteredGroupId = ref<string | null>(null);

  watch(selectedNodes, (nodes) => {
    if (enteredGroupId.value === null) return;
    if (!nodes.some((n) => n.data.parentId === enteredGroupId.value)) enteredGroupId.value = null;
  });

  /** Группа-родитель участника (не фрейм — фрейм мини-холст, его дети выделяются сами) */
  function parentGroupOf(node: BoardSelectionNode): BoardSelectionNode | undefined {
    const parentId = node.data.parentId;
    if (parentId === null) return undefined;
    const parent = getNodes().find((candidate) => candidate.id === parentId);
    return parent?.data.content.type === 'group' ? parent : undefined;
  }

  /**
   * Vue Flow уже выделил участника (клик/старт драга/правый клик) — переносим
   * выделение на его группу, если в неё не вошли. Аддитивность выделения
   * (Shift и т.п.) Vue Flow уже учёл, здесь только замена участника на группу.
   */
  function redirectSelectionToGroup(node: BoardSelectionNode): void {
    const group = parentGroupOf(node);
    if (!group || enteredGroupId.value === group.id) return;
    node.selected = false;
    group.selected = true;
  }

  /** Старт драга (18.19): перетаскиваемые участники группы — выделение на группу */
  function onNodeDragStart(args: { nodes: BoardSelectionNode[] }): void {
    for (const node of args.nodes) redirectSelectionToGroup(node);
  }

  /**
   * Двойной клик по участнику группы, в которую не вошли, — вход в неё с
   * выделением этого элемента (18.19). Возвращает `true`, если событие поглощено:
   * Canvas тогда гасит его, и редактирование текста по двойному клику не
   * начинается — оно доступно следующим двойным кликом, уже внутри группы.
   */
  function enterGroupOnDoubleClick(nodeId: string): boolean {
    const node = getNodes().find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    const group = parentGroupOf(node);
    if (!group || enteredGroupId.value === group.id) return false;
    enteredGroupId.value = group.id;
    selectOnlyNode(node);
    return true;
  }

  return { enteredGroupId, redirectSelectionToGroup, onNodeDragStart, enterGroupOnDoubleClick };
}
