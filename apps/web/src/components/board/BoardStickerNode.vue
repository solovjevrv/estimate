<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import type { BoardItem, BoardStickerContent } from '@poker/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { BOARD_CAN_EDIT_KEY } from '../../features/boards/context/board-canvas-keys';
import { getStickerPackMeta } from '../../features/boards/api/personal-stickers-api';
import {
  STICKER_MAX_HEIGHT,
  STICKER_MAX_WIDTH,
  STICKER_MIN_HEIGHT,
  STICKER_MIN_WIDTH,
} from '../../features/boards/config/board-item-defaults';
import { findStickerAsset, personalStickerUrl } from '../../features/boards/config/sticker-packs';
import { useBoardSessionStore } from '../../stores/board-session';
import { usePersonalStickerPacksStore } from '../../stores/personal-sticker-packs';
import { useSessionStore } from '../../stores/session';
import TelegramStickerImportModal from '../TelegramStickerImportModal.vue';

const props = defineProps<NodeProps<BoardItem>>();

const { t } = useI18n();
const toast = useToast();
const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const personalPacks = usePersonalStickerPacksStore();
const session = useSessionStore();

// Стор мог быть ещё не загружен (пикер стикеров не открывали в этой сессии) —
// без этого isForeignPersonal/enabled судили бы по дефолтам (enabled: true,
// hasPack: false) и бейдж «импортировать» мог бы показаться, даже когда
// личные стикеры выключены на сервере (нет TELEGRAM_BOT_TOKEN). load()
// идемпотентен — повторный вызов, если пикер уже загрузил стор, не делает лишний запрос.
// Для гостя (не залогинен) не грузим вовсе: GET требует аутентификации, у гостя
// это всегда 401 — список личных паков ему в принципе не положен (нет
// аккаунта, куда их сохранять), see isForeignPersonal ниже.
onMounted(() => {
  if (session.isAuthenticated) void personalPacks.load();
});

const content = computed(() => props.data.content as BoardStickerContent);
const stickerAsset = computed(() => findStickerAsset(content.value.pack, content.value.id));
const imageUrl = computed(() => {
  const builtIn = stickerAsset.value;
  return builtIn ? builtIn.src : personalStickerUrl(content.value.pack, content.value.id);
});
const altText = computed(() => stickerAsset.value?.emoji ?? 'sticker');

/**
 * Стикер из чужого личного пака (не built-in и не импортированный нами):
 * показываем бейдж «Импортировать», чтобы пользователь мог импортировать
 * этот пакет и увидеть стикер (иначе картинка 404).
 *
 * Только для залогиненных: у гостя нет аккаунта, куда сохранять личный пак —
 * POST .../import у него всегда 401. Раньше бейдж показывался и гостям,
 * заводя в тупиковую модалку без объяснений (нашли живой проверкой, 21.6).
 */
const isForeignPersonal = computed(
  () =>
    session.isAuthenticated &&
    personalPacks.enabled &&
    !stickerAsset.value &&
    !personalPacks.hasPack(content.value.pack),
);

const showImportModal = ref(false);
/** Имя Telegram-сета и человеческое название этого конкретного пака — подтягиваются перед открытием модалки */
const importSetName = ref<string | undefined>(undefined);
const importTitle = ref<string | undefined>(undefined);

/**
 * Клик по бейджу — сначала узнаём метаданные чужого пака (публичны, см.
 * personal-stickers.plugin.ts: резолвятся даже если владелец потом удалил
 * свою копию — см. deletedAt), только потом открываем модалку с уже известным
 * пакетом — пользователь не должен сам искать/вставлять ссылку на пак,
 * который он и так уже видит на доске (нашли живой проверкой, 21.6).
 */
async function onImportBadgeClick(): Promise<void> {
  try {
    const meta = await getStickerPackMeta(content.value.pack);
    importSetName.value = meta.telegramSetName;
    importTitle.value = meta.title;
    showImportModal.value = true;
  } catch {
    toast.add({ title: t('board.stickerImportMetaError'), color: 'error' });
  }
}

function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch: { x, y, width, height },
    },
  ]);
}
</script>

<template>
  <div
    class="board-node-resizer-gap relative h-full w-full"
    data-testid="board-node-sticker"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <NodeResizer
      :is-visible="props.selected && canEdit"
      :min-width="STICKER_MIN_WIDTH"
      :min-height="STICKER_MIN_HEIGHT"
      :max-width="STICKER_MAX_WIDTH"
      :max-height="STICKER_MAX_HEIGHT"
      keep-aspect-ratio
      @resize-end="onResizeEnd"
    />
    <div
      data-testid="board-node-content"
      class="board-node-content relative flex h-full w-full items-center justify-center overflow-hidden"
      @dblclick.stop
    >
      <template v-if="imageUrl">
        <img
          :src="imageUrl"
          :alt="altText"
          data-testid="board-node-sticker-image"
          class="h-full w-full object-contain"
          draggable="false"
          @load.stop
          @error.stop
        />
      </template>
      <template v-else>
        <!-- Плейсхолдер для неизвестного pack/id -->
        <div class="board-sticker-placeholder flex h-full w-full items-center justify-center">
          <UIcon name="i-lucide-image-off" class="size-8 opacity-50" />
        </div>
      </template>
    </div>
    <!-- Бейдж импорта для чужих личных паков (§5.4) — намеренно НЕ завязан на
         canEdit: импорт кладёт пак в личную библиотеку кликнувшего, а не
         редактирует доску, поэтому доступен и участникам с доступом только на
         просмотр (нашли живой проверкой: view-only участник по share-ссылке
         не мог увидеть свой же чужой стикер нормально) -->
    <button
      v-if="isForeignPersonal"
      type="button"
      data-testid="board-sticker-import-badge"
      class="board-sticker-import-badge"
      :title="t('board.stickerImportForeignLabel')"
      @click.stop="onImportBadgeClick"
    >
      <UIcon name="i-lucide-download" class="size-3" />
    </button>
    <!-- Связи (12.8): по видимой точке на сторону, все type="source" +
         connection-mode="loose" + увеличенный connection-radius на VueFlow — так
         с любой из четырёх можно и начать, и принять связь, а Vue Flow сам
         подхватит ближайшую точку карточки, даже если отпустили курсор чуть
         мимо неё. Куда именно приклеен конец связи — решает не автогеометрия
         (первая версия так и делала — неудобно, точка "прыгала" при переносе
         карточек), а конкретный id хендла, который реально был схвачен/отпущен
         (см. floating-edge-geometry.ts) — то есть точка фиксированная и
         предсказуемая, просто следует за карточкой при её переносе. -->
    <template v-if="canEdit">
      <Handle
        id="top"
        type="source"
        :position="Position.Top"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="right"
        type="source"
        :position="Position.Right"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="bottom"
        type="source"
        :position="Position.Bottom"
        class="board-connect-handle"
        data-testid="board-handle"
      />
      <Handle
        id="left"
        type="source"
        :position="Position.Left"
        class="board-connect-handle"
        data-testid="board-handle"
      />
    </template>
    <TelegramStickerImportModal
      v-model:model-value="showImportModal"
      :telegram-set-name="importSetName"
      :pack-title="importTitle"
    />
  </div>
</template>

<style scoped>
@import './shared/board-node-resizer.css';
@import './shared/board-connect-handle.css';

/* Стикер-элемент — без фона/заливки/рамки, просто картинка */

.board-sticker-placeholder {
  background: var(--ui-bg-elevated);
  border: 1px dashed var(--ui-border);
  border-radius: 8px;
}

.board-sticker-import-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: var(--ui-bg-elevated);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  cursor: pointer;
  /* Скрыт по умолчанию — показываем только при наведении/фокусе/выделении
     карточки, не постоянно поверх стикера (нашли живой проверкой, 21.6) */
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}

.board-node-resizer-gap:hover .board-sticker-import-badge,
.board-node-resizer-gap:focus-within .board-sticker-import-badge,
.board-node-resizer-gap[data-selected='true'] .board-sticker-import-badge {
  opacity: 0.7;
  pointer-events: auto;
}

.board-sticker-import-badge:hover {
  opacity: 1;
  background: var(--ui-border);
}
</style>
