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
 * попап с сеткой 4×4 предложенных свотчей и кастомным цветом через `UColorPicker`
 * (18.3 — замена нативного `<input type="color">`, чей попап закрывался
 * нестабильно).
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
 * Начертание/маркер (12.13) применяются к целевому диапазону внутри редактируемого
 * текста — активны пока идёт редактирование (`editingText`) и есть непустой текст
 * (`activeMarks !== null`). При схлопнутом курсоре без выделения (18.7) цель —
 * весь непустой текст, поэтому кнопки работают и без явного выделения.
 *
 * Ссылка (12.13) по‑прежнему требует ЯВНОГО непустого выделения (`hasTextSelection`):
 * без него в попапе показывается подсказка `linkSelectTextHint` вместо формы URL —
 * иначе пользователь случайно превратил бы всю подпись в ссылку, поставив cursor
 * в текст и кликнув иконку ссылки.
 *
 * Только эти три попапа несут
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
  type EmojiSequence,
} from '@poker/shared';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { HIGHLIGHT_CSS } from '../../features/boards/rich-text/board-rich-text';
import type { FormatMarkKey } from '../../features/boards/composables/use-rich-text-editing';
import type { ItemFormKind } from '../../features/boards/board-item-form';
import BoardStickerPicker from './BoardStickerPicker.vue';
import EmojiPicker from '../EmojiPicker.vue';
import BoardColorPickerMenu from './BoardColorPickerMenu.vue';
import BoardFormatButtons from './BoardFormatButtons.vue';

export type { ItemFormKind };

const FORM_OPTIONS: readonly ItemFormKind[] = [
  'sticky',
  ...BOARD_SHAPE_KINDS,
  'text',
  'image',
  'emoji',
];

const FORM_ICONS: Record<ItemFormKind, string> = {
  sticky: 'i-lucide-sticky-note',
  rectangle: 'i-lucide-square',
  rounded: 'i-lucide-squircle',
  ellipse: 'i-lucide-circle',
  diamond: 'i-lucide-diamond',
  text: 'i-lucide-type',
  image: 'i-lucide-image',
  emoji: 'i-lucide-smile',
  // Никогда не рендерится через FORM_OPTIONS (стикер не в списке) — только для
  // exhaustiveness Record<ItemFormKind, string>, сам пикер у стикера свой (см. isSticker)
  sticker: 'i-lucide-sticker',
  // Фрейм/группа (14.3) — не в FORM_OPTIONS, но нужны иконки для Record
  frame: 'i-lucide-frame',
  group: 'i-lucide-ungroup',
};

const ALIGN_ICONS: Record<BoardTextAlign, string> = {
  left: 'i-lucide-align-left',
  center: 'i-lucide-align-center',
  right: 'i-lucide-align-right',
};

const FONT_SIZE_STEP = 2;

const props = withDefaults(
  defineProps<{
    /** Экранные координаты верхней границы выделения — толбар рисуется над ними */
    left: number;
    top: number;
    currentColor: BoardColorHex;
    currentForm: ItemFormKind;
    /** Реальный отрисованный размер, может быть больше максимальной сохранённой базы. */
    currentFontSize: number;
    canIncreaseFontSize?: boolean;
    canDecreaseFontSize?: boolean;
    currentTextColor: BoardColorHex;
    currentTextAlign: BoardTextAlign;
    /** Идёт редактирование текста этого элемента (12.13) — вне этого режима начертания недоступны */
    editingText: boolean;
    /** Метки текущей цели форматирования (не только реального выделения): при
     *  схлопнутом курсоре и непустом тексте — метки всего текста; `null` — нет текста */
    activeMarks: BoardTextMark | null;
    /** Только фактическое непустое DOM-выделение (18.7) — ссылка требует явного выбора фрагмента */
    hasTextSelection: boolean;
  }>(),
  // Явный default: undefined — без него Vue кастит отсутствующий boolean-проп в false
  // (а не оставляет undefined), из-за чего фолбэк `?? currentFontSize <= MIN` ниже по
  // шаблону никогда бы не срабатывал.
  { canIncreaseFontSize: undefined, canDecreaseFontSize: undefined },
);

const emit = defineEmits<{
  color: [hex: BoardColorHex];
  /** Живое превью из кастомного UColorPicker (18.4) — своё событие, не `color`:
   * `BoardCanvas.vue` должен зафиксировать id объекта(ов) на первом тике и не
   * читать текущее выделение заново на каждый следующий (иначе финальный откат
   * при закрытии попапа без «Применить» бьёт в уже снятое выделение и теряется,
   * если пользователь кликнул мимо объекта). См. пояснение в BoardCanvas.vue. */
  colorPreview: [hex: BoardColorHex];
  /** Откат брошенного превью заливки (18.4) — см. пояснение у `cancel` в
   * BoardColorPickerMenu.vue и у `previewSelectedColor`/`colorPreviewIds`
   * в BoardCanvas.vue. */
  colorCancel: [hex: BoardColorHex];
  form: [kind: ItemFormKind];
  fontSize: [size: number];
  textColor: [hex: BoardColorHex];
  textColorPreview: [hex: BoardColorHex];
  textColorCancel: [hex: BoardColorHex];
  textAlign: [align: BoardTextAlign];
  toggleMark: [key: FormatMarkKey];
  setHighlight: [color: BoardHighlightColor | null];
  setLink: [url: string | null];
  duplicate: [];
  delete: [];
  replaceImage: [];
  emoji: [emoji: EmojiSequence];
  sticker: [pack: string, id: string];
}>();

const { t } = useI18n();

/**
 * Картинка (13.2) — не текстовый элемент и не меняет форму: цвет/текстовые
 * регуляторы (Aa/выравнивание/начертание/маркер/ссылка) и переключатель формы
 * для неё не имеют смысла (нет текста, нет фигуры для смены) — вместо
 * переключателя формы показывается «Заменить картинку».
 */
const isImage = computed(() => props.currentForm === 'image');

/** Эмодзи (13.3) — не имеет заливки/текста/фигуры, только выбор эмодзи и размер */
const isEmoji = computed(() => props.currentForm === 'emoji');

/** Стикер (13.4) — не имеет заливки/текста/фигуры, только выбор стикера и размер */
const isSticker = computed(() => props.currentForm === 'sticker');

/** Фрейм/группа (14.3) — контейнеры без переключателя формы/текстовых регуляторов
 * (Aa/выравнивание/начертание) — они бессмысленны для контейнера. */
const isContainer = computed(() => props.currentForm === 'frame' || props.currentForm === 'group');
/** Фрейм — видимый контейнер, у него ЕСТЬ заливка (в отличие от невидимой группы) —
 * цвет можно менять и после создания, не только в момент задания дефолта */
const isFrame = computed(() => props.currentForm === 'frame');
/** Группа — единственная форма вообще без каких-либо регуляторов в этом тулбаре
 * (ни формы, ни цвета, ни текста) — используется, чтобы не рисовать "осиротевший"
 * разделитель перед Дублировать/Удалить, когда перед ним ничего не было */
const isGroupOnly = computed(() => props.currentForm === 'group');

const FORMAT_BUTTONS: readonly { key: FormatMarkKey; icon: string }[] = [
  { key: 'bold', icon: 'i-lucide-bold' },
  { key: 'italic', icon: 'i-lucide-italic' },
  { key: 'underline', icon: 'i-lucide-underline' },
  { key: 'strike', icon: 'i-lucide-strikethrough' },
];

/** Начертание/маркер доступны при редактировании и непустом тексте (18.7): при
 *  схлопнутом курсоре `activeMarks` вычисляются по всему тексту, и кнопки
 *  применяют действие к нему */
const formattingDisabled = computed(() => !props.editingText || props.activeMarks === null);
/** Ссылка требует ЯВНОГО выделения (18.7): без него показываем подсказку, а не форму URL */
const linkUnavailable = computed(() => !props.editingText || !props.hasTextSelection);
/** Ключи начертания, активные в activeMarks — вход для общего BoardFormatButtons.vue */
const activeFormatKeys = computed<FormatMarkKey[]>(() =>
  FORMAT_BUTTONS.map((format) => format.key).filter((key) => !!props.activeMarks?.[key]),
);

const linkPopoverOpen = ref(false);
const linkDraft = ref('');
const linkError = ref(false);
const linkInputEl = useTemplateRef<HTMLInputElement>('linkInput');

// Закрываем попап ссылки, только когда редактирование текста реально закончилось —
// временно пустое выделение (клик внутри текста без drag) не должно захлопывать
// уже открытый попап, пользователь может просто выделить текст, не переоткрывая его.
// Ссылка требует явного выделения (18.7): без него попап открывается с подсказкой,
// а не с формой ввода URL — `linkUnavailable` глушит фокус на input в этом случае.
watch(
  () => props.editingText,
  (editing) => {
    if (!editing) linkPopoverOpen.value = false;
  },
);

watch([linkPopoverOpen, linkUnavailable], async ([open, unavailable]) => {
  if (!open || unavailable) return;
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

function stepFontSize(delta: number): void {
  const next = props.currentFontSize + delta;
  if (next !== props.currentFontSize) emit('fontSize', next);
}

/** Цвет заливки из пикера (18.4) — обёртка над emit, чтобы не писать
 * многострочную стрелку в атрибуте @pick (Vue-компилятор не парсит такие). */
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

/** Цвет текста из пикера (18.4). Попап «Aa» СВОЙ — close() тут недоступен
 * (нет доступа к #content="{ close }" внешнего UPopover в этом месте разметки),
 * закрывать его не нужно: цвет текста и раньше НЕ закрывал попап «Aa» при клике
 * по свотчу (в нём есть ещё font-size — пользователь мог продолжить настройку). */
function pickTextColor(hex: BoardColorHex): void {
  emit('textColor', hex);
}

function previewTextColor(hex: BoardColorHex): void {
  emit('textColorPreview', hex);
}

function cancelTextColor(hex: BoardColorHex): void {
  emit('textColorCancel', hex);
}
</script>

<template>
  <div
    data-testid="board-selection-toolbar"
    class="board-selection-toolbar board-toolbar-base"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @click.stop
    @dblclick.stop
  >
    <!-- Картинка (13.2): вместо переключателя формы — замена файла, конвертация в другую
         форму для неё бессмысленна (нет текста/заливки, которые можно перенести) -->
    <button
      v-if="isImage"
      type="button"
      class="board-selection-icon-btn"
      :aria-label="t('board.replaceImageLabel')"
      :title="t('board.replaceImageLabel')"
      @click="emit('replaceImage')"
    >
      <UIcon name="i-lucide-image-up" class="size-3.5" />
    </button>

    <!-- Эмодзи (13.3): вместо переключателя формы — выбор эмодзи -->
    <UPopover v-else-if="isEmoji" :content="{ side: 'top', sideOffset: 20 }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.emojiPickerLabel')"
      >
        <UIcon name="i-lucide-smile" class="size-3.5" />
      </button>

      <template #content="{ close }">
        <EmojiPicker
          @select="
            (emoji: string) => {
              emit('emoji', emoji);
              close();
            }
          "
        />
      </template>
    </UPopover>

    <!-- Стикер (13.4): вместо переключателя формы — выбор стикера
         (BoardStickerPicker — общий с левым тулбаром) -->
    <UPopover v-else-if="isSticker" :content="{ side: 'top', sideOffset: 20 }">
      <button
        type="button"
        class="board-selection-icon-btn"
        :aria-label="t('board.stickerPickerLabel')"
      >
        <UIcon name="i-lucide-sticker" class="size-3.5" />
      </button>

      <template #content="{ close }">
        <BoardStickerPicker
          @select="
            (pack, id) => {
              emit('sticker', pack, id);
              close();
            }
          "
        />
      </template>
    </UPopover>

    <!-- Form picker — always visible (allows converting text ↔ sticky ↔ shape) -->
    <UPopover v-else-if="!isContainer" :content="{ side: 'top', sideOffset: 20 }">
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

    <!-- Color picker — стикер/фигура/фрейм (у текста нет заливки, у картинки/эмодзи/стикера
         своя палитра нет смысла, у группы вообще нет видимой заливки). Ведущий разделитель —
         только когда перед этим блоком уже что-то нарисовано (переключатель формы); для фрейма
         (контейнер, переключателя формы нет) этот свотч сам первый элемент тулбара -->
    <template
      v-if="
        (!isContainer || isFrame) &&
        props.currentForm !== 'text' &&
        !isImage &&
        !isEmoji &&
        !isSticker
      "
    >
      <div v-if="!isContainer" class="board-selection-divider" />

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
    </template>

    <!-- Текстовые регуляторы (Aa/выравнивание/начертание/маркер/ссылка) — картинке/эмодзи/стикеру
      они не нужны вовсе (текста нет), не только когда он сейчас не редактируется. Фрейм/группа — тоже не текстовые (14.3) -->
    <template v-if="!isContainer && !isImage && !isEmoji && !isSticker">
      <div class="board-selection-divider" />

      <!-- Aa — только размер шрифта и цвет текста (гарнитура убрана, см. шапку файла) -->
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
                  :disabled="!(canDecreaseFontSize ?? currentFontSize > BOARD_ITEM_FONT_SIZE_MIN)"
                  :aria-label="t('board.fontSizeDecrease')"
                  @click="stepFontSize(-FONT_SIZE_STEP)"
                >
                  <UIcon name="i-lucide-minus" class="size-3" />
                </button>
                <span class="board-stepper-value">{{ currentFontSize }}</span>
                <button
                  type="button"
                  class="board-stepper-btn"
                  :disabled="!(canIncreaseFontSize ?? currentFontSize < BOARD_ITEM_FONT_SIZE_MAX)"
                  :aria-label="t('board.fontSizeIncrease')"
                  @click="stepFontSize(FONT_SIZE_STEP)"
                >
                  <UIcon name="i-lucide-plus" class="size-3" />
                </button>
              </div>
            </div>

            <div class="board-text-menu-row">
              <span class="board-text-menu-label">{{ t('board.textColorLabel') }}</span>
              <BoardColorPickerMenu
                inline
                :current-color="props.currentTextColor"
                @pick="pickTextColor"
                @preview="previewTextColor"
                @cancel="cancelTextColor"
              />
            </div>
          </div>
        </template>
      </UPopover>

      <div class="board-selection-divider" />

      <!-- Выравнивание — своя кнопка (было строкой внутри Aa) -->
      <UPopover :content="{ side: 'top', sideOffset: 20 }">
        <button
          type="button"
          class="board-selection-icon-btn"
          :aria-label="t('board.textAlignLabel')"
        >
          <UIcon :name="ALIGN_ICONS[props.currentTextAlign]" class="size-3.5" />
        </button>

        <template #content>
          <div class="board-form-menu" data-testid="board-form-menu">
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
       Начертание (12.13) — к целевому диапазону внутри редактируемого текста: при
       схлопнутом курсоре (18.7) — ко всему непустому тексту. Разметка/иконки/классы —
       общий `BoardFormatButtons.vue` (12.18, переиспользуется и BoardEdgeToolbar.vue),
       он же несёт `@mousedown.prevent`/`onFocusOutside`, нужные, чтобы фокус не уходил
       с contenteditable — см. пояснение в шапке файла.
      -->
      <BoardFormatButtons
        :active-keys="activeFormatKeys"
        :disabled="formattingDisabled"
        @toggle="emit('toggleMark', $event)"
      />

      <div class="board-selection-divider" />

      <!-- Маркер (12.13) — та же логика mousedown.prevent/onFocusOutside, что и у начертания.
           Целевой диапазон — либо выделение, либо весь непустой текст при схлопнутом курсоре (18.7) -->
      <UPopover
        :content="{
          side: 'top',
          sideOffset: 20,
          onFocusOutside: (event: Event) => event.preventDefault(),
        }"
      >
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
              data-testid="board-highlight-swatch"
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
      <UPopover v-model:open="linkPopoverOpen" :content="{ side: 'top', sideOffset: 20 }">
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
                вместо формы, пока нет ЯВНОГО выделения (ссылка требует выбора фрагмента, 18.7) -->
            <span v-if="linkUnavailable" class="board-link-hint">
              {{ t('board.linkSelectTextHint') }}
            </span>
            <form v-else class="board-link-form" @submit.prevent="submitLink">
              <input
                ref="linkInput"
                v-model="linkDraft"
                type="text"
                inputmode="url"
                class="board-link-input"
                data-testid="board-link-input"
                placeholder="https://..."
                @input="linkError = false"
                @keydown.esc.stop.prevent="linkPopoverOpen = false"
              />
              <button type="submit" class="board-link-apply-btn" data-testid="board-link-apply-btn">
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
    </template>

    <!-- Группа — единственная форма без единого регулятора выше (14.3): без этого
         условия перед Дублировать висел бы "осиротевший" разделитель, перед которым
         пусто -->
    <div v-if="!isGroupOnly" class="board-selection-divider" />
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
@import './shared/board-toolbar.css';

.board-text-menu-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.board-inline-menu {
  padding: 6px;
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
