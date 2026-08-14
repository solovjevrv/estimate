<script setup lang="ts">
/**
 * Общее содержимое попапа выбора цвета — переиспользуется в
 * BoardSelectionToolbar.vue (заливка, цвет текста) и BoardEdgeToolbar.vue
 * (цвет стрелки), раньше было почти дословным дублем в каждом из трёх мест.
 * Подключается ВНУТРИ `<template #content>` внешнего UPopover — Reka
 * размонтирует #content при закрытии попапа (тот же механизм, что у
 * `BoardStickerPicker.vue`), поэтому `onMounted` здесь каждый раз читает
 * localStorage заново — список «недавних» при повторном открытии всегда
 * актуален.
 *
 * `pick` — коммит выбора (клик по дефолтному/недавнему свотчу ИЛИ по кнопке
 * «Применить» под UColorPicker): родитель обязан закрыть внешний попап.
 * `preview` — живое превью при drag внутри UColorPicker: родитель применяет
 * цвет, но НЕ закрывает попап — решение пользователя из 18.3 (иначе нельзя
 * было бы докрутить цвет).
 *
 * В «недавние» цвет из UColorPicker попадает ТОЛЬКО по явному клику на
 * «Применить» — раньше (первая версия 18.4) сохранение было по debounce
 * (пауза после последнего drag-тика), но пользователь на живой проверке
 * столкнулся с тем, что при неторопливом/прерывистом drag'е по палитре в
 * недавние оседали промежуточные, непреднамеренные цвета — таймер не может
 * надёжно отличить «пользователь остановился подумать» от «пользователь
 * закончил выбор». Явная кнопка снимает эту неоднозначность полностью.
 *
 * До «Применить» drag внутри UColorPicker живьём красит объект (preview),
 * но если пользователь просто закрыл попап (клик мимо/Escape/переключился
 * на другой объект), ничего не нажав, — цвет отменяется, объект
 * возвращается к тому, что было ДО открытия пикера, и в недавние ничего не
 * попадает (решение пользователя, живая проверка: иначе объект оставался
 * с непреднамеренным цветом просто от того, что его «полистали», а не
 * специально выбрали). `originalColor` фиксируется при монтировании
 * (момент открытия внешнего попапа), `hasPendingPreview` — был ли drag
 * без последующего коммита; откат — в `onBeforeUnmount`, который отработает
 * при любом закрытии внешнего попапа (Reka размонтирует #content).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { BOARD_COLOR_PALETTE, type BoardColorHex } from '@poker/shared';

import { addRecentColor, getRecentColors } from '../../lib/board/recent-colors';

const props = defineProps<{
  currentColor: BoardColorHex;
  /** Встроено в уже отступленный контейнер (цвет текста в попапе «Aa» —
   * `.board-text-menu-row` внутри `.board-text-menu` с padding:10px), а не
   * само является всей карточкой попапа (заливка/стрелка) — свой левый/
   * правый padding здесь удваивал бы отступ до края карточки. */
  inline?: boolean;
}>();
const emit = defineEmits<{
  pick: [hex: BoardColorHex];
  preview: [hex: BoardColorHex];
  /** Откат брошенного превью (18.4, живая проверка) — специально ОТДЕЛЬНОЕ
   * событие от `preview`, не переиспользует его: родитель (BoardCanvas.vue)
   * ведёт сессию превью по зафиксированным id объекта(ов), а не по текущему
   * выделению (иначе финальный откат при закрытии попапа без «Применить»
   * промахивался бы мимо уже снятого выделения). `cancel` — явный сигнал
   * родителю ЗАВЕРШИТЬ эту сессию (в т.ч. сбросить зафиксированные id) — если
   * бы откат шёл через `preview`, сессия осталась бы «зависшей», и следующее
   * открытие пикера (даже на другом объекте) продолжило бы красить старый. */
  cancel: [originalColor: BoardColorHex];
}>();

const { t } = useI18n();

const recentColors = ref<BoardColorHex[]>([]);
/** Цвет объекта на момент открытия попапа — если drag в UColorPicker так и
 * не был подтверждён кнопкой «Применить», при закрытии откатываемся сюда. */
const originalColor = ref<BoardColorHex | null>(null);

onMounted(() => {
  recentColors.value = getRecentColors();
  originalColor.value = props.currentColor;
});

/** Последний цвет из UColorPicker — только для кнопки «Применить», в
 * недавние сохраняется не он сам, а именно факт нажатия кнопки. */
const lastCustomColor = ref<BoardColorHex | null>(null);
/** true — есть непроверенный drag: живое превью применено, но ни
 * «Применить», ни выбор другого свотча его ещё не подтвердили. */
const hasPendingPreview = ref(false);

/** Явный выбор (дефолтный ИЛИ недавний свотч) снимает pending-состояние —
 * при закрытии попапа откатывать уже нечего, цвет свотча и есть финальный. */
function pickSwatch(hex: BoardColorHex): void {
  hasPendingPreview.value = false;
  emit('pick', hex);
}

function onCustomColorChange(value: string | undefined): void {
  if (!value) return;
  lastCustomColor.value = value;
  hasPendingPreview.value = true;
  emit('preview', value);
}

function applyCustomColor(): void {
  if (!lastCustomColor.value) return;
  addRecentColor(lastCustomColor.value);
  recentColors.value = getRecentColors();
  hasPendingPreview.value = false;
  emit('pick', lastCustomColor.value);
  lastCustomColor.value = null;
}

onBeforeUnmount(() => {
  if (hasPendingPreview.value) {
    emit('cancel', originalColor.value ?? props.currentColor);
  }
});
</script>

<template>
  <div class="board-color-popover-body" :class="{ 'board-color-popover-body--inline': inline }">
    <div class="board-color-menu">
      <button
        v-for="hex in BOARD_COLOR_PALETTE"
        :key="hex"
        type="button"
        class="board-selection-swatch"
        :class="{ 'board-selection-swatch-active': hex === props.currentColor }"
        :style="{ backgroundColor: hex }"
        :aria-label="hex"
        @click="pickSwatch(hex)"
      />
    </div>

    <div class="board-color-divider" />

    <!-- Пипетка (18.3) заменена на явную кнопку с подписью (решение
      пользователя, живая проверка 18.4): маленькая круглая иконка на фоне
      сетки свотчей смотрелась как случайный 17-й элемент, ломая ряд 4×4, и
      было неочевидно, что там прячется полноценный выбор цвета с кнопкой
      «Применить» — теперь это отдельная строка под сеткой. -->
    <UPopover :content="{ side: 'right', sideOffset: 16 }">
      <button type="button" class="board-color-add-trigger">
        <UIcon name="i-lucide-plus" class="size-3.5" />
        {{ t('board.addCustomColor') }}
      </button>

      <template #content>
        <div class="board-color-picker-panel">
          <UColorPicker
            :model-value="props.currentColor"
            format="hex"
            size="xs"
            class="board-color-picker"
            @update:model-value="onCustomColorChange"
          />
          <button
            type="button"
            class="board-color-apply-btn"
            :disabled="!lastCustomColor"
            :aria-label="t('board.customColorApply')"
            :title="t('board.customColorApply')"
            @click="applyCustomColor"
          >
            <UIcon name="i-lucide-check" class="size-4" />
          </button>
        </div>
      </template>
    </UPopover>

    <template v-if="recentColors.length > 0">
      <div class="board-color-divider" />
      <div class="board-color-recent-label">{{ t('board.recentColorsLabel') }}</div>
      <div class="board-color-recent-swatches">
        <button
          v-for="hex in recentColors"
          :key="hex"
          type="button"
          class="board-selection-swatch"
          :class="{ 'board-selection-swatch-active': hex === props.currentColor }"
          :style="{ backgroundColor: hex }"
          :aria-label="hex"
          @click="pickSwatch(hex)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Все используемые здесь классы (board-color-menu, board-selection-swatch,
   board-color-add-trigger, board-color-picker*, board-color-apply-btn,
   board-color-recent-*, board-color-popover-body) — shared, определены в
   board-toolbar.css.
   Scoped-CSS в родителях (BoardSelectionToolbar.vue/BoardEdgeToolbar.vue)
   применяется только к элементам, помеченным ИХ СОБСТВЕННЫМ scope-атрибутом
   — на разметку, которую рендерит этот дочерний компонент, их правила не
   распространяются, нужен свой импорт. */
@import './shared/board-toolbar.css';
</style>
