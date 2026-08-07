<script setup lang="ts">
/**
 * Плавающий тулбар над выделенной связью (12.8) — по образцу
 * `BoardSelectionToolbar.vue` (тот же чехол/позиционирование), но со своими
 * копиями CSS-классов: `<style scoped>` в Vue не расшаривается между
 * компонентами даже при совпадении имён классов, только у себя внутри.
 *
 * Подпись пишется не в поле здесь, а прямо на стрелке (Miro-паттерн, решение
 * пользователя) — кнопка «текст» лишь открывает этот ввод (см. `BoardFloatingEdge.vue`).
 */
import { BOARD_COLOR_PALETTE, type BoardColorHex } from '@poker/shared';
import { useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

export type BoardEdgeLineKindOption = 'straight' | 'orthogonal' | 'curved';
export type BoardEdgeMarkerOption = 'none' | 'arrow' | 'dot';

const LINE_OPTIONS: readonly BoardEdgeLineKindOption[] = ['straight', 'orthogonal', 'curved'];
const MARKER_OPTIONS: readonly BoardEdgeMarkerOption[] = ['none', 'arrow', 'dot'];

const LINE_ICONS: Record<BoardEdgeLineKindOption, string> = {
  straight: 'i-lucide-minus',
  orthogonal: 'i-lucide-corner-down-right',
  curved: 'i-lucide-spline',
};

/** Иконка триггера — направление стрелки должно совпадать со стороной (начало/конец),
 * иначе непонятно, чем «стрелка вверх» отличается от «стрелка вниз» у одной и той же связи */
const MARKER_START_ICONS: Record<BoardEdgeMarkerOption, string> = {
  none: 'i-lucide-x',
  arrow: 'i-lucide-arrow-left',
  dot: 'i-lucide-circle',
};
const MARKER_END_ICONS: Record<BoardEdgeMarkerOption, string> = {
  none: 'i-lucide-x',
  arrow: 'i-lucide-arrow-right',
  dot: 'i-lucide-circle',
};

const props = defineProps<{
  left: number;
  top: number;
  currentLine: BoardEdgeLineKindOption;
  currentMarkerStart: BoardEdgeMarkerOption;
  currentMarkerEnd: BoardEdgeMarkerOption;
  currentColor: BoardColorHex;
}>();

const emit = defineEmits<{
  line: [kind: BoardEdgeLineKindOption];
  markerStart: [kind: BoardEdgeMarkerOption];
  markerEnd: [kind: BoardEdgeMarkerOption];
  color: [hex: BoardColorHex];
  addText: [];
  delete: [];
}>();

const { t } = useI18n();

const colorInputEl = useTemplateRef<HTMLInputElement>('colorInput');

function openCustomColorPicker(): void {
  colorInputEl.value?.click();
}

function onCustomColor(event: Event): void {
  emit('color', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div
    class="board-edge-toolbar"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @click.stop
    @dblclick.stop
  >
    <UPopover :content="{ side: 'top' }">
      <button type="button" class="board-selection-icon-btn" :aria-label="t('board.edgeLineLabel')">
        <UIcon :name="LINE_ICONS[props.currentLine]" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-form-menu">
          <button
            v-for="kind in LINE_OPTIONS"
            :key="kind"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': kind === props.currentLine }"
            :aria-label="t(`board.edgeLines.${kind}`)"
            :title="t(`board.edgeLines.${kind}`)"
            @click="emit('line', kind)"
          >
            <UIcon :name="LINE_ICONS[kind]" class="size-4" />
          </button>
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />

    <UPopover :content="{ side: 'top' }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.edgeMarkerStartLabel')"
      >
        <UIcon :name="MARKER_START_ICONS[props.currentMarkerStart]" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-form-menu">
          <button
            v-for="kind in MARKER_OPTIONS"
            :key="kind"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': kind === props.currentMarkerStart }"
            :aria-label="t(`board.edgeMarkers.${kind}`)"
            :title="t(`board.edgeMarkers.${kind}`)"
            @click="emit('markerStart', kind)"
          >
            <UIcon :name="MARKER_START_ICONS[kind]" class="size-4" />
          </button>
        </div>
      </template>
    </UPopover>

    <UPopover :content="{ side: 'top' }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.edgeMarkerEndLabel')"
      >
        <UIcon :name="MARKER_END_ICONS[props.currentMarkerEnd]" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-form-menu">
          <button
            v-for="kind in MARKER_OPTIONS"
            :key="kind"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': kind === props.currentMarkerEnd }"
            :aria-label="t(`board.edgeMarkers.${kind}`)"
            :title="t(`board.edgeMarkers.${kind}`)"
            @click="emit('markerEnd', kind)"
          >
            <UIcon :name="MARKER_END_ICONS[kind]" class="size-4" />
          </button>
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />

    <UPopover :content="{ side: 'top' }">
      <button
        type="button"
        class="board-selection-swatch"
        :style="{ backgroundColor: props.currentColor }"
        :aria-label="t('board.colorPickerLabel')"
      />

      <template #content="{ close }">
        <div class="board-color-menu">
          <button
            v-for="hex in BOARD_COLOR_PALETTE"
            :key="hex"
            type="button"
            class="board-selection-swatch"
            :class="{ 'board-selection-swatch-active': hex === props.currentColor }"
            :style="{ backgroundColor: hex }"
            :aria-label="hex"
            @click="
              emit('color', hex);
              close();
            "
          />
          <button
            type="button"
            class="board-color-add-btn"
            :aria-label="t('board.addCustomColor')"
            @click="openCustomColorPicker"
          >
            <UIcon name="i-lucide-pipette" class="size-3.5" />
          </button>
          <input
            ref="colorInput"
            type="color"
            class="sr-only"
            :value="props.currentColor"
            @input="
              onCustomColor($event);
              close();
            "
          />
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />

    <button
      type="button"
      class="board-selection-icon-btn"
      :aria-label="t('board.edgeAddText')"
      :title="t('board.edgeAddText')"
      @click="emit('addText')"
    >
      <UIcon name="i-lucide-type" class="size-3.5" />
    </button>

    <div class="board-selection-divider" />
    <button
      type="button"
      class="board-selection-icon-btn board-selection-icon-btn-danger"
      :aria-label="t('board.deleteSelected')"
      @click="emit('delete')"
    >
      <UIcon name="i-lucide-trash-2" class="size-3.5" />
    </button>
  </div>
</template>

<style scoped>
.board-edge-toolbar {
  position: absolute;
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 7px 8px;
  white-space: nowrap;
  background: var(--brand-surface);
  border-radius: 12px;
  box-shadow: var(--brand-shadow-card);
  transform: translate(-50%, calc(-100% - 12px));
}

.board-selection-swatch {
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  cursor: pointer;
  border: none;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 8%);
}

.board-selection-swatch-active {
  box-shadow: inset 0 0 0 2px var(--ui-primary);
}

.board-color-menu {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 10px;
}

.board-color-add-btn {
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink);
  cursor: pointer;
  background: var(--ui-bg-elevated);
  border: none;
  border-radius: 50%;
}

.board-form-menu {
  display: flex;
  gap: 2px;
  padding: 6px;
}

.board-form-menu-item {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
}

.board-form-menu-item:hover {
  background: var(--ui-bg-elevated);
}

.board-form-menu-item-active {
  color: var(--ui-primary);
  background: var(--ui-bg-elevated);
}

.board-selection-divider {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--brand-border);
}

.board-selection-icon-btn {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
}

.board-selection-icon-btn:hover {
  background: var(--ui-bg-elevated);
}

.board-selection-icon-btn-danger {
  color: var(--brand-coral);
}

.board-selection-icon-btn-danger:hover {
  background: color-mix(in oklch, var(--brand-coral) 12%, transparent);
}
</style>
