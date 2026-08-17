<script setup lang="ts">
/**
 * Плавающий тулбар над выделенной связью (12.8) — по образцу
 * `BoardSelectionToolbar.vue` (тот же чехол/позиционирование), но со своими
 * копиями CSS-классов: `<style scoped>` в Vue не расшаривается между
 * компонентами даже при совпадении имён классов, только у себя внутри.
 *
 * Подпись пишется не в поле здесь, а прямо на стрелке (Miro-паттерн, решение
 * пользователя) — кнопка «текст» лишь открывает этот ввод (см. `BoardFloatingEdge.vue`).
 *
 * Цвет стрелки (12.8) — палитра + кастомный цвет через `UColorPicker`
 * (18.3 — замена нативного `<input type="color">`).
 */
import { type BoardColorHex } from '@poker/shared';
import { useI18n } from 'vue-i18n';

import BoardColorPickerMenu from './BoardColorPickerMenu.vue';

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
  /** Живое превью из кастомного UColorPicker (18.4) — своё событие, не
   * `color`, см. пояснение у одноимённого emit в BoardSelectionToolbar.vue
   * и у previewEdgeColor в BoardCanvas.vue. */
  colorPreview: [hex: BoardColorHex];
  /** Откат брошенного превью (18.4) — см. пояснение у `cancel` в
   * BoardColorPickerMenu.vue и у `previewEdgeColor`/`edgeColorPreviewIds`
   * в use-board-edges.ts.
   *
   * Эмит без payload: исходные per-edge цвета хранит composable (use-board-edges),
   * а аргумент пикера — theme-resolved и не годится для восстановления `undefined`
   * адаптивной связи, поэтому он здесь намеренно отбрасывается. */
  colorCancel: [];
  addText: [];
  delete: [];
}>();

const { t } = useI18n();

/** Цвет стрелки из пикера (18.4) — обёртка над emit, чтобы не писать
 * многострелку в атрибуте @pick (Vue-компилятор не парсит такие). */
function pickColor(hex: BoardColorHex, close: () => void): void {
  emit('color', hex);
  close();
}

function previewColor(hex: BoardColorHex): void {
  emit('colorPreview', hex);
}

function cancelColor(): void {
  emit('colorCancel');
}
</script>

<template>
  <div
    class="board-edge-toolbar board-toolbar-base"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @click.stop
    @dblclick.stop
  >
    <UPopover :content="{ side: 'top', sideOffset: 20 }">
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

    <UPopover :content="{ side: 'top', sideOffset: 20 }">
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

    <UPopover :content="{ side: 'top', sideOffset: 20 }">
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

    <UPopover :content="{ side: 'top', sideOffset: 20 }">
      <button
        type="button"
        class="board-selection-swatch"
        :style="{ backgroundColor: props.currentColor }"
        :aria-label="t('board.colorPickerLabel')"
      />

      <template #content="{ close }">
        <BoardColorPickerMenu
          :current-color="props.currentColor"
          @pick="(hex) => pickColor(hex, close)"
          @preview="previewColor"
          @cancel="cancelColor"
        />
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
@import './shared/board-toolbar.css';
</style>
