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
 * localStorage (`recent-stickers.ts`), своя на каждом устройстве. Расчёт
 * recentItems не только в onMounted, но и сразу в pick() (см. refreshRecent) —
 * UPopover не гарантированно размонтирует #content при закрытии, поэтому
 * полагаться только на remount при следующем открытии нельзя (баг живой
 * проверки 21.6: «Недавние» переставали пополняться в течение сессии).
 */
import { useToast } from '@nuxt/ui/composables';
import type { PersonalStickerPackSummary } from '@poker/shared';
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
import ConfirmModal from '../ConfirmModal.vue';
import TelegramStickerImportModal from '../TelegramStickerImportModal.vue';

const emit = defineEmits<{ select: [pack: string, id: string] }>();

const { t } = useI18n();
const toast = useToast();
const store = usePersonalStickerPacksStore();

interface RecentEntry extends StickerPackItem {
  pack: string;
}

const recentItems = ref<RecentEntry[]>([]);
const showImportModal = ref(false);

/** Разрешает ссылку из «недавних» либо во встроенный пак, либо в личный (21.6) */
function resolveRecentAsset(ref: { pack: string; id: string }): RecentEntry | null {
  const builtIn = findStickerAsset(ref.pack, ref.id);
  if (builtIn) return { ...builtIn, pack: ref.pack };

  const personalPack = store.packs.find((p) => p.id === ref.pack);
  const personalSticker = personalPack?.stickers.find((s) => s.id === ref.id);
  if (personalPack && personalSticker) {
    return {
      id: personalSticker.id,
      src: personalStickerUrl(personalPack.id, personalSticker.id),
      emoji: personalSticker.emoji,
      pack: ref.pack,
    };
  }
  return null;
}

function refreshRecent(): void {
  recentItems.value = getRecentStickers()
    .map(resolveRecentAsset)
    .filter((item): item is RecentEntry => item !== null);
}

onMounted(async () => {
  await store.load();
  refreshRecent();
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
  // Реф recentItems обновляем сразу, не полагаясь только на onMounted при
  // следующем открытии поповера — UPopover не гарантированно размонтирует
  // #content при закрытии, из-за чего «Недавние» переставали обновляться
  // после выбора стикера в течение той же сессии (нашли живой проверкой)
  refreshRecent();
  emit('select', pack, id);
}

const deleteTarget = ref<PersonalStickerPackSummary | null>(null);
const deleteOpen = ref(false);
const deleting = ref(false);

function askDeletePack(pack: PersonalStickerPackSummary, event: Event): void {
  // Клик по кнопке удаления внутри заголовка пака не должен всплывать
  // до клика по стикеру/скролла секции
  event.stopPropagation();
  deleteTarget.value = pack;
  deleteOpen.value = true;
}

async function confirmDeletePack(): Promise<void> {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    await store.deletePack(target.id);
    toast.add({ title: t('board.stickerPackDeleted'), color: 'success' });
    deleteOpen.value = false;
  } catch {
    toast.add({ title: t('board.stickerPackDeleteError'), color: 'error' });
  } finally {
    deleting.value = false;
  }
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
      <!-- "+" всегда последней — трейлинг "добавить" после всех паков, не между ними -->
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
            <div class="board-sticker-picker-pack-header">
              <h5 class="board-sticker-picker-subheading">{{ pack.title }}</h5>
              <button
                type="button"
                class="board-sticker-picker-pack-delete"
                :aria-label="t('board.stickerPackDeleteLabel')"
                :title="t('board.stickerPackDeleteLabel')"
                @click="askDeletePack(pack, $event)"
              >
                <UIcon name="i-lucide-trash-2" class="size-3.5" />
              </button>
            </div>
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
      <ConfirmModal
        v-model:open="deleteOpen"
        :title="t('board.stickerPackDeleteConfirmTitle')"
        :description="t('board.stickerPackDeleteConfirmText', { name: deleteTarget?.title ?? '' })"
        :confirm-label="t('board.stickerPackDeleteConfirm')"
        :loading="deleting"
        @confirm="confirmDeletePack"
      />
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
  flex-wrap: wrap;
  gap: 6px;
  max-height: 70px;
  padding: 8px 8px 6px;
  overflow-x: hidden;
  overflow-y: auto;
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

.board-sticker-picker-pack-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 8px;
}

.board-sticker-picker-subheading {
  margin: 0;
  overflow: hidden;
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-ink2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-sticker-picker-pack-delete {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--brand-ink2);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
}

.board-sticker-picker-pack-delete:hover {
  color: var(--ui-error, #e11d48);
  background: var(--ui-bg-elevated);
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
