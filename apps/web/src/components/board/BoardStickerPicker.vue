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

import {
  addRecentSticker,
  getRecentStickers,
} from '../../features/boards/infrastructure/recent-stickers';
import {
  findStickerAsset,
  personalStickerUrl,
  STICKER_PACKS,
  type StickerPackItem,
} from '../../features/boards/config/sticker-packs';
import { usePersonalStickerPacksStore } from '../../stores/personal-sticker-packs';
import TelegramStickerImportModal from '../TelegramStickerImportModal.vue';

const emit = defineEmits<{ select: [pack: string, id: string] }>();

const { t } = useI18n();
const store = usePersonalStickerPacksStore();

interface RecentEntry extends StickerPackItem {
  pack: string;
}

const recentItems = ref<RecentEntry[]>([]);
const showImportModal = ref(false);

onMounted(async () => {
  await store.load();
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
  <div data-testid="board-sticker-picker" class="board-sticker-picker">
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
      <button
        v-if="store.enabled"
        type="button"
        class="board-sticker-picker-tab"
        :aria-label="t('board.stickerImportButton')"
        :title="t('board.stickerImportButton')"
        @click="showImportModal = true"
      >
        <UIcon name="i-lucide-plus" class="size-4" />
      </button>
      <button
        v-for="pack in store.packs"
        :key="`personal-tab-${pack.id}`"
        type="button"
        class="board-sticker-picker-tab"
        :aria-label="pack.title"
        :title="pack.title"
        @click="scrollToSection(`personal-${pack.id}`)"
      >
        <img
          :src="personalStickerUrl(pack.id, pack.stickers[0]?.id ?? '')"
          :alt="pack.title"
          draggable="false"
        />
      </button>
    </div>

    <div class="board-sticker-picker-scroll">
      <section
        v-if="recentItems.length > 0"
        :ref="(el) => setSectionRef('recent', el as Element | null)"
        data-testid="board-sticker-picker-section"
        class="board-sticker-picker-section"
      >
        <h4 class="board-sticker-picker-heading">{{ t('board.stickerRecentLabel') }}</h4>
        <div class="board-sticker-picker-grid">
          <button
            v-for="item in recentItems"
            :key="`recent-${item.pack}-${item.id}`"
            type="button"
            data-testid="board-sticker-picker-item"
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
        data-testid="board-sticker-picker-section"
        class="board-sticker-picker-section"
      >
        <h4 class="board-sticker-picker-heading">{{ pack.label }}</h4>
        <div class="board-sticker-picker-grid">
          <button
            v-for="item in pack.items"
            :key="item.id"
            type="button"
            data-testid="board-sticker-picker-item"
            class="board-sticker-picker-item"
            :aria-label="item.emoji"
            @click="pick(pack.id, item.id)"
          >
            <img :src="item.src" :alt="item.emoji" draggable="false" />
          </button>
        </div>
      </section>

      <!-- Мои паки (личные импортированные из Telegram) — секции нет вообще,
           если сервер не поднял роуты (нет TELEGRAM_BOT_TOKEN, см. store.enabled) -->
      <section
        v-if="store.enabled"
        :ref="(el) => setSectionRef('personal', el as Element | null)"
        data-testid="board-sticker-picker-section"
        class="board-sticker-picker-section"
      >
        <h4 class="board-sticker-picker-heading">{{ t('board.stickerPersonalLabel') }}</h4>
        <template v-if="store.packs.length === 0">
          <div class="board-sticker-picker-empty">
            <UIcon name="i-lucide-smile" class="size-8 opacity-30" />
            <p class="mt-2 text-[13px] text-[var(--brand-ink2)]">
              {{ t('board.stickerPersonalEmpty') }}
            </p>
            <button
              type="button"
              class="mt-3 board-sticker-picker-import-btn"
              @click="showImportModal = true"
            >
              {{ t('board.stickerImportButton') }}
            </button>
          </div>
        </template>
        <template v-else>
          <div
            v-for="pack in store.packs"
            :key="pack.id"
            :ref="(el) => setSectionRef(`personal-${pack.id}`, el as Element | null)"
            class="board-sticker-picker-pack"
          >
            <h5 class="board-sticker-picker-subheading">{{ pack.title }}</h5>
            <div class="board-sticker-picker-grid">
              <button
                v-for="sticker in pack.stickers"
                :key="sticker.id"
                type="button"
                data-testid="board-sticker-picker-item"
                class="board-sticker-picker-item"
                :aria-label="sticker.emoji"
                @click="pick(pack.id, sticker.id)"
              >
                <img
                  :src="personalStickerUrl(pack.id, sticker.id)"
                  :alt="sticker.emoji"
                  draggable="false"
                />
              </button>
            </div>
          </div>
        </template>
      </section>

      <!-- Модалка импорта -->
      <TelegramStickerImportModal v-model:model-value="showImportModal" />
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

.board-sticker-picker-subheading {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-ink2);
}

.board-sticker-picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 8px;
}

.board-sticker-picker-import-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-ink);
  background: var(--ui-bg-elevated);
  border: 1px solid var(--brand-border);
  border-radius: 10px;
  cursor: pointer;
}

.board-sticker-picker-import-btn:hover {
  background: var(--ui-border);
}
</style>
