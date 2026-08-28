<template>
  <UModal v-model:open="modelValue" :title="t('board.hotkeysTitle')" :ui="MODAL_UI">
    <template #body>
      <div class="space-y-5">
        <section v-for="section in sections" :key="section.title">
          <h3 class="mb-2 text-[12.5px] font-bold tracking-wide text-[var(--brand-ink2)] uppercase">
            {{ section.title }}
          </h3>
          <ul class="space-y-2">
            <li
              v-for="row in section.rows"
              :key="row.label"
              class="flex items-center justify-between gap-4"
            >
              <span class="text-[14px]">{{ row.label }}</span>
              <span class="flex shrink-0 items-center gap-1">
                <template v-for="(part, i) in row.combo" :key="i">
                  <UKbd v-if="'kbd' in part" :value="part.kbd" />
                  <span v-else class="text-muted text-[13px]">{{ part.text }}</span>
                  <span v-if="i < row.combo.length - 1" class="text-muted text-[12px]">+</span>
                </template>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end">
        <UButton
          color="neutral"
          variant="outline"
          :ui="MODAL_BUTTON_UI"
          @click="modelValue = false"
        >
          {{ t('board.hotkeysClose') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
/**
 * Справка по хоткеям холста доски (22.9) — статический список, без
 * зависимости от данных доски. Источник правды по самим хоткеям —
 * `use-board-hotkeys.ts` (глобальные) и комментарий в шапке `BoardCanvas.vue`
 * (Shift/Alt-модификаторы драга, навигация мышью/колесом) — при добавлении
 * нового хоткея туда же дописывать и сюда, единого реестра нет.
 *
 * `UKbd` из Nuxt UI сам подставляет верный символ под ОС (⌘/⌥ на Mac,
 * Ctrl/Alt иначе, см. `useKbd`) — свою Mac-детекцию писать не нужно.
 * Буквы/цифры (`A`, `D`, `0`…) не входят в её карту символов и рендерятся
 * как есть — тоже штатное поведение компонента, не костыль.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { MODAL_BUTTON_UI, MODAL_UI } from '../../lib/modal-ui';

type ComboPart = { kbd: string } | { text: string };
interface HotkeyRow {
  label: string;
  combo: ComboPart[];
}
interface HotkeySection {
  title: string;
  rows: HotkeyRow[];
}

const modelValue = defineModel<boolean>();
const { t } = useI18n();

const sections = computed<HotkeySection[]>(() => [
  {
    title: t('board.hotkeysSectionNav'),
    rows: [
      { label: t('board.hotkeysPan'), combo: [{ text: t('board.hotkeysWheel') }] },
      {
        label: t('board.hotkeysZoom'),
        combo: [{ kbd: 'meta' }, { text: t('board.hotkeysWheelOrPinch') }],
      },
      { label: t('board.hotkeysPanAlt'), combo: [{ text: 'Space' }] },
      { label: t('board.hotkeysCreateSticky'), combo: [{ text: t('board.hotkeysDoubleClick') }] },
    ],
  },
  {
    title: t('board.hotkeysSectionEdit'),
    rows: [
      { label: t('board.hotkeysSelectAll'), combo: [{ kbd: 'meta' }, { kbd: 'A' }] },
      { label: t('board.hotkeysDuplicate'), combo: [{ kbd: 'meta' }, { kbd: 'D' }] },
      { label: t('board.hotkeysCopy'), combo: [{ kbd: 'meta' }, { kbd: 'C' }] },
      { label: t('board.hotkeysPaste'), combo: [{ kbd: 'meta' }, { kbd: 'V' }] },
      {
        label: t('board.hotkeysDelete'),
        combo: [{ kbd: 'delete' }, { text: '/' }, { kbd: 'backspace' }],
      },
      { label: t('board.hotkeysUndo'), combo: [{ kbd: 'meta' }, { kbd: 'Z' }] },
      { label: t('board.hotkeysRedo'), combo: [{ kbd: 'meta' }, { kbd: 'shift' }, { kbd: 'Z' }] },
      { label: t('board.hotkeysResetZoom'), combo: [{ kbd: 'meta' }, { kbd: '0' }] },
      { label: t('board.hotkeysFitView'), combo: [{ kbd: 'meta' }, { kbd: '1' }] },
      { label: t('board.hotkeysDeselect'), combo: [{ kbd: 'escape' }] },
    ],
  },
  {
    title: t('board.hotkeysSectionDrag'),
    rows: [
      { label: t('board.hotkeysAxisLock'), combo: [{ kbd: 'shift' }] },
      { label: t('board.hotkeysMeasure'), combo: [{ kbd: 'alt' }] },
    ],
  },
]);
</script>
