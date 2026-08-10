<script setup lang="ts">
/**
 * Содержимое пикера стикеров (13.4, редизайн под референс Miro) — общее для
 * левого тулбара и «Заменить стикер» в тулбаре выделения (решение
 * пользователя: оба места выглядят одинаково). Раньше это был двухуровневый
 * навигатор (список паков → отдельный экран сетки), пользователь попросил
 * заменить на как в Miro:
 * 1. Верхняя строка — «недавние» + маленькие превью-иконки каждого пака,
 *    клик скроллит список ниже к нужной секции (не переключает экран).
 * 2. Ниже — один скролл со всеми стикерами сразу, каждый пак — секция со
 *    своим заголовком.
 * 3. Сами стикеры крупнее (72×72 вместо прежних 32×32).
 *
 * «Недавние» — без БД (задача 13.4 явно этого не предполагает), история в
 * localStorage (`recent-stickers.ts`), своя на каждом устройстве. Компонент
 * перемонтируется при каждом открытии поповера (Reka размонтирует `#content`
 * при закрытии) — читаем список заново в `onMounted`, всегда актуальный.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { addRecentSticker, getRecentStickers } from '../../lib/board/recent-stickers';
import {
  findStickerAsset,
  STICKER_PACKS,
  type StickerPackItem,
} from '../../lib/board/sticker-packs';

const emit = defineEmits<{ select: [pack: string, id: string] }>();

const { t } = useI18n();

interface RecentEntry extends StickerPackItem {
  pack: string;
}

const recentItems = ref<RecentEntry[]>([]);

onMounted(() => {
  recentItems.value = getRecentStickers()
    .map((ref) => {
      const asset = findStickerAsset(ref.pack, ref.id);
      return asset ? { ...asset, pack: ref.pack } : null;
    })
    .filter((item): item is RecentEntry => item !== null);
});

const sectionEls = new Map<string, HTMLElement>();

function setSectionRef(key: string, el: Element | null): void {
  if (el) sectionEls.set(key, el as HTMLElement);
  else sectionEls.delete(key);
}

function scrollToSection(key: string): void {
  sectionEls.get(key)?.scrollIntoView({ block: 'start' });
}

function pick(pack: string, id: string): void {
  addRecentSticker(pack, id);
  emit('select', pack, id);
}
</script>

<template>
  <div class="board-sticker-picker">
    <div class="board-sticker-picker-tabs">
      <button
        v-if="recentItems.length > 0"
        type="button"
        class="board-sticker-picker-tab"
        :aria-label="t('board.stickerRecentLabel')"
        :title="t('board.stickerRecentLabel')"
        @click="scrollToSection('recent')"
      >
        <UIcon name="i-lucide-clock" class="size-4" />
      </button>
      <button
        v-for="pack in STICKER_PACKS"
        :key="pack.id"
        type="button"
        class="board-sticker-picker-tab"
        :aria-label="pack.label"
        :title="pack.label"
        @click="scrollToSection(pack.id)"
      >
        <img :src="pack.items[0]?.src" :alt="pack.label" draggable="false" />
      </button>
    </div>

    <div class="board-sticker-picker-scroll">
      <section
        v-if="recentItems.length > 0"
        :ref="(el) => setSectionRef('recent', el as Element | null)"
        class="board-sticker-picker-section"
      >
        <h4 class="board-sticker-picker-heading">{{ t('board.stickerRecentLabel') }}</h4>
        <div class="board-sticker-picker-grid">
          <button
            v-for="item in recentItems"
            :key="`recent-${item.pack}-${item.id}`"
            type="button"
            class="board-sticker-picker-item"
            :aria-label="item.emoji"
            @click="pick(item.pack, item.id)"
          >
            <img :src="item.src" :alt="item.emoji" draggable="false" />
          </button>
        </div>
      </section>

      <section
        v-for="pack in STICKER_PACKS"
        :key="pack.id"
        :ref="(el) => setSectionRef(pack.id, el as Element | null)"
        class="board-sticker-picker-section"
      >
        <h4 class="board-sticker-picker-heading">{{ pack.label }}</h4>
        <div class="board-sticker-picker-grid">
          <button
            v-for="item in pack.items"
            :key="item.id"
            type="button"
            class="board-sticker-picker-item"
            :aria-label="item.emoji"
            @click="pick(pack.id, item.id)"
          >
            <img :src="item.src" :alt="item.emoji" draggable="false" />
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.board-sticker-picker {
  display: flex;
  flex-direction: column;
  /* padding — воздух между содержимым и краем поповера (иначе скроллбар и
     сетка стикеров прилипают вплотную к рамке поповера). Ширина: 4×72px+
     зазоры (312px) + паддинги скролл-контейнера (20px) + этот padding (12px)
     + запас под классический (не overlay) скроллбар (28px) — без запаса
     сетка ужимается на его ширину и появляется паразитный горизонтальный
     скролл (нашли по скриншоту пользователя) */
  width: 372px;
  padding: 6px;
}

.board-sticker-picker-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 8px 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-border);
}

.board-sticker-picker-tab {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  overflow: hidden;
  color: var(--brand-ink2);
  cursor: pointer;
  background: var(--ui-bg-elevated);
  border: none;
  border-radius: 8px;
}

.board-sticker-picker-tab:hover {
  color: var(--brand-ink);
  background: var(--ui-border);
}

.board-sticker-picker-tab img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.board-sticker-picker-scroll {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 420px;
  padding: 10px;
  overflow-x: hidden;
  overflow-y: auto;
}

.board-sticker-picker-heading {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink2);
}

.board-sticker-picker-grid {
  display: grid;
  grid-template-columns: repeat(4, 72px);
  gap: 8px;
}

.board-sticker-picker-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  padding: 4px;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
}

.board-sticker-picker-item:hover {
  background: var(--ui-bg-elevated);
}

.board-sticker-picker-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 4px;
}
</style>
