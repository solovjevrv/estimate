<script setup lang="ts">
/**
 * Пикер эмодзи (21.4) — «как в привычных мессенджерах». Используется и в комнате
 * (реакции на карточки участников), и на доске (эмодзи-элементы, реакции на
 * стикеры). Каталог эмодзи грузится лениво через динамический import() — он не
 * попадает в основной бандл фронта.
 *
 * Структура похожа на BoardStickerPicker.vue: верхняя строка вкладок со скроллом
 * к секциям, ниже — один скролл с секциями по категорориям. Добавлено: поле
 * поиска и строка выбора тона кожи.
 *
 * Свёрнутый режим (`initiallyCollapsed`, решение пользователя 27.08.2026 — полный
 * каталог сразу слишком объёмный, следующая итерация 27.08.2026 — свернуть ещё
 * сильнее): изначально видны только поиск и «Недавние» — ни строки тона кожи,
 * ни вкладок категорий, ни самих категорий. Разворот («Показать все категории»)
 * сразу открывает полный пикер целиком (тон кожи + вкладки + все категории), не
 * промежуточную «первую категорию». Поиск сам снимает свёртку (иначе результаты
 * вне «Недавних» были бы не видны, а тон кожи недоступен для их выбора).
 *
 * Проп по умолчанию выключен (`false`) — быстрая реакция на карточке участника
 * и на стикере (10.10/13.х) должна давать доступ к любому эмодзи сразу, без
 * лишнего клика «показать всё»; включается точечно только там, где пикер
 * реально используется для обзора каталога (вставка эмодзи-элемента на доску,
 * «Заменить эмодзи» в тулбаре выделения).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { EmojiCatalogEntry, SkinToneId } from '@poker/shared';
import { EMOJI_GROUPS } from '@poker/shared';

import { addRecentEmoji, getRecentEmoji } from '../features/emoji/infrastructure/recent-emoji';
import {
  getPreferredSkinTone,
  setPreferredSkinTone,
  SKIN_TONES,
} from '../features/emoji/config/skin-tone';

const props = withDefaults(defineProps<{ initiallyCollapsed?: boolean }>(), {
  initiallyCollapsed: false,
});
const emit = defineEmits<{ select: [emoji: string] }>();
const { t, locale } = useI18n();

function groupLabel(group: { labelEn: string; labelRu: string }): string {
  return locale.value === 'ru' ? group.labelRu : group.labelEn;
}

const catalog = ref<readonly EmojiCatalogEntry[]>([]);
const loading = ref(true);
const query = ref('');
const skinTone = ref<SkinToneId | null>(getPreferredSkinTone());
const recent = ref<string[]>([]);

onMounted(async () => {
  recent.value = getRecentEmoji();
  const mod = await import('@poker/shared/emoji/catalog');
  catalog.value = mod.EMOJI_CATALOG;
  loading.value = false;
});

function displayGlyph(entry: EmojiCatalogEntry): string {
  const tone = skinTone.value;
  return (tone && entry.skins?.[tone]) || entry.unicode;
}

function pickTone(tone: SkinToneId | null): void {
  skinTone.value = tone;
  setPreferredSkinTone(tone);
}

function pick(entry: EmojiCatalogEntry): void {
  const glyph = displayGlyph(entry);
  addRecentEmoji(glyph);
  emit('select', glyph);
}

/** Выбор из секции «Недавние» — это уже готовый глиф, а не каталог-запись */
function pickRecent(glyph: string): void {
  addRecentEmoji(glyph);
  emit('select', glyph);
}

const normalizedQuery = computed(() => query.value.trim().toLowerCase());

function matches(entry: EmojiCatalogEntry): boolean {
  const q = normalizedQuery.value;
  if (!q) return true;
  const needle = q.startsWith(':') ? q.slice(1) : q;
  return (
    entry.label.toLowerCase().includes(needle) ||
    entry.tagsEn.some((tag) => tag.includes(needle)) ||
    entry.tagsRu.some((tag) => tag.includes(needle)) ||
    entry.shortcodes.some((code) => code.includes(needle))
  );
}

const filtered = computed(() => catalog.value.filter(matches));

const byGroup = computed(() => {
  const map = new Map<string, EmojiCatalogEntry[]>();
  for (const entry of filtered.value) {
    const list = map.get(entry.group) ?? [];
    list.push(entry);
    map.set(entry.group, list);
  }
  return map;
});

/** Первый глиф каждой группы — превью в табе категории */
const groupPreview = computed(() => {
  const firstOfGroup = new Map<string, string>();
  for (const entry of catalog.value) {
    if (!firstOfGroup.has(entry.group)) {
      firstOfGroup.set(entry.group, displayGlyph(entry));
    }
  }
  return firstOfGroup;
});

/** Группы из EMOJI_GROUPS, в которых есть хотя бы одна запись после фильтра */
const groupsWithEntries = computed(() =>
  EMOJI_GROUPS.filter((g) => (byGroup.value.get(g.id) ?? []).length > 0 || loading.value),
);

const expanded = ref(!props.initiallyCollapsed);
/** Поиск сам снимает свёртку — иначе результаты вне «Недавних» были бы скрыты */
const showAll = computed(() => expanded.value || normalizedQuery.value !== '');
const visibleGroups = computed(() => (showAll.value ? groupsWithEntries.value : []));

function showAllCategories(): void {
  expanded.value = true;
}

const sectionEls = new Map<string, HTMLElement>();
function setSectionRef(key: string, el: Element | null): void {
  if (el) sectionEls.set(key, el as HTMLElement);
  else sectionEls.delete(key);
}
/** Вкладки видны только вместе с полным пикером (showAll) — свёртку разворачивать уже не нужно */
function scrollToSection(key: string): void {
  sectionEls.get(key)?.scrollIntoView?.({ block: 'start' });
}
</script>

<template>
  <div data-testid="emoji-picker" class="emoji-picker">
    <!-- Поиск -->
    <div class="emoji-picker-search">
      <input
        v-model="query"
        data-testid="emoji-picker-search"
        type="text"
        :placeholder="t('emojiPicker.searchPlaceholder')"
        class="emoji-picker-search-input"
      />
    </div>

    <!-- Выбор тона кожи — только вместе с полным пикером (27.08.2026, ещё сильнее свернуть) -->
    <div v-if="showAll" data-testid="emoji-picker-skin-tone" class="emoji-picker-skin-row">
      <span class="emoji-picker-skin-label">{{ t('emojiPicker.skinToneLabel') }}</span>
      <button
        type="button"
        :class="{ 'emoji-picker-skin-active': !skinTone }"
        class="emoji-picker-skin-option"
        :aria-label="t('emojiPicker.defaultToneLabel')"
        @click="pickTone(null)"
      >
        <span class="emoji-picker-skin-default">✕</span>
      </button>
      <button
        v-for="tone in SKIN_TONES"
        :key="tone.id"
        type="button"
        :class="{ 'emoji-picker-skin-active': skinTone === tone.id }"
        class="emoji-picker-skin-option"
        :aria-label="tone.id"
        @click="pickTone(tone.id as SkinToneId)"
      >
        <span class="emoji-picker-skin-swatch" :style="{ backgroundColor: tone.swatch }" />
      </button>
    </div>

    <!-- Вкладки категорий — только вместе с полным пикером, свернуто им скроллить некуда -->
    <div v-if="showAll" class="emoji-picker-tabs">
      <button
        v-if="recent.length > 0"
        type="button"
        class="emoji-picker-tab"
        :aria-label="t('board.stickerRecentLabel')"
        :title="t('board.stickerRecentLabel')"
        @click="scrollToSection('recent')"
      >
        <UIcon name="i-lucide-clock" class="size-4" />
      </button>
      <button
        v-for="group in groupsWithEntries"
        :key="group.id"
        type="button"
        class="emoji-picker-tab"
        :aria-label="groupLabel(group)"
        :title="groupLabel(group)"
        @click="scrollToSection(group.id)"
      >
        {{ groupPreview.get(group.id) ?? groupLabel(group) }}
      </button>
    </div>

    <!-- Скролл с секциями — пусто и не рендерится, если свёрнуто и «Недавних» нет -->
    <div v-if="recent.length > 0 || showAll" class="emoji-picker-scroll">
      <section
        v-if="recent.length > 0"
        :ref="(el) => setSectionRef('recent', el as Element | null)"
        data-testid="emoji-picker-section"
        class="emoji-picker-section"
      >
        <h4 class="emoji-picker-heading">{{ t('board.stickerRecentLabel') }}</h4>
        <div class="emoji-picker-grid">
          <button
            v-for="emoji in recent"
            :key="`recent-${emoji}`"
            type="button"
            data-testid="emoji-picker-item"
            class="emoji-picker-item"
            :aria-label="emoji"
            @click="pickRecent(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
      </section>

      <section
        v-for="group in visibleGroups"
        :key="group.id"
        :ref="(el) => setSectionRef(group.id, el as Element | null)"
        data-testid="emoji-picker-section"
        class="emoji-picker-section"
      >
        <h4 class="emoji-picker-heading">{{ groupLabel(group) }}</h4>
        <div class="emoji-picker-grid">
          <template v-if="loading || !byGroup.get(group.id)">
            <button type="button" class="emoji-picker-item">…</button>
          </template>
          <template v-else>
            <button
              v-for="entry in byGroup.get(group.id) ?? []"
              :key="entry.unicode"
              type="button"
              data-testid="emoji-picker-item"
              class="emoji-picker-item"
              :aria-label="entry.label"
              @click="pick(entry)"
            >
              {{ displayGlyph(entry) }}
            </button>
          </template>
        </div>
      </section>

      <p v-if="!loading && filtered.length === 0" class="emoji-picker-no-results">
        {{ t('emojiPicker.noResults') }}
      </p>
    </div>

    <!-- Вне скролла — иначе кнопка требует докрутки вниз, чтобы попасть в зону
         клика (нашли живой проверкой Playwright: элемент за пределами видимой
         области попапа после scrollIntoView) -->
    <button
      v-if="!showAll"
      type="button"
      data-testid="emoji-picker-show-all"
      class="emoji-picker-show-all"
      @click="showAllCategories"
    >
      {{ t('emojiPicker.showAllCategories') }}
    </button>
  </div>
</template>

<style scoped>
/* max-height через --reka-popper-available-height (задаёт Reka на #content
   попапа) — попап может открыться низко на экране (например, «Заменить
   эмодзи» у элемента у нижнего края холста), тогда без этого ограничения
   попап уезжает за нижнюю границу вьюпорта целиком, а кнопка «Показать все
   категории» становится физически недостижимой (нашли живой проверкой
   Playwright — 720px вьюпорт, попап уходил на 900+px). Скролл ниже — flex,
   поэтому сам сжимается под оставшееся место, остальные блоки не трогает. */
.emoji-picker {
  display: flex;
  flex-direction: column;
  width: 372px;
  max-height: min(560px, var(--reka-popper-available-height, 560px));
  padding: 6px;
}

.emoji-picker-search {
  flex-shrink: 0;
  padding: 8px 8px 6px;
}

.emoji-picker-search-input {
  width: 100%;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg-elevated);
  color: var(--brand-ink);
  font-size: 13px;
}

.emoji-picker-skin-row {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--ui-border);
}

.emoji-picker-skin-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink2);
  white-space: nowrap;
}

.emoji-picker-skin-option {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  cursor: pointer;
  border: none;
  border-radius: 8px;
  background: var(--ui-bg-elevated);
}

.emoji-picker-skin-option:hover {
  background: var(--ui-border);
}

.emoji-picker-skin-active {
  box-shadow: inset 0 0 0 2px var(--ui-color-primary-500);
}

.emoji-picker-skin-default {
  font-size: 16px;
  color: var(--brand-ink2);
}

.emoji-picker-skin-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 0.5px solid var(--brand-ink2);
}

.emoji-picker-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 8px 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-border);
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border) transparent;
}

.emoji-picker-tabs::-webkit-scrollbar {
  height: 4px;
}

.emoji-picker-tabs::-webkit-scrollbar-track {
  background: transparent;
}

.emoji-picker-tabs::-webkit-scrollbar-thumb {
  background: var(--ui-border);
  border-radius: 2px;
}

.emoji-picker-tab {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 16px;
  color: var(--brand-ink2);
  cursor: pointer;
  background: var(--ui-bg-elevated);
  border: none;
  border-radius: 8px;
}

.emoji-picker-tab:hover {
  color: var(--brand-ink);
  background: var(--ui-border);
}

.emoji-picker-scroll {
  display: flex;
  flex: 1 1 420px;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: 10px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border) transparent;
}

.emoji-picker-scroll::-webkit-scrollbar {
  width: 4px;
}

.emoji-picker-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.emoji-picker-scroll::-webkit-scrollbar-thumb {
  background: var(--ui-border);
  border-radius: 2px;
}

.emoji-picker-heading {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink2);
}

.emoji-picker-grid {
  display: grid;
  grid-template-columns: repeat(8, 32px);
  gap: 4px;
  justify-content: center;
}

.emoji-picker-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 20px;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
}

.emoji-picker-show-all {
  flex-shrink: 0;
  margin: 4px 4px 2px;
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink2);
  text-align: center;
  cursor: pointer;
  background: var(--ui-bg-elevated);
  border: none;
  border-radius: 8px;
}

.emoji-picker-show-all:hover {
  color: var(--brand-ink);
  background: var(--ui-border);
}

.emoji-picker-item:hover {
  background: var(--ui-bg-elevated);
}

.emoji-picker-no-results {
  padding: 12px 8px;
  font-size: 13px;
  color: var(--brand-ink2);
  text-align: center;
}
</style>
