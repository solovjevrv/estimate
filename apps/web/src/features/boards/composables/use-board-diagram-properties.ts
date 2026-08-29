/**
 * Боковая панель свойств class/interface/enum (23.3) — первое место, где
 * структурные поля (`attributes`/`operations`) редактируются НЕ через общий
 * contenteditable-текст узла, а отдельной формой. Риск гонки по structured-
 * полям (см. PROGRESS.md, 23.3) закрыт тем же приёмом, что и у текста
 * (`use-rich-text-editing.ts`): общая мягкая блокировка на itemId
 * (`use-board-editing-lock.ts`) — пока панель в фокусе, текстовое
 * редактирование того же элемента у другого участника заблокировано, и
 * наоборот.
 *
 * Коммит — по blur/Enter ПОЛЯ (не всей панели и не на каждое нажатие
 * клавиши, см. решение 23.1: `item.patch` шлёт `content` целиком). Пустая по
 * имени строка (добавили «+», не заполнили) молча не попадает в патч —
 * `isValidMember` на сервере требует непустое `name`, а не безмолвно
 * отклонённая пустая строка выглядела бы как баг, не как ожидаемое поведение
 * «пустой черновик просто не сохраняется».
 */
import { computed, ref, watch, type Ref } from 'vue';
import {
  UML_CLASS_MAX_ATTRIBUTES,
  UML_CLASS_MAX_OPERATIONS,
  UML_MEMBER_DATA_TYPE_MAX_LENGTH,
  UML_MEMBER_NAME_MAX_LENGTH,
  type BoardDiagramUmlCompartmentContent,
  type UmlClassMember,
  type UmlVisibility,
} from '@estimate/shared';

import { useBoardSessionStore } from '../../../stores/board-session';
import { useBoardEditingLock } from './use-board-editing-lock';

export interface DiagramPropertyDraftRow {
  name: string;
  dataType: string;
  visibility: UmlVisibility;
}

function toDraft(member: UmlClassMember): DiagramPropertyDraftRow {
  return { name: member.name, dataType: member.dataType ?? '', visibility: member.visibility };
}

function cleanMembers(rows: DiagramPropertyDraftRow[], isEnum: boolean): UmlClassMember[] {
  return rows
    .filter((row) => row.name.trim().length > 0)
    .map((row) => ({
      name: row.name.trim(),
      // Видимость enum-литералов не рендерится и не имеет смысла (см.
      // BoardDiagramUmlCompartmentContent), но тип требует поле всегда —
      // фиксированное 'public' здесь никогда не показывается пользователю.
      visibility: isEnum ? 'public' : row.visibility,
      ...(!isEnum && row.dataType.trim() ? { dataType: row.dataType.trim() } : {}),
    }));
}

export interface UseBoardDiagramPropertiesOptions {
  itemId: string;
  canEdit: Ref<boolean>;
  content: Ref<BoardDiagramUmlCompartmentContent>;
}

export function useBoardDiagramProperties(options: UseBoardDiagramPropertiesOptions) {
  const { itemId, canEdit, content } = options;
  const boardSession = useBoardSessionStore();
  const { lockedBy, setActive } = useBoardEditingLock(itemId, canEdit);

  const editing = ref(false);
  watch(editing, setActive);

  const isEnum = computed(() => content.value.kind === 'enum');
  const attributes = ref<DiagramPropertyDraftRow[]>(content.value.attributes.map(toDraft));
  const operations = ref<DiagramPropertyDraftRow[]>(content.value.operations.map(toDraft));

  /**
   * Внешние изменения content (чужой патч, undo/redo) перезаписывают
   * черновик, только пока панель НЕ в режиме редактирования — пока мы сами
   * печатаем, блокировка (`lockedBy`) в любом случае не даёт прийти чужому
   * конкурирующему патчу на этот же элемент, так что перетирать нечем.
   */
  watch(content, (next) => {
    if (editing.value) return;
    attributes.value = next.attributes.map(toDraft);
    operations.value = next.operations.map(toDraft);
  });

  function commit(): void {
    if (!canEdit.value || lockedBy.value) return;
    const nextContent: BoardDiagramUmlCompartmentContent = {
      ...content.value,
      attributes: cleanMembers(attributes.value, isEnum.value),
      operations: isEnum.value ? [] : cleanMembers(operations.value, false),
    };
    if (JSON.stringify(nextContent) === JSON.stringify(content.value)) return;
    void boardSession.applyOps([
      {
        type: 'item.patch',
        clientOpId: crypto.randomUUID(),
        id: itemId,
        patch: { content: nextContent },
      },
    ]);
  }

  function onPanelFocusIn(): void {
    if (lockedBy.value || !canEdit.value) return;
    editing.value = true;
  }

  /** Тот же приём, что `onEditableBlur` в use-rich-text-editing.ts — коммит только когда фокус реально ушёл из панели, не между её же полями */
  function onPanelFocusOut(event: FocusEvent, panelEl: HTMLElement | null): void {
    const related = event.relatedTarget;
    if (related instanceof HTMLElement && panelEl?.contains(related)) return;
    editing.value = false;
  }

  const canAddAttribute = computed(() => attributes.value.length < UML_CLASS_MAX_ATTRIBUTES);
  const canAddOperation = computed(() => operations.value.length < UML_CLASS_MAX_OPERATIONS);

  function addAttribute(): void {
    if (!canAddAttribute.value) return;
    attributes.value = [...attributes.value, { name: '', dataType: '', visibility: 'public' }];
  }

  function removeAttribute(index: number): void {
    attributes.value = attributes.value.filter((_, i) => i !== index);
    commit();
  }

  function addOperation(): void {
    if (!canAddOperation.value) return;
    operations.value = [...operations.value, { name: '', dataType: '', visibility: 'public' }];
  }

  function removeOperation(index: number): void {
    operations.value = operations.value.filter((_, i) => i !== index);
    commit();
  }

  return {
    isEnum,
    attributes,
    operations,
    lockedBy,
    canAddAttribute,
    canAddOperation,
    addAttribute,
    removeAttribute,
    addOperation,
    removeOperation,
    commit,
    onPanelFocusIn,
    onPanelFocusOut,
    nameMaxLength: UML_MEMBER_NAME_MAX_LENGTH,
    dataTypeMaxLength: UML_MEMBER_DATA_TYPE_MAX_LENGTH,
  };
}
