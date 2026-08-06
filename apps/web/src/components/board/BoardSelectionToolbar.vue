<script setup lang="ts">
/**
 * Плавающий тулбар над выделением (12.6) — чехол/позиционирование по
 * референсу `.design/main.html` (плашка над стикером: `bottom:calc(100% + 12px)`,
 * radius 12, padding 7px 8px). Порядок слоёв (front/back) в макете живёт в
 * ещё не реализованном контекстном меню (12.9) — временно здесь, т.к. это
 * единственная UI-поверхность выделения, которая уже существует; настройка
 * шрифта из макета вынесена в отдельную будущую задачу (решение пользователя
 * 06.08.2026, см. 12.9 в PROGRESS.md) — «Дублировать» не входит в объём 12.6.
 *
 * Форма (12.7) — единый переключатель «тип элемента»: стикер и 4 фигуры в
 * одном дропдауне (не только смена формы уже созданной фигуры, но и
 * конвертация стикер↔фигура — решение пользователя). Макет не задаёт под это
 * отдельный UI (только общая кнопка «Фигура» в левом тулбаре), поэтому это
 * тоже временно живёт в тулбаре выделения, как и порядок слоёв.
 *
 * Цвет (12.7) — палитра сменилась с 7 предустановленных токенов на
 * произвольный hex: кнопка-триггер (кружок текущего цвета, без обводки) +
 * попап с сеткой 4×4 предложенных свотчей и кастомным цветом через нативный
 * `<input type="color">`.
 */
import { BOARD_COLOR_PALETTE, BOARD_SHAPE_KINDS, type BoardColorHex } from '@poker/shared';
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

const props = defineProps<{
  /** Экранные координаты верхней границы выделения — толбар рисуется над ними */
  left: number;
  top: number;
  currentColor: BoardColorHex;
  currentForm: ItemFormKind;
}>();

const emit = defineEmits<{
  color: [hex: BoardColorHex];
  form: [kind: ItemFormKind];
  bringToFront: [];
  sendToBack: [];
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
            @click="emit('form', kind)"
          >
            <UIcon :name="FORM_ICONS[kind]" class="size-4" />
            {{ t(`board.forms.${kind}`) }}
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
      :aria-label="t('board.bringToFront')"
      @click="emit('bringToFront')"
    >
      <UIcon name="i-lucide-bring-to-front" class="size-3.5" />
    </button>
    <button
      type="button"
      class="board-selection-icon-btn"
      :aria-label="t('board.sendToBack')"
      @click="emit('sendToBack')"
    >
      <UIcon name="i-lucide-send-to-back" class="size-3.5" />
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
  min-width: 168px;
  flex-direction: column;
  padding: 6px;
}

.board-form-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  color: var(--brand-ink);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
}

.board-form-menu-item:hover {
  background: var(--ui-bg-elevated);
}

.board-form-menu-item-active {
  color: var(--ui-primary);
  font-weight: 600;
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
