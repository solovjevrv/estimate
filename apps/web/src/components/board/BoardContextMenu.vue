<script setup lang="ts">
/**
 * Контекстное меню по правой кнопке мыши (12.9) — на карточке (стикер/фигура)
 * и на связи. На пустом холсте меню не показываем вовсе (см. `onPaneContextMenu`
 * в `BoardCanvas.vue`) — пунктов под пустое место в объёме задачи нет (вставка
 * из буфера — 13.5), а пустой попап хуже отсутствия меню.
 *
 * Слои (вперёд/назад) и дублирование переехали сюда из тулбара выделения
 * (решение пользователя 07.08.2026) — как менее часто используемые действия.
 *
 * Закрытие — по клику вне меню (слушатель на `window` в capture-фазе, вешается
 * только пока меню смонтировано) или по Escape. Открывающий правый клик не
 * триггерит закрытие: слушатель вешается в `onMounted`, уже ПОСЛЕ того, как
 * открывающее событие (`contextmenu`) полностью отработало.
 */
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

export type BoardContextMenuTarget = 'item' | 'edge';

const props = defineProps<{
  left: number;
  top: number;
  target: BoardContextMenuTarget;
  /** Группировка возможна: 2+ элементов выделено и среди них нет уже готового контейнера (14.3) */
  canGroup?: boolean;
  /** Разгруппировка возможна: хотя бы один выделенный элемент сейчас внутри контейнера (14.3) */
  canUngroup?: boolean;
}>();

const emit = defineEmits<{
  bringToFront: [];
  sendToBack: [];
  duplicate: [];
  group: [];
  ungroup: [];
  addText: [];
  delete: [];
  close: [];
}>();

const { t } = useI18n();
const rootEl = useTemplateRef<HTMLDivElement>('root');

function onPointerDownOutside(event: PointerEvent): void {
  if (rootEl.value && !rootEl.value.contains(event.target as Node)) emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDownOutside, true);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDownOutside, true);
  window.removeEventListener('keydown', onKeydown);
});

function act(fn: () => void): void {
  fn();
  emit('close');
}
</script>

<template>
  <div
    ref="root"
    class="board-context-menu"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @contextmenu.prevent
    @click.stop
    @dblclick.stop
  >
    <template v-if="target === 'item'">
      <button
        type="button"
        class="board-context-menu-item"
        @click="act(() => emit('bringToFront'))"
      >
        <UIcon name="i-lucide-bring-to-front" class="size-4" />
        {{ t('board.bringToFront') }}
      </button>
      <button type="button" class="board-context-menu-item" @click="act(() => emit('sendToBack'))">
        <UIcon name="i-lucide-send-to-back" class="size-4" />
        {{ t('board.sendToBack') }}
      </button>
      <button type="button" class="board-context-menu-item" @click="act(() => emit('duplicate'))">
        <UIcon name="i-lucide-copy" class="size-4" />
        {{ t('board.duplicateSelected') }}
      </button>
      <!-- Группировка (14.3) — только для элементов, не для связей -->
      <button
        type="button"
        class="board-context-menu-item"
        :disabled="!props.canGroup"
        @click="act(() => emit('group'))"
      >
        <UIcon name="i-lucide-frame" class="size-4" />
        {{ t('board.groupSelection') }}
      </button>
      <button
        type="button"
        class="board-context-menu-item"
        :disabled="!props.canUngroup"
        @click="act(() => emit('ungroup'))"
      >
        <UIcon name="i-lucide-ungroup" class="size-4" />
        {{ t('board.ungroupSelection') }}
      </button>
      <div class="board-context-menu-divider" />
    </template>
    <template v-else>
      <button type="button" class="board-context-menu-item" @click="act(() => emit('addText'))">
        <UIcon name="i-lucide-type" class="size-4" />
        {{ t('board.edgeAddText') }}
      </button>
      <div class="board-context-menu-divider" />
    </template>
    <button
      type="button"
      class="board-context-menu-item board-context-menu-item-danger"
      @click="act(() => emit('delete'))"
    >
      <UIcon name="i-lucide-trash-2" class="size-4" />
      {{ t('board.deleteSelected') }}
    </button>
  </div>
</template>

<style scoped>
.board-context-menu {
  position: absolute;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 200px;
  padding: 6px;
  background: var(--brand-surface);
  border-radius: 12px;
  box-shadow: var(--brand-shadow-card);
}

.board-context-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  color: var(--brand-ink);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
}

.board-context-menu-item:hover {
  background: var(--ui-bg-elevated);
}

.board-context-menu-item:disabled {
  cursor: default;
  opacity: 0.4;
}

.board-context-menu-item:disabled:hover {
  background: transparent;
}

.board-context-menu-item-danger {
  color: var(--brand-coral);
}

.board-context-menu-item-danger:hover {
  background: color-mix(in oklch, var(--brand-coral) 12%, transparent);
}

.board-context-menu-divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--brand-border);
}
</style>
