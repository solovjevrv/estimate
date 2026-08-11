<script setup lang="ts">
/**
 * Контейнер-фрейм/группа (14.3). Один компонент обслуживает оба типа:
 * `content.type === 'frame'` — видимая рамка с заголовком (как в Miro);
 * `content.type === 'group'`   — невидимый контейнер (без заливки/рамки),
 *   создаётся действием «Группировать» на выделении.
 *
 * Дочерние элементы движутся вместе с контейнером благодаря
 * `extent: 'parent'` в `vue-flow-adapter.ts` — нам не нужно ничего делать
 * с координатами детей вручную. Мы лишь рендерим хром (для frame) и
 * обеспечиваем возможность ресайза.
 *
 * Ресайз фрейма пишет в `node.style.width/height` (как у стикера, 12.7-баг),
 * поэтому зеркалируем тот же патчинг `style.width/height` из `boardItemToNode`:
 * NodeResizer сам не знает о нашем абстрактном `item.width/height`.
 */
import type { BoardItem } from '@poker/shared';
import { NodeResizer, type OnResizeEnd } from '@vue-flow/node-resizer';
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { BOARD_CAN_EDIT_KEY } from '../../lib/board/board-canvas-keys';
import { darkenHex } from '../../lib/board/board-colors';
import {
  FRAME_MAX_HEIGHT,
  FRAME_MAX_WIDTH,
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
} from '../../lib/board/board-constants';
import { useBoardSessionStore } from '../../stores/board-session';
import type { NodeProps } from '@vue-flow/core';

const props = defineProps<NodeProps<BoardItem>>();

const { t } = useI18n();
const boardSession = useBoardSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content);
const isGroup = computed(() => content.value.type === 'group');
const frameTitle = computed(() => (content.value.type === 'frame' ? content.value.title : ''));

/**
 * Цвет рамки фрейма — заметно тёмнее заливки (как у стикера, board-colors.ts),
 * чтобы контур был читаем на любой заливке. Для группы — transparent (видима
 * только рамка выделения Vue Flow, как в Figma).
 */
const strokeColor = computed(() => darkenHex(props.data.style.color, 0.25));

/** Локальный черновик заголовка — синхронизируем с prop при смене */
const titleDraft = ref('');
watch(
  () => frameTitle.value,
  (next) => {
    titleDraft.value = next;
  },
  { immediate: true },
);

function commitTitle(): void {
  void boardSession.applyOps([
    {
      type: 'item.patch',
      clientOpId: crypto.randomUUID(),
      id: props.id,
      patch: { content: { type: 'frame', title: titleDraft.value } },
    },
  ]);
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
    class="board-frame-node relative h-full w-full"
    :class="{ 'board-frame-node--group': isGroup }"
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
      @resize-end="onResizeEnd"
    />
    <div
      v-if="!isGroup"
      class="board-frame-border absolute inset-0 rounded-xl"
      :style="{ borderColor: strokeColor }"
      @dblclick.stop
    >
      <input
        v-if="canEdit"
        v-model="titleDraft"
        class="board-frame-title"
        :placeholder="t('board.frameTitlePlaceholder')"
        @blur="commitTitle"
      />
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
  background: color-mix(in oklch, var(--ui-primary) 4%, transparent);
}
.board-frame-title {
  position: absolute;
  top: 6px;
  left: 8px;
  right: 8px;
  border: none;
  outline: none;
  background: transparent;
  font-weight: 600;
  color: var(--brand-ink);
  resize: none;
  overflow: hidden;
}
</style>
