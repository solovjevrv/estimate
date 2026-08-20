<script setup lang="ts">
/**
 * Кнопки начертания текста (bold/italic/underline/strike) — общий
 * презентационный компонент для `BoardSelectionToolbar.vue` (per-символьная
 * разметка выделения, `BoardTextRun.marks`, 12.13) и `BoardEdgeToolbar.vue`
 * (12.18, переключатель на весь текст подписи целиком, не per-символьно).
 *
 * Компонент не знает, что значит «активно» или что происходит при переключении —
 * оба смысла (селекшен-маркер у стикеров vs булево поле стиля у связи) решает
 * вызывающий код через `activeKeys`/`toggle`. Раньше разметка/иконки/классы
 * были продублированы в обоих тулбарах и визуально разошлись (найдено
 * пользователем при сравнении) — теперь единственный источник правды.
 */
import { useI18n } from 'vue-i18n';

import type { FormatMarkKey } from '../../features/boards/composables/use-rich-text-editing';

const FORMAT_BUTTONS: readonly { key: FormatMarkKey; icon: string }[] = [
  { key: 'bold', icon: 'i-lucide-bold' },
  { key: 'italic', icon: 'i-lucide-italic' },
  { key: 'underline', icon: 'i-lucide-underline' },
  { key: 'strike', icon: 'i-lucide-strikethrough' },
];

const props = defineProps<{
  activeKeys: readonly FormatMarkKey[];
  /** Недоступно целиком — например, у стикера нет активного редактирования
   * текста или курсор не в тексте (18.7). У подписи связи всегда false. */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [key: FormatMarkKey];
}>();

const { t } = useI18n();

function isActive(key: FormatMarkKey): boolean {
  return props.activeKeys.includes(key);
}
</script>

<template>
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
      :class="{ 'board-selection-icon-btn-active': activeKeys.length > 0 }"
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
          :class="{ 'board-form-menu-item-active': isActive(format.key) }"
          :disabled="disabled"
          :aria-label="t(`board.formats.${format.key}`)"
          :title="t(`board.formats.${format.key}`)"
          @mousedown.prevent
          @click="emit('toggle', format.key)"
        >
          <UIcon :name="format.icon" class="size-4" />
        </button>
      </div>
    </template>
  </UPopover>
</template>
