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
 * `pick` — коммит выбора (клик по дефолтному ИЛИ недавнему свотчу):
 * родитель обязан закрыть внешний попап. `preview` — живое превью при drag
 * внутри UColorPicker: родитель применяет цвет, но НЕ закрывает попап —
 * решение пользователя из 18.3 (иначе нельзя было бы докрутить цвет).
 *
 * Сохранение в «недавние» — не на каждый тик drag (иначе список забился бы
 * промежуточными цветами одного жеста), а через паузу COMMIT_DELAY_MS после
 * последнего изменения — простой debounce без внешних зависимостей
 * (@vueuse/core не подключён в apps/web напрямую, только транзитивно через
 * @nuxt/ui, тянуть его отдельно ради одного debounce — лишняя зависимость).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { BOARD_COLOR_PALETTE, type BoardColorHex } from '@poker/shared';

import { addRecentColor, getRecentColors } from '../../lib/board/recent-colors';

const props = defineProps<{ currentColor: BoardColorHex }>();
const emit = defineEmits<{
  pick: [hex: BoardColorHex];
  preview: [hex: BoardColorHex];
}>();

const palette = BOARD_COLOR_PALETTE;

const { t } = useI18n();

const recentColors = ref<BoardColorHex[]>([]);

onMounted(() => {
  recentColors.value = getRecentColors();
});

const COMMIT_DELAY_MS = 500;
let commitTimer: ReturnType<typeof setTimeout> | undefined;

function onCustomColorChange(value: string | undefined): void {
  if (!value) return;
  emit('preview', value);
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    addRecentColor(value);
    recentColors.value = getRecentColors();
  }, COMMIT_DELAY_MS);
}

onBeforeUnmount(() => clearTimeout(commitTimer));
</script>

<template>
  <div class="board-color-popover-body">
    <div class="board-color-menu">
      <button
        v-for="hex in palette"
        :key="hex"
        type="button"
        class="board-selection-swatch"
        :class="{ 'board-selection-swatch-active': hex === props.currentColor }"
        :style="{ backgroundColor: hex }"
        :aria-label="hex"
        @click="emit('pick', hex)"
      />
      <UPopover :content="{ side: 'right', sideOffset: 8 }">
        <button type="button" class="board-color-add-btn" :aria-label="t('board.addCustomColor')">
          <UIcon name="i-lucide-pipette" class="size-3.5" />
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
          </div>
        </template>
      </UPopover>
    </div>

    <template v-if="recentColors.length > 0">
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
          @click="emit('pick', hex)"
        />
      </div>
    </template>
  </div>
</template>
