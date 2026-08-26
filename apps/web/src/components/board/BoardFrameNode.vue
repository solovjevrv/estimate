<script setup lang="ts">
/**
 * Контейнер-фрейм/группа (14.3). Один компонент обслуживает оба типа:
 * `content.type === 'frame'` — видимая рамка с заголовком НАД собой, как в Miro
 *   (не внутри — заголовок не должен перекрывать содержимое мини-холста);
 * `content.type === 'group'`   — невидимый контейнер (без заливки/рамки/заголовка),
 *   создаётся действием «Группировать» на выделении.
 *
 * Дочерние элементы движутся вместе с контейнером благодаря
 * `extent: 'parent'`/`parentNode` в `vue-flow-adapter.ts` — нам не нужно
 * ничего делать с координатами детей вручную. Мы лишь рендерим хром (для
 * frame) и обеспечиваем возможность ресайза.
 *
 * Ресайз фрейма пишет в `node.style.width/height` (как у стикера, 12.7-баг),
 * поэтому зеркалируем тот же патчинг `style.width/height` из `boardItemToNode`:
 * NodeResizer сам не знает о нашем абстрактном `item.width/height`.
 */
import { BOARD_FRAME_TITLE_MAX_LENGTH, type BoardItem } from '@poker/shared';
import { NodeResizer, type OnResize, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  BOARD_CAN_EDIT_KEY,
  BOARD_RESIZE_SNAP_KEY,
} from '../../features/boards/context/board-canvas-keys';
import { darkenHex } from '../../features/boards/domain/board-colors';
import {
  FRAME_MAX_HEIGHT,
  FRAME_MAX_WIDTH,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
} from '../../features/boards/config/board-constants';
import type { ResizeDirection } from '../../features/boards/domain/board-snap';
import { uuid } from '../../features/boards/infrastructure/uuid';
import { useBoardSessionStore } from '../../stores/board-session';
import type { NodeProps } from '@vue-flow/core';

const props = defineProps<NodeProps<BoardItem>>();

const { t } = useI18n();
const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));
const resizeSnap = inject(BOARD_RESIZE_SNAP_KEY, null);

const content = computed(() => props.data.content);
const isGroup = computed(() => content.value.type === 'group');
const frameTitle = computed(() => (content.value.type === 'frame' ? content.value.title : ''));

/**
 * Мягкая блокировка заголовка (14.2 — по образцу `use-rich-text-editing.ts`,
 * упрощённая версия под plain-инпут: у заголовка фрейма нет rich-text/runs,
 * так что полный composable избыточен). Своя же блокировка (`participantId`
 * совпадает с текущим участником) в `lockedBy` не попадает — чтобы
 * можно было снять фокус и зайти снова, не блокируя самого себя.
 */
const selfParticipantId = computed(() => boardSession.participantId);
const lockedBy = computed(() => {
  const lock = boardSession.editingByItem.get(props.id);
  return lock && lock.participantId !== selfParticipantId.value ? lock : null;
});

/**
 * Цвет рамки фрейма — заметно тёмнее заливки (как у стикера, board-colors.ts),
 * чтобы контур был читаем на любой заливке. Для группы — transparent (видима
 * только рамка выделения Vue Flow, как в Figma).
 */
const strokeColor = computed(() => darkenHex(props.data.style.color, 0.25));

/**
 * Заливка фона фрейма — лёгкий (14%) тон выбранного `style.color`, не сплошная
 * заливка: фрейм не должен визуально "съедать" контраст содержимого внутри
 * него. Меняется через тот же цветовой свотч тулбара выделения (14.3), что и
 * у стикера/фигуры — `setSelectedColor` в BoardCanvas.vue общий для всех типов.
 */
const fillColor = computed(() => `color-mix(in oklch, ${props.data.style.color} 14%, transparent)`);

/** Локальный черновик заголовка — синхронизируем с prop при смене */
const titleDraft = ref('');
watch(
  () => frameTitle.value,
  (next) => {
    titleDraft.value = next;
  },
  { immediate: true },
);

function onTitleFocus(): void {
  if (!canEdit.value) return;
  void boardSession.sendAwareness('editing', { itemId: props.id, active: true });
}

function commitTitle(): void {
  if (canEdit.value) {
    void boardSession.sendAwareness('editing', { itemId: props.id, active: false });
  }
  if (titleDraft.value === frameTitle.value) return;
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: uuid(),
      id: props.id,
      patch: { content: { type: 'frame', title: titleDraft.value } },
    },
  ]);
}

/** См. `use-board-node-editing.ts` — тот же паттерн snap guides при resize (22.3). */
let lastResizeDirection: ResizeDirection = [0, 0];

function onResize({ params: { x, y, width, height, direction } }: OnResize): void {
  lastResizeDirection = direction;
  resizeSnap?.updateGuides(props.id, { id: props.id, x, y, width, height }, direction, false);
}

function onResizeEnd({ params: { x, y, width, height } }: OnResizeEnd): void {
  const snapped = resizeSnap?.applySnap(
    props.id,
    { id: props.id, x, y, width, height },
    lastResizeDirection,
    false,
  ) ?? { x, y, width, height };
  resizeSnap?.clearGuides();
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: uuid(),
      id: props.id,
      patch: snapped,
    },
  ]);
}
</script>

<template>
  <div
    class="board-frame-node relative h-full w-full"
    :class="{ 'board-frame-node--group': isGroup }"
    :data-testid="isGroup ? 'board-node-group' : 'board-node-frame'"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <!--
      NodeResizer — только для видимых фреймов (группы — невидимы, но
      ресайзим их по-прежнему, чтобы дети пересчитались). `keep-aspect-ratio`
      НЕ задаём: пользователь сам задаёт пропорцию.
    -->
    <NodeResizer
      v-if="canEdit"
      :is-visible="props.selected"
      :min-width="FRAME_MIN_WIDTH"
      :min-height="FRAME_MIN_HEIGHT"
      :max-width="FRAME_MAX_WIDTH"
      :max-height="FRAME_MAX_HEIGHT"
      @resize="onResize"
      @resize-end="onResizeEnd"
    />
    <div
      v-if="!isGroup"
      class="board-frame-border absolute inset-0 rounded-xl"
      :style="{ borderColor: strokeColor, backgroundColor: fillColor }"
      @dblclick.stop
    />
    <!-- Заголовок — НАД фреймом, не внутри (как в Miro): фрейм это мини-холст,
         заголовок не должен перекрывать содержимое -->
    <div v-if="!isGroup && (canEdit || frameTitle)" class="board-frame-title-bar nodrag">
      <input
        v-if="canEdit"
        v-model="titleDraft"
        class="board-frame-title"
        :maxlength="BOARD_FRAME_TITLE_MAX_LENGTH"
        :disabled="!!lockedBy"
        :placeholder="t('board.frameTitlePlaceholder')"
        @focus="onTitleFocus"
        @blur="commitTitle"
      />
      <span v-else class="board-frame-title board-frame-title-readonly">{{ frameTitle }}</span>
      <span v-if="lockedBy" class="board-frame-title-lock">
        {{ t('board.editingBy', { name: lockedBy.name }) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.board-frame-node--group :deep(.vue-flow__resizer) {
  /* Группа невидима, но хендлы ресайзера — видны (иначе нельзя изменить размер) */
  border-color: var(--ui-primary);
}
.board-frame-border {
  border-width: 2px;
  border-style: dashed;
  /* Фактическая заливка — инлайн `backgroundColor` (fillColor computed) от
     style.color конкретного фрейма; здесь только дефолт-фоллбэк */
  background: color-mix(in oklch, var(--ui-primary) 4%, transparent);
}
/* Заголовок — над рамкой фрейма (отрицательный top), не внутри неё (Miro) */
.board-frame-title-bar {
  position: absolute;
  top: -28px;
  left: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.board-frame-title {
  min-width: 0;
  overflow: hidden;
  color: var(--brand-ink);
  white-space: nowrap;
  text-overflow: ellipsis;
  background: transparent;
  border: none;
  outline: none;
  font-weight: 600;
  resize: none;
}
.board-frame-title:disabled {
  cursor: default;
  opacity: 0.6;
}
.board-frame-title-readonly {
  flex: 1;
  cursor: default;
}
.board-frame-title-lock {
  flex-shrink: 0;
  padding: 2px 6px;
  color: var(--brand-ink2);
  white-space: nowrap;
  background: var(--brand-surface);
  border-radius: 10px;
  box-shadow: var(--brand-shadow-card);
  font-size: 10px;
  font-weight: 600;
}
</style>
