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
import {
  BOARD_ITEM_FONT_SIZE_MAX,
  BOARD_ITEM_FONT_SIZE_MIN,
  BOARD_TEXT_ALIGNS,
  type BoardColorHex,
  type BoardTextAlign,
} from '@estimate/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { FormatMarkKey } from '../../features/boards/composables/use-rich-text-editing';
import BoardColorPickerMenu from './BoardColorPickerMenu.vue';
import BoardFormatButtons from './BoardFormatButtons.vue';

export type BoardEdgeLineKindOption = 'straight' | 'orthogonal' | 'curved';
export type BoardEdgeDashOption = 'solid' | 'dashed' | 'dotted';
export type BoardEdgeMarkerOption = 'none' | 'arrow' | 'dot';

const LINE_OPTIONS: readonly BoardEdgeLineKindOption[] = ['straight', 'orthogonal', 'curved'];
const DASH_OPTIONS: readonly BoardEdgeDashOption[] = ['solid', 'dashed', 'dotted'];
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

const ALIGN_ICONS: Record<BoardTextAlign, string> = {
  left: 'i-lucide-align-left',
  center: 'i-lucide-align-center',
  right: 'i-lucide-align-right',
};

const FONT_SIZE_STEP = 2;

const props = defineProps<{
  left: number;
  top: number;
  currentLine: BoardEdgeLineKindOption;
  currentDash: BoardEdgeDashOption;
  currentMarkerStart: BoardEdgeMarkerOption;
  currentMarkerEnd: BoardEdgeMarkerOption;
  currentColor: BoardColorHex;
  currentLabelFontSize: number;
  currentLabelTextAlign: BoardTextAlign;
  currentLabelTextColor: BoardColorHex;
  currentLabelBold: boolean;
  currentLabelItalic: boolean;
  currentLabelUnderline: boolean;
  currentLabelStrike: boolean;
}>();

const emit = defineEmits<{
  line: [kind: BoardEdgeLineKindOption];
  dash: [kind: BoardEdgeDashOption];
  markerStart: [kind: BoardEdgeMarkerOption];
  markerEnd: [kind: BoardEdgeMarkerOption];
  color: [hex: BoardColorHex];
  /** Живое превью из кастомного UColorPicker (18.4) — своё событие, не
   * `color`, см. пояснение у одноимённого emit в BoardSelectionToolbar.vue
   * и у previewEdgeColor в BoardCanvas.vue. */
  colorPreview: [hex: BoardColorHex];
  /** Откат брошенного превью (18.4) — см. пояснение у `cancel` в
   * BoardColorPickerMenu.vue и у `previewEdgeColor`/`edgeColorPreviewIds`
   * в use-board-edges.ts. */
  colorCancel: [hex: BoardColorHex];
  labelFontSize: [size: number];
  labelTextAlign: [align: BoardTextAlign];
  labelTextColor: [hex: BoardColorHex];
  labelBold: [bold: boolean];
  labelItalic: [italic: boolean];
  labelUnderline: [underline: boolean];
  labelStrike: [strike: boolean];
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

function cancelColor(hex: BoardColorHex): void {
  emit('colorCancel', hex);
}

/** Цвет текста подписи из инлайн-пикера (12.18) — как pickTextColor в
 * BoardSelectionToolbar.vue: инлайн-режим внутри уже открытого попапа «Aa»
 * не даёт callback close (не отдельный popover), закрывать нечего. Без
 * live-preview драга (в отличие от цвета связи/текста стикеров, 18.4) —
 * сознательно упрощённая версия, коммит сразу по выбору. */
function pickLabelTextColor(hex: BoardColorHex): void {
  emit('labelTextColor', hex);
}

function clampFontSize(size: number): number {
  return Math.max(BOARD_ITEM_FONT_SIZE_MIN, Math.min(BOARD_ITEM_FONT_SIZE_MAX, size));
}

function stepLabelFontSize(delta: number): void {
  emit('labelFontSize', clampFontSize(props.currentLabelFontSize + delta));
}

/**
 * Начертание подписи (12.18) — общий BoardFormatButtons.vue с
 * BoardSelectionToolbar.vue, но переключатель на весь текст целиком (не
 * per-символьная разметка): `toggle` эмиттит конкретный ключ, здесь просто
 * инвертируем соответствующее булево поле текущего состояния.
 */
const activeLabelFormatKeys = computed<FormatMarkKey[]>(() => {
  const keys: FormatMarkKey[] = [];
  if (props.currentLabelBold) keys.push('bold');
  if (props.currentLabelItalic) keys.push('italic');
  if (props.currentLabelUnderline) keys.push('underline');
  if (props.currentLabelStrike) keys.push('strike');
  return keys;
});

function onToggleLabelFormat(key: FormatMarkKey): void {
  switch (key) {
    case 'bold':
      emit('labelBold', !props.currentLabelBold);
      break;
    case 'italic':
      emit('labelItalic', !props.currentLabelItalic);
      break;
    case 'underline':
      emit('labelUnderline', !props.currentLabelUnderline);
      break;
    case 'strike':
      emit('labelStrike', !props.currentLabelStrike);
      break;
  }
}
</script>

<template>
  <div
    data-testid="board-edge-toolbar"
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

    <UPopover :content="{ side: 'top', sideOffset: 20 }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.edgeDashLabel')"
        :title="t('board.edgeDashLabel')"
      >
        <span
          class="board-edge-dash-preview"
          :class="`board-edge-dash-preview--${props.currentDash}`"
        />
      </button>

      <template #content>
        <div class="board-form-menu">
          <button
            v-for="kind in DASH_OPTIONS"
            :key="kind"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': kind === props.currentDash }"
            :aria-label="t(`board.edgeDashes.${kind}`)"
            :title="t(`board.edgeDashes.${kind}`)"
            @click="emit('dash', kind)"
          >
            <span class="board-edge-dash-preview" :class="`board-edge-dash-preview--${kind}`" />
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

    <!-- Aa: размер шрифта + цвет текста подписи (12.18) -->
    <UPopover :content="{ side: 'top', sideOffset: 20 }">
      <button
        type="button"
        class="board-selection-icon-btn board-text-options-btn"
        :aria-label="t('board.textOptionsLabel')"
      >
        Aa
      </button>

      <template #content>
        <div class="board-text-menu">
          <div class="board-text-menu-row">
            <span class="board-text-menu-label">{{ t('board.fontSizeLabel') }}</span>
            <div class="board-stepper">
              <button
                type="button"
                class="board-stepper-btn"
                :disabled="props.currentLabelFontSize <= BOARD_ITEM_FONT_SIZE_MIN"
                :aria-label="t('board.fontSizeDecrease')"
                @click="stepLabelFontSize(-FONT_SIZE_STEP)"
              >
                <UIcon name="i-lucide-minus" class="size-3" />
              </button>
              <span class="board-stepper-value">{{ props.currentLabelFontSize }}</span>
              <button
                type="button"
                class="board-stepper-btn"
                :disabled="props.currentLabelFontSize >= BOARD_ITEM_FONT_SIZE_MAX"
                :aria-label="t('board.fontSizeIncrease')"
                @click="stepLabelFontSize(FONT_SIZE_STEP)"
              >
                <UIcon name="i-lucide-plus" class="size-3" />
              </button>
            </div>
          </div>

          <div class="board-text-menu-row">
            <span class="board-text-menu-label">{{ t('board.textColorLabel') }}</span>
            <BoardColorPickerMenu
              inline
              :current-color="props.currentLabelTextColor"
              @pick="pickLabelTextColor"
            />
          </div>
        </div>
      </template>
    </UPopover>

    <!-- Выравнивание текста подписи (12.18) -->
    <UPopover :content="{ side: 'top', sideOffset: 20 }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.textAlignLabel')"
      >
        <UIcon :name="ALIGN_ICONS[props.currentLabelTextAlign]" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-form-menu">
          <button
            v-for="align in BOARD_TEXT_ALIGNS"
            :key="align"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': align === props.currentLabelTextAlign }"
            :aria-label="t(`board.aligns.${align}`)"
            :title="t(`board.aligns.${align}`)"
            @click="emit('labelTextAlign', align)"
          >
            <UIcon :name="ALIGN_ICONS[align]" class="size-4" />
          </button>
        </div>
      </template>
    </UPopover>

    <!-- Начертание подписи (12.18) — общий BoardFormatButtons.vue со
         стикерами/фигурами (найдено пользователем: тулбары визуально
         расходились, попросил один компонент), но переключатель на весь
         текст целиком, а не per-символьная разметка. -->
    <BoardFormatButtons :active-keys="activeLabelFormatKeys" @toggle="onToggleLabelFormat" />

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

.board-edge-dash-preview {
  display: inline-block;
  width: 18px;
  border-top-width: 2px;
  border-top-color: currentColor;
}
.board-edge-dash-preview--solid {
  border-top-style: solid;
}
.board-edge-dash-preview--dashed {
  border-top-style: dashed;
}
.board-edge-dash-preview--dotted {
  border-top-style: dotted;
}
</style>
