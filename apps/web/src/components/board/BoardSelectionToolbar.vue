<script setup lang="ts">
/**
 * Плавающий тулбар над выделением (12.6+12.9+12.13) — чехол/позиционирование по
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
 * Текст (12.9→12.13, решение пользователя по референсу Miro): сначала весь
 * текстовый функционал (шрифт/размер/цвет/выравнивание/начертание/маркер/
 * ссылка) собирался в один попап за кнопкой «Aa» — на практике это дало
 * попап на 7 строк, перекрывающий сам стикер, и пользователь попросил
 * разложить каждый регулятор в свою маленькую кнопку/попап, как в Miro.
 * Заодно убран отдельный выбор гарнитуры шрифта (sans/heading, 12.9) —
 * визуально путался с новым «жирным начертанием» (12.13), а два способа
 * выделить текст жирным — лишняя сущность; пользователь явно выбрал оставить
 * только начертания (B/I/U/S). «Aa» теперь отвечает только за размер шрифта
 * и цвет текста (те же два ползунка, что раньше, просто без гарнитуры).
 *
 * Начертание/маркер/ссылка (12.13) применяются не ко всему блоку текста, а к
 * выделению ВНУТРИ редактируемого текста — активны только пока идёт
 * редактирование (`editingText`) и есть невырожденное выделение
 * (`activeMarks !== null`). Только эти три попапа несут
 * `data-board-text-toolbar` (`BOARD_TEXT_TOOLBAR_SELECTOR` в
 * `board-rich-text.ts`) на содержимом: Reka сама переносит фокус ВНУТРЬ
 * содержимого попапа при открытии (не только по клику конкретной кнопки), и
 * это содержимое телепортируется в `document.body` — вне поддерева
 * `.board-selection-toolbar`, так что класс родителя тут не помогает, нужен
 * явный атрибут. Кнопки внутри ЭТИХ трёх попапов дополнительно гасят
 * `mousedown.prevent` — иначе клик по конкретной кнопке форматирования успел
 * бы увести фокус ещё раз (на саму кнопку) до срабатывания `click`.
 *
 * Остальные попапы (Форма/Цвет/Aa/Выравнивание) и одиночные кнопки
 * (Дублировать/Удалить) сознательно БЕЗ этой защиты — им не нужен живой
 * `editableEl`, и клик по ним посреди редактирования должен обычным образом
 * закоммитить черновик, как было до 12.13 (иначе, например, «Дублировать»
 * посреди набора текста скопировал бы старое содержимое вместо только что
 * напечатанного — ровно эту регрессию поймало ревью, когда более ранняя
 * версия защищала от коммита клик по ЛЮБОЙ кнопке всего тулбара).
 */
import {
  BOARD_COLOR_PALETTE,
  BOARD_HIGHLIGHT_COLORS,
  BOARD_ITEM_FONT_SIZE_MAX,
  BOARD_ITEM_FONT_SIZE_MIN,
  BOARD_SHAPE_KINDS,
  BOARD_TEXT_ALIGNS,
  BOARD_TEXT_LINK_MAX_LENGTH,
  BOARD_TEXT_LINK_PATTERN,
  type BoardColorHex,
  type BoardHighlightColor,
  type BoardTextAlign,
  type BoardTextMark,
} from '@poker/shared';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { HIGHLIGHT_CSS } from '../../lib/board/board-rich-text';
import type { FormatMarkKey } from '../../lib/board/use-rich-text-editing';

const FORMAT_BUTTONS: readonly { key: FormatMarkKey; icon: string }[] = [
  { key: 'bold', icon: 'i-lucide-bold' },
  { key: 'italic', icon: 'i-lucide-italic' },
  { key: 'underline', icon: 'i-lucide-underline' },
  { key: 'strike', icon: 'i-lucide-strikethrough' },
];

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
  currentTextColor: BoardColorHex;
  currentTextAlign: BoardTextAlign;
  /** Идёт редактирование текста этого элемента (12.13) — вне этого режима начертания недоступны */
  editingText: boolean;
  /** Метки, единые для текущего выделения текста; `null` — нет выделения (кнопки неактивны) */
  activeMarks: BoardTextMark | null;
}>();

const emit = defineEmits<{
  color: [hex: BoardColorHex];
  form: [kind: ItemFormKind];
  fontSize: [size: number];
  textColor: [hex: BoardColorHex];
  textAlign: [align: BoardTextAlign];
  toggleMark: [key: FormatMarkKey];
  setHighlight: [color: BoardHighlightColor | null];
  setLink: [url: string | null];
  duplicate: [];
  delete: [];
}>();

const { t } = useI18n();

const colorInputEl = useTemplateRef<HTMLInputElement>('colorInput');
const textColorInputEl = useTemplateRef<HTMLInputElement>('textColorInput');

/** Нет активного выделения текста — кнопки начертания/маркера/ссылки недоступны (12.13) */
const formattingDisabled = computed(() => !props.editingText || props.activeMarks === null);
const anyFormatActive = computed(
  () => !!props.activeMarks && FORMAT_BUTTONS.some((format) => !!props.activeMarks?.[format.key]),
);

const linkPopoverOpen = ref(false);
const linkDraft = ref('');
const linkError = ref(false);
const linkInputEl = useTemplateRef<HTMLInputElement>('linkInput');

// Закрываем попап ссылки, только когда редактирование текста реально закончилось —
// временно пустое выделение (клик внутри текста без drag) не должно захлопывать
// уже открытый попап, пользователь может просто выделить текст, не переоткрывая его
watch(
  () => props.editingText,
  (editing) => {
    if (!editing) linkPopoverOpen.value = false;
  },
);

watch([linkPopoverOpen, formattingDisabled], async ([open, disabled]) => {
  if (!open || disabled) return;
  linkDraft.value = props.activeMarks?.link ?? '';
  linkError.value = false;
  await nextTick();
  linkInputEl.value?.focus();
});

/** Клиентская проверка зеркалит серверную (board-ops.ts): только http(s), не длиннее лимита */
function submitLink(): void {
  const value = linkDraft.value.trim();
  if (value.length === 0) {
    emit('setLink', null);
    linkPopoverOpen.value = false;
    return;
  }
  if (!BOARD_TEXT_LINK_PATTERN.test(value) || value.length > BOARD_TEXT_LINK_MAX_LENGTH) {
    linkError.value = true;
    return;
  }
  emit('setLink', value);
  linkPopoverOpen.value = false;
}

function clearLink(): void {
  emit('setLink', null);
  linkPopoverOpen.value = false;
}

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

    <!-- Aa — только размер шрифта и цвет текста (гарнитура убрана, см. шапку файла) -->
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
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />

    <!-- Выравнивание — своя кнопка (было строкой внутри Aa) -->
    <UPopover :content="{ side: 'top' }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.textAlignLabel')"
      >
        <UIcon :name="ALIGN_ICONS[props.currentTextAlign]" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-form-menu">
          <button
            v-for="align in BOARD_TEXT_ALIGNS"
            :key="align"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': align === props.currentTextAlign }"
            :aria-label="t(`board.aligns.${align}`)"
            :title="t(`board.aligns.${align}`)"
            @click="emit('textAlign', align)"
          >
            <UIcon :name="ALIGN_ICONS[align]" class="size-4" />
          </button>
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />

    <!--
      Начертание (12.13) — по выделению внутри редактируемого текста, не на
      весь блок. `@mousedown.prevent` — на триггере И на каждой кнопке внутри
      попапа: без него фокус ушёл бы с contenteditable уже при открытии
      попапа (клик по триггеру), а не только при клике по конкретной кнопке
      форматирования — см. пояснение в шапке файла. `onFocusOutside` отключает
      автозакрытие попапа именно по уходу фокуса (его вызывает восстановление
      выделения в `applyRangePatch` после каждого клика) — обычное «кликнули
      мимо» (`pointerDownOutside`) не тронуто, попап всё ещё закрывается им.
    -->
    <UPopover :content="{ side: 'top', onFocusOutside: (event: Event) => event.preventDefault() }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :class="{ 'board-selection-icon-btn-active': anyFormatActive }"
        :aria-label="t('board.formatLabel')"
        @mousedown.prevent
      >
        <UIcon name="i-lucide-bold" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-form-menu" data-board-text-toolbar>
          <button
            v-for="format in FORMAT_BUTTONS"
            :key="format.key"
            type="button"
            class="board-form-menu-item"
            :class="{ 'board-form-menu-item-active': !!activeMarks?.[format.key] }"
            :disabled="formattingDisabled"
            :aria-label="t(`board.formats.${format.key}`)"
            :title="t(`board.formats.${format.key}`)"
            @mousedown.prevent
            @click="emit('toggleMark', format.key)"
          >
            <UIcon :name="format.icon" class="size-4" />
          </button>
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />

    <!-- Маркер (12.13) — та же логика mousedown.prevent/onFocusOutside, что и у начертания -->
    <UPopover :content="{ side: 'top', onFocusOutside: (event: Event) => event.preventDefault() }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :class="{ 'board-selection-icon-btn-active': !!activeMarks?.highlight }"
        :aria-label="t('board.highlightLabel')"
        @mousedown.prevent
      >
        <UIcon name="i-lucide-highlighter" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-text-menu-swatches board-inline-menu" data-board-text-toolbar>
          <button
            v-for="hl in BOARD_HIGHLIGHT_COLORS"
            :key="hl"
            type="button"
            class="board-highlight-swatch"
            :class="{ 'board-selection-swatch-active': hl === activeMarks?.highlight }"
            :style="{ backgroundColor: HIGHLIGHT_CSS[hl] }"
            :disabled="formattingDisabled"
            :aria-label="t(`board.highlights.${hl}`)"
            :title="t(`board.highlights.${hl}`)"
            @mousedown.prevent
            @click="emit('setHighlight', hl === activeMarks?.highlight ? null : hl)"
          />
          <button
            v-if="activeMarks?.highlight"
            type="button"
            class="board-color-add-btn"
            :aria-label="t('board.highlightClear')"
            :title="t('board.highlightClear')"
            @mousedown.prevent
            @click="emit('setHighlight', null)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </div>
      </template>
    </UPopover>

    <div class="board-selection-divider" />

    <!--
      Ссылка (12.13) — открытие попапа тоже гасит mousedown (фокус остаётся на
      contenteditable), но поле URL всё равно требует НАСТОЯЩЕГО фокуса, чтобы
      в него печатать — это единственный момент, когда фокус реально уходит
      (программный `.focus()` в `watch(linkPopoverOpen, ...)`). Поэтому только
      содержимое ЭТОГО попапа несёт `data-board-text-toolbar` — см. шапку файла
      и `BOARD_TEXT_TOOLBAR_SELECTOR` в `board-rich-text.ts`.
    -->
    <UPopover v-model:open="linkPopoverOpen" :content="{ side: 'top' }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :class="{ 'board-selection-icon-btn-active': !!activeMarks?.link }"
        :disabled="!editingText"
        :aria-label="t('board.linkLabel')"
        @mousedown.prevent
      >
        <UIcon name="i-lucide-link" class="size-3.5" />
      </button>

      <template #content>
        <div class="board-link-menu" data-board-text-toolbar>
          <!-- Кнопка-триггер активна уже в момент редактирования (иначе клик по ней
               без предварительного выделения молча ничего не делал бы) — подсказка
               вместо формы, пока реально нечего форматировать -->
          <span v-if="formattingDisabled" class="board-link-hint">
            {{ t('board.linkSelectTextHint') }}
          </span>
          <form v-else class="board-link-form" @submit.prevent="submitLink">
            <input
              ref="linkInput"
              v-model="linkDraft"
              type="text"
              inputmode="url"
              class="board-link-input"
              placeholder="https://..."
              @input="linkError = false"
              @keydown.esc.stop.prevent="linkPopoverOpen = false"
            />
            <button type="submit" class="board-link-apply-btn">
              {{ t('board.linkApply') }}
            </button>
            <button
              v-if="activeMarks?.link"
              type="button"
              class="board-color-add-btn"
              :aria-label="t('board.linkRemove')"
              :title="t('board.linkRemove')"
              @click="clearLink"
            >
              <UIcon name="i-lucide-link-2-off" class="size-3.5" />
            </button>
          </form>
          <span v-if="linkError" class="board-link-error">{{ t('board.linkInvalid') }}</span>
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

.board-form-menu-item:disabled {
  cursor: default;
  opacity: 0.4;
}

.board-form-menu-item:disabled:hover {
  background: transparent;
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

.board-selection-icon-btn:disabled {
  cursor: default;
  opacity: 0.4;
}

.board-selection-icon-btn-active {
  color: var(--ui-primary);
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
  width: 190px;
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

.board-inline-menu {
  padding: 6px;
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

.board-highlight-swatch {
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  cursor: pointer;
  background-clip: padding-box;
  border: none;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 8%);
}

.board-highlight-swatch:disabled {
  cursor: default;
  opacity: 0.4;
}

.board-link-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
}

.board-link-hint {
  max-width: 180px;
  color: var(--brand-ink2);
  font-size: 12px;
}

.board-link-form {
  display: flex;
  gap: 4px;
}

.board-link-input {
  width: 200px;
  height: 28px;
  padding: 0 8px;
  color: var(--brand-ink);
  background: var(--ui-bg-elevated);
  border: none;
  border-radius: 6px;
  outline: none;
  font-size: 12.5px;
}

.board-link-apply-btn {
  height: 28px;
  padding: 0 10px;
  color: var(--ui-bg);
  white-space: nowrap;
  cursor: pointer;
  background: var(--ui-primary);
  border: none;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 700;
}

.board-link-error {
  color: var(--brand-coral);
  font-size: 11px;
}
</style>
