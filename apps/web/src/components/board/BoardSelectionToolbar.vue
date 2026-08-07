<script setup lang="ts">
/**
 * Плавающий тулбар над выделением (12.6+12.9) — чехол/позиционирование по
 * референсу `.design/main.html` (плашка над стикером: `bottom:calc(100% + 12px)`,
 * radius 12, padding 7px 8px). Порядок слоёв (вперёд/назад) переехал в
 * контекстное меню (12.9, решение пользователя) — здесь остались только
 * часто используемые действия.
 *
 * Форма (12.7) — единый переключатель «тип элемента»: стикер и 4 фигуры в
 * одном дропдауне (не только смена формы уже созданной фигуры, но и
 * конвертация стикер↔фигура — решение пользователя). Макет не задаёт под это
 * отдельный UI (только общая кнопка «Фигура» в левом тулбаре), поэтому это
 * временно живёт в тулбаре выделения.
 *
 * Цвет (12.7) — палитра сменилась с 7 предустановленных токенов на
 * произвольный hex: кнопка-триггер (кружок текущего цвета, без обводки) +
 * попап с сеткой 4×4 предложенных свотчей и кастомным цветом через нативный
 * `<input type="color">`.
 *
 * Текст (12.9) — размер/шрифт/цвет текста/выравнивание собраны в один попап
 * за кнопкой «Aa», а не разложены по отдельным иконкам в основном ряду —
 * иначе тулбар не помещался бы по ширине. Размер шрифта — не замена
 * авто-подгонки (`use-fit-font-size.ts`), а её верхняя граница: если текста
 * больше, чем помещается даже при выбранном размере, авто-fit всё равно
 * ужимает шрифт дальше (решение пользователя 07.08.2026).
 */
import {
  BOARD_COLOR_PALETTE,
  BOARD_FONT_FAMILIES,
  BOARD_ITEM_FONT_SIZE_MAX,
  BOARD_ITEM_FONT_SIZE_MIN,
  BOARD_SHAPE_KINDS,
  BOARD_TEXT_ALIGNS,
  type BoardColorHex,
  type BoardFontFamily,
  type BoardTextAlign,
} from '@poker/shared';
import { useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';

export type ItemFormKind = 'sticky' | (typeof BOARD_SHAPE_KINDS)[number];

const FORM_OPTIONS: readonly ItemFormKind[] = ['sticky', ...BOARD_SHAPE_KINDS];

const FORM_ICONS: Record<ItemFormKind, string> = {
  sticky: 'i-lucide-sticky-note',
  rectangle: 'i-lucide-square',
  rounded: 'i-lucide-squircle',
  ellipse: 'i-lucide-circle',
  diamond: 'i-lucide-diamond',
};

const ALIGN_ICONS: Record<BoardTextAlign, string> = {
  left: 'i-lucide-align-left',
  center: 'i-lucide-align-center',
  right: 'i-lucide-align-right',
};

const FONT_SIZE_STEP = 2;

const props = defineProps<{
  /** Экранные координаты верхней границы выделения — толбар рисуется над ними */
  left: number;
  top: number;
  currentColor: BoardColorHex;
  currentForm: ItemFormKind;
  currentFontSize: number;
  currentFontFamily: BoardFontFamily;
  currentTextColor: BoardColorHex;
  currentTextAlign: BoardTextAlign;
}>();

const emit = defineEmits<{
  color: [hex: BoardColorHex];
  form: [kind: ItemFormKind];
  fontSize: [size: number];
  fontFamily: [family: BoardFontFamily];
  textColor: [hex: BoardColorHex];
  textAlign: [align: BoardTextAlign];
  duplicate: [];
  delete: [];
}>();

const { t } = useI18n();

const colorInputEl = useTemplateRef<HTMLInputElement>('colorInput');
const textColorInputEl = useTemplateRef<HTMLInputElement>('textColorInput');

function openCustomColorPicker(): void {
  colorInputEl.value?.click();
}

function onCustomColor(event: Event): void {
  emit('color', (event.target as HTMLInputElement).value);
}

function openCustomTextColorPicker(): void {
  textColorInputEl.value?.click();
}

function onCustomTextColor(event: Event): void {
  emit('textColor', (event.target as HTMLInputElement).value);
}

function stepFontSize(delta: number): void {
  const next = Math.min(
    BOARD_ITEM_FONT_SIZE_MAX,
    Math.max(BOARD_ITEM_FONT_SIZE_MIN, props.currentFontSize + delta),
  );
  if (next !== props.currentFontSize) emit('fontSize', next);
}
</script>

<template>
  <div
    class="board-selection-toolbar"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @click.stop
    @dblclick.stop
  >
    <UPopover :content="{ side: 'top' }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.formPickerLabel')"
      >
        <UIcon :name="FORM_ICONS[props.currentForm]" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-form-menu">
          <button
            v-for="kind in FORM_OPTIONS"
            :key="kind"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': kind === props.currentForm }"
            :aria-label="t(`board.forms.${kind}`)"
            :title="t(`board.forms.${kind}`)"
            @click="emit('form', kind)"
          >
            <UIcon :name="FORM_ICONS[kind]" class="size-4" />
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

    <UPopover :content="{ side: 'top' }">
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
            <span class="board-text-menu-label">{{ t('board.fontFamilyLabel') }}</span>
            <div class="board-segmented">
              <button
                v-for="family in BOARD_FONT_FAMILIES"
                :key="family"
                type="button"
                class="board-segmented-item"
                :class="{ 'board-segmented-item-active': family === props.currentFontFamily }"
                @click="emit('fontFamily', family)"
              >
                {{ t(`board.fonts.${family}`) }}
              </button>
            </div>
          </div>

          <div class="board-text-menu-row">
            <span class="board-text-menu-label">{{ t('board.fontSizeLabel') }}</span>
            <div class="board-stepper">
              <button
                type="button"
                class="board-stepper-btn"
                :disabled="currentFontSize <= BOARD_ITEM_FONT_SIZE_MIN"
                :aria-label="t('board.fontSizeDecrease')"
                @click="stepFontSize(-FONT_SIZE_STEP)"
              >
                <UIcon name="i-lucide-minus" class="size-3" />
              </button>
              <span class="board-stepper-value">{{ currentFontSize }}</span>
              <button
                type="button"
                class="board-stepper-btn"
                :disabled="currentFontSize >= BOARD_ITEM_FONT_SIZE_MAX"
                :aria-label="t('board.fontSizeIncrease')"
                @click="stepFontSize(FONT_SIZE_STEP)"
              >
                <UIcon name="i-lucide-plus" class="size-3" />
              </button>
            </div>
          </div>

          <div class="board-text-menu-row">
            <span class="board-text-menu-label">{{ t('board.textColorLabel') }}</span>
            <div class="board-text-menu-swatches">
              <button
                v-for="hex in BOARD_COLOR_PALETTE"
                :key="hex"
                type="button"
                class="board-selection-swatch"
                :class="{ 'board-selection-swatch-active': hex === props.currentTextColor }"
                :style="{ backgroundColor: hex }"
                :aria-label="hex"
                @click="emit('textColor', hex)"
              />
              <button
                type="button"
                class="board-color-add-btn"
                :aria-label="t('board.addCustomColor')"
                @click="openCustomTextColorPicker"
              >
                <UIcon name="i-lucide-pipette" class="size-3.5" />
              </button>
              <input
                ref="textColorInput"
                type="color"
                class="sr-only"
                :value="props.currentTextColor"
                @input="onCustomTextColor"
              />
            </div>
          </div>

          <div class="board-text-menu-row">
            <span class="board-text-menu-label">{{ t('board.textAlignLabel') }}</span>
            <div class="board-segmented">
              <button
                v-for="align in BOARD_TEXT_ALIGNS"
                :key="align"
                type="button"
                class="board-segmented-item"
                :class="{ 'board-segmented-item-active': align === props.currentTextAlign }"
                :aria-label="t(`board.aligns.${align}`)"
                :title="t(`board.aligns.${align}`)"
                @click="emit('textAlign', align)"
              >
                <UIcon :name="ALIGN_ICONS[align]" class="size-4" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />
    <button
      type="button"
      class="board-selection-icon-btn"
      :aria-label="t('board.duplicateSelected')"
      @click="emit('duplicate')"
    >
      <UIcon name="i-lucide-copy" class="size-3.5" />
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
.board-selection-toolbar {
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
  /* Не обводка (просьба пользователя — кружки без неё), а еле заметное кольцо
     только для отличимости белых/светлых свотчей от фона попапа */
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

.board-text-options-btn {
  width: auto;
  min-width: 28px;
  padding: 0 6px;
  font-size: 13px;
  font-weight: 800;
}

.board-text-menu {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 220px;
  padding: 10px;
}

.board-text-menu-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.board-text-menu-label {
  color: var(--brand-ink2);
  font-size: 11px;
  font-weight: 700;
}

.board-text-menu-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.board-segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--ui-bg-elevated);
  border-radius: 8px;
}

.board-segmented-item {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: 26px;
  color: var(--brand-ink);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.board-segmented-item:hover {
  color: var(--ui-primary);
}

.board-segmented-item-active {
  color: var(--ui-primary);
  background: var(--brand-surface);
  box-shadow: var(--brand-shadow-card);
}

.board-stepper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.board-stepper-btn {
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink);
  cursor: pointer;
  background: var(--ui-bg-elevated);
  border: none;
  border-radius: 6px;
}

.board-stepper-btn:hover:not(:disabled) {
  background: color-mix(in oklch, var(--ui-primary) 14%, var(--ui-bg-elevated));
}

.board-stepper-btn:disabled {
  cursor: default;
  opacity: 0.4;
}

.board-stepper-value {
  min-width: 26px;
  color: var(--brand-ink);
  font-size: 12.5px;
  font-weight: 700;
  text-align: center;
}
</style>
