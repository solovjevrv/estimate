<script setup lang="ts">
/**
 * Содержимое пикера GIF из Giphy (21.9) — общее для левого тулбара и «Заменить
 * GIF» в тулбаре выделения (тот же приём, что у BoardStickerPicker.vue).
 * Поиск с debounce; пока запрос пустой — показываются трендовые GIF (тот же
 * принцип, что у Giphy-виджетов в других приложениях: пикер никогда не
 * пустой при первом открытии). Сервер проксирует Giphy целиком — картинки
 * идут по `giphyMediaUrl()` (наш собственный `/api/giphy/media/...`), клиент
 * никогда не обращается к Giphy напрямую.
 *
 * `enabled` — сервер не поднял роуты Giphy (нет GIPHY_API_KEY) — 404 на
 * первый же запрос переводит пикер в постоянное состояние "недоступно", а не
 * ведёт на пустой бесконечный лоадер (тот же приём, что у personal-sticker-packs.ts).
 */
import type { GiphyGifSummary } from '@poker/shared';
import { onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { giphyMediaUrl, searchGiphy, trendingGiphy } from '../../features/boards/api/giphy-api';
import { ApiError } from '../../lib/api';

const emit = defineEmits<{
  select: [gif: GiphyGifSummary];
}>();

const { t } = useI18n();

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

const query = ref('');
const gifs = ref<GiphyGifSummary[]>([]);
const loading = ref(false);
const enabled = ref(true);
const hasMore = ref(true);
const offset = ref(0);

let requestId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

async function load(reset: boolean): Promise<void> {
  const myRequestId = ++requestId;
  loading.value = true;
  const currentOffset = reset ? 0 : offset.value;

  try {
    const trimmed = query.value.trim();
    const result = trimmed
      ? await searchGiphy(trimmed, PAGE_SIZE, currentOffset)
      : await trendingGiphy(PAGE_SIZE, currentOffset);
    // Ответ на устаревший запрос (пользователь уже напечатал дальше) — игнорируем
    if (myRequestId !== requestId) return;

    gifs.value = reset ? result : [...gifs.value, ...result];
    offset.value = currentOffset + result.length;
    hasMore.value = result.length === PAGE_SIZE;
  } catch (err) {
    if (myRequestId !== requestId) return;
    if (err instanceof ApiError && err.status === 404) {
      enabled.value = false;
    }
    if (reset) gifs.value = [];
    hasMore.value = false;
  } finally {
    if (myRequestId === requestId) loading.value = false;
  }
}

function onQueryInput(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void load(true), SEARCH_DEBOUNCE_MS);
}

function loadMore(): void {
  if (!loading.value && hasMore.value) void load(false);
}

function pick(gif: GiphyGifSummary): void {
  emit('select', gif);
}

onBeforeUnmount(() => clearTimeout(debounceTimer));

void load(true);
</script>

<template>
  <div class="board-giphy-picker" data-testid="board-giphy-picker">
    <UInput
      v-model="query"
      :placeholder="t('board.giphySearchPlaceholder')"
      icon="i-lucide-search"
      class="w-full"
      @input="onQueryInput"
    />

    <p v-if="!enabled" class="board-giphy-picker-empty">{{ t('board.giphyUnavailable') }}</p>
    <p v-else-if="!loading && gifs.length === 0" class="board-giphy-picker-empty">
      {{ t('board.giphyNoResults') }}
    </p>
    <div v-else class="board-giphy-picker-scroll">
      <div class="board-giphy-picker-grid" data-testid="board-giphy-picker-grid">
        <button
          v-for="gif in gifs"
          :key="gif.id"
          type="button"
          class="board-giphy-picker-item"
          data-testid="board-giphy-picker-item"
          :aria-label="gif.title"
          @click="pick(gif)"
        >
          <img :src="giphyMediaUrl(gif.id, 'preview')" :alt="gif.title" loading="lazy" />
        </button>
      </div>
      <button
        v-if="hasMore"
        type="button"
        class="board-giphy-picker-more"
        :disabled="loading"
        @click="loadMore"
      >
        {{ t('board.giphyLoadMore') }}
      </button>
    </div>

    <!-- Обязательный атрибут по условиям Giphy API (GIPHY API Terms of Service) -->
    <p class="board-giphy-picker-attribution">Powered by GIPHY</p>
  </div>
</template>

<style scoped>
.board-giphy-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 372px;
  padding: 8px;
}

.board-giphy-picker-scroll {
  max-height: 420px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border) transparent;
}

.board-giphy-picker-scroll::-webkit-scrollbar {
  width: 4px;
}

.board-giphy-picker-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.board-giphy-picker-scroll::-webkit-scrollbar-thumb {
  background: var(--ui-border);
  border-radius: 2px;
}

.board-giphy-picker-grid {
  display: grid;
  grid-template-columns: repeat(4, 84px);
  gap: 6px;
  justify-content: center;
}

.board-giphy-picker-item {
  width: 84px;
  height: 84px;
  border-radius: 6px;
  overflow: hidden;
  border: none;
  padding: 0;
  cursor: pointer;
  background: var(--ui-bg-elevated);
}

.board-giphy-picker-item:hover {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}

.board-giphy-picker-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.board-giphy-picker-more {
  display: block;
  margin: 8px auto 0;
  padding: 6px 14px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--ui-border);
  background: transparent;
  cursor: pointer;
}

.board-giphy-picker-more:disabled {
  opacity: 0.5;
  cursor: default;
}

.board-giphy-picker-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--ui-text-muted);
}

.board-giphy-picker-attribution {
  text-align: center;
  font-size: 11px;
  color: var(--ui-text-muted);
  margin: 0;
}
</style>
