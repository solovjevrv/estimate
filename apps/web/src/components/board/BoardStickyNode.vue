<script setup lang="ts">
import { type BoardItem, type BoardStickyContent, type EmojiSequence } from '@estimate/shared';
import { Handle, Position, type NodeProps } from '@vue-flow/core';
import { NodeResizer } from '@vue-flow/node-resizer';
import { computed, inject, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { BOARD_CAN_EDIT_KEY } from '../../features/boards/context/board-canvas-keys';
import {
  STICKY_MAX_HEIGHT,
  STICKY_MAX_WIDTH,
  STICKY_MIN_HEIGHT,
  STICKY_MIN_WIDTH,
} from '../../features/boards/config/board-item-defaults';
import { useBoardNodeEditing } from '../../features/boards/composables/use-board-node-editing';
import { useSessionStore } from '../../stores/session';
import { useBoardSessionStore } from '../../stores/board-session';
import BoardEditingBadge from './shared/BoardEditingBadge.vue';
import BoardVoteBadge from './BoardVoteBadge.vue';
import BoardRichText from './BoardRichText.vue';
import EmojiPicker from '../EmojiPicker.vue';

const props = defineProps<NodeProps<BoardItem>>();

const { t } = useI18n();
const boardSession = useBoardSessionStore();
const session = useSessionStore();
const canEdit = inject(BOARD_CAN_EDIT_KEY, ref(true));

const content = computed(() => props.data.content as BoardStickyContent);

const {
  bgColor,
  textColor,
  fontFamily,
  textAlign,
  fontSize,
  displayRuns,
  editing,
  lockedBy,
  startEditing,
  cancelEditing,
  refreshActiveMarks,
  onEditableBlur,
  onEditableInput,
  onEditableKeydownEnter,
  onEditableBeforeInput,
  onEditableCompositionStart,
  onEditableCompositionEnd,
  onEditablePaste,
  onEditableDrop,
  onResizeStart,
  onResize,
  onResizeEnd,
} = useBoardNodeEditing({
  itemId: props.id,
  data: toRef(props, 'data'),
  canEdit,
  isSelected: toRef(props, 'selected'),
  content,
  buildContent: (text, runs) => ({ type: 'sticky', text, ...(runs ? { runs } : {}) }),
  // Стикер всегда квадрат — см. `keep-aspect-ratio` на `NodeResizer` ниже.
  lockAspectRatio: true,
});

/**
 * Реакции (12.12) — персистентные, в отличие от эфемерных комнатных: живут
 * прямо в `item.reactions`, приходят как обычный `item.patch` (см.
 * `board-session.ts`). Одна реакция на пользователя на карточку — повторная
 * присылка того же эмодзи снимает её (toggle авторитетно решает сервер).
 */
interface ReceivedReaction {
  emoji: EmojiSequence;
  count: number;
  fromNames: string[];
  reactedByMe: boolean;
}

const receivedReactions = computed<ReceivedReaction[]>(() => {
  const byEmoji = new Map<EmojiSequence, ReceivedReaction>();
  for (const reaction of props.data.reactions) {
    const entry = byEmoji.get(reaction.emoji);
    if (entry) {
      entry.count += 1;
      entry.fromNames.push(reaction.name);
      entry.reactedByMe ||= reaction.userId === session.user?.id;
    } else {
      byEmoji.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        fromNames: [reaction.name],
        reactedByMe: reaction.userId === session.user?.id,
      });
    }
  }
  return [...byEmoji.values()];
});

function sendReaction(emoji: EmojiSequence): void {
  // record: false — реакции не попадают в стек undo/redo (12.10), как клик
  // по своей же реакции в мессенджере не отменяют отдельным Ctrl+Z
  void boardSession.applyOps(
    [{ type: 'item.react', clientOpId: crypto.randomUUID(), id: props.id, emoji }],
    { record: false },
  );
}

function onPickEmoji(emoji: EmojiSequence, close: () => void): void {
  sendReaction(emoji);
  close();
}

/** «Вылет» эмодзи над карточкой в момент простановки реакции (Meet-style, как у 10.12) */
interface FlyingReaction {
  id: string;
  emoji: EmojiSequence;
}

const flyingReactions = ref<FlyingReaction[]>([]);

/**
 * Не `{ immediate: true }` — при монтировании (в т.ч. повторном из-за
 * виртуализации `:only-render-visible-elements`) текущие реакции — это база
 * для будущих сравнений, а не только что добавленные: анимация не должна
 * проигрываться на уже стоящих реакциях просто от появления карточки в вьюпорте.
 */
watch(
  () => props.data.reactions,
  (next, prev) => {
    for (const reaction of next) {
      const alreadyThere = prev.some(
        (r) => r.userId === reaction.userId && r.emoji === reaction.emoji,
      );
      if (!alreadyThere) {
        const flying: FlyingReaction = { id: crypto.randomUUID(), emoji: reaction.emoji };
        flyingReactions.value = [...flyingReactions.value, flying];
        setTimeout(() => {
          flyingReactions.value = flyingReactions.value.filter((r) => r.id !== flying.id);
        }, 1800);
      }
    }
  },
);
</script>

<template>
  <div
    class="board-node-resizer-gap relative h-full w-full"
    data-testid="board-node-sticky"
    :data-node-id="props.id"
    :data-selected="props.selected ? 'true' : 'false'"
  >
    <BoardEditingBadge v-if="lockedBy" :name="lockedBy.name" data-testid="board-editing-badge" />
    <BoardVoteBadge :item="props.data" />
    <NodeResizer
      :is-visible="props.selected && !editing && canEdit && !lockedBy"
      :min-width="STICKY_MIN_WIDTH"
      :min-height="STICKY_MIN_HEIGHT"
      :max-width="STICKY_MAX_WIDTH"
      :max-height="STICKY_MAX_HEIGHT"
      keep-aspect-ratio
      @resize-start="onResizeStart"
      @resize="onResize"
      @resize-end="onResizeEnd"
    />
    <div
      ref="contentBox"
      data-testid="board-sticky-content"
      class="board-sticky-content flex h-full w-full items-center justify-center overflow-hidden rounded-md p-5 text-center font-semibold"
      :style="{ backgroundColor: bgColor, color: textColor }"
      @dblclick.stop="startEditing"
    >
      <template v-if="editing">
        <div
          ref="editable"
          class="nodrag h-full w-full cursor-text overflow-hidden bg-transparent font-semibold whitespace-pre-wrap outline-none"
          contenteditable="true"
          :style="{
            color: textColor,
            fontSize: `${fontSize}px`,
            fontFamily,
            textAlign,
          }"
          @pointerdown.stop
          @keydown.esc.stop.prevent="cancelEditing"
          @keydown.enter.prevent="onEditableKeydownEnter"
          @beforeinput="onEditableBeforeInput"
          @compositionstart="onEditableCompositionStart"
          @compositionend="onEditableCompositionEnd"
          @input="onEditableInput"
          @paste="onEditablePaste"
          @drop="onEditableDrop"
          @mouseup="refreshActiveMarks"
          @keyup="refreshActiveMarks"
          @blur="onEditableBlur"
        />
      </template>
      <template v-else>
        <span
          ref="text"
          class="block w-full overflow-hidden break-words whitespace-pre-wrap"
          :style="{ fontSize: `${fontSize}px`, fontFamily, textAlign }"
        >
          <BoardRichText :runs="displayRuns" />
        </span>
      </template>
    </div>
    <!--
      Связи (12.8): по видимой точке на сторону, все type="source" +
      connection-mode="loose" + увеличенный connection-radius на VueFlow — так
      с любой из четырёх можно и начать, и принять связь, а Vue Flow сам
      подхватит ближайшую точку карточки, даже если отпустили курсор чуть
      мимо неё. Куда именно приклеен конец связи — решает не автогеометрия
      (первая версия так и делала — неудобно, точка "прыгала" при переносе
      карточек), а конкретный id хендла, который реально был схвачен/отпущен
      (см. floating-edge-geometry.ts) — то есть точка фиксированная и
      предсказуемая, просто следует за карточкой при её переносе.
    -->
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

    <!--
      Реакции (12.12) — только стикеры. Бейджи и вылетающая анимация видны
      ВСЕГДА (в т.ч. на view-only доступе — гость команды, архивная доска):
      это персистентное содержимое карточки, не инструмент редактирования.
      Кликабельны они (toggle своей реакции) и кнопка-триггер пикера — только
      под canEdit, как и остальные действия правки на доске.
    -->
    <TransitionGroup
      v-if="receivedReactions.length > 0"
      tag="div"
      name="board-reaction-pop"
      class="nodrag absolute bottom-[-4px] left-[-8px] flex max-w-[85%] flex-wrap gap-1"
    >
      <button
        v-for="reaction in receivedReactions"
        :key="reaction.emoji"
        type="button"
        :disabled="!canEdit"
        :title="reaction.fromNames.join(', ')"
        :aria-label="
          t('board.reactionBadgeLabel', { emoji: reaction.emoji, count: reaction.count })
        "
        class="board-reaction-badge"
        :class="{ 'board-reaction-badge-mine': reaction.reactedByMe }"
        @click.stop="sendReaction(reaction.emoji)"
      >
        <span class="board-reaction-emoji">{{ reaction.emoji }}</span>
        <span v-if="reaction.count > 1" class="board-reaction-count">{{ reaction.count }}</span>
      </button>
    </TransitionGroup>

    <div
      v-if="flyingReactions.length > 0"
      class="pointer-events-none absolute inset-0 overflow-visible"
    >
      <span
        v-for="reaction in flyingReactions"
        :key="reaction.id"
        class="board-fly-emoji absolute bottom-2 left-1/2 text-3xl"
      >
        {{ reaction.emoji }}
      </span>
    </div>

    <template v-if="canEdit">
      <UPopover :content="{ side: 'top', sideOffset: 20 }">
        <button
          type="button"
          class="board-reaction-trigger nodrag absolute -top-1.5 -right-1.5 flex size-[22px] cursor-pointer items-center justify-center rounded-full border bg-[var(--brand-surface)] shadow-[var(--brand-shadow-card)] dark:border-transparent"
          style="border-color: color-mix(in srgb, var(--brand-ink2) 22%, transparent)"
          :aria-label="t('board.reactionTriggerLabel')"
          @pointerdown.stop
          @click.stop
        >
          <UIcon name="i-lucide-smile-plus" class="size-3.5" style="color: var(--brand-ink2)" />
        </button>

        <template #content="{ close }">
          <EmojiPicker
            initially-collapsed
            @select="
              (emoji: string) => {
                onPickEmoji(emoji, close);
              }
            "
          />
        </template>
      </UPopover>
    </template>
  </div>
</template>

<style scoped>
@import './shared/board-node-resizer.css';
@import './shared/board-connect-handle.css';

/* Стикер держится на тени, а не на обводке — elevation/2 кита (BoardNode / Sticky),
   на ступень выше UI-плашек (elevation/1) */
.board-sticky-content {
  box-shadow: var(--shadow-elevation-2);
}

/* Кнопка «поставить реакцию» — как коннект-хендлы, невидима по умолчанию,
   иначе на плотной доске захламляла бы каждую карточку */
.board-reaction-trigger {
  opacity: 0;
  transition: opacity 0.12s ease;
}

.vue-flow__node:hover .board-reaction-trigger {
  opacity: 1;
}

/* Бейджи уже стоящих реакций (кит 17_Badge — ReactionBadge): пилюля высотой
   30, отступы 6/10, шаг 4; эмодзи 14 и счётчик 12 Bold text-secondary — только
   от двух реакций (решение пользователя: «1» не пишем); обводка border-strong
   1px внутри, elevation-1. В отличие от
   кнопки-триггера видны всегда — это персистентное содержимое карточки */
.board-reaction-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  min-width: 30px;
  justify-content: center;
  padding: 0 8px;
  cursor: pointer;
  border-radius: 999px;
  background: var(--surface-block);
  box-shadow:
    inset 0 0 0 1px var(--border-strong),
    var(--shadow-elevation-1);
}

.board-reaction-emoji {
  font-size: 14px;
  line-height: 18px;
}

.board-reaction-count {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 700;
}

/* Гостю/зрителю архивной доски бейджи видны, но не кликабельны — только canEdit ставит/снимает */
.board-reaction-badge:disabled {
  cursor: default;
}

/* Своя реакция (ReactionBadge Mine=On) — обводка border-brand 1.5px вместо border-strong */
.board-reaction-badge-mine {
  box-shadow:
    inset 0 0 0 1.5px var(--border-brand),
    var(--shadow-elevation-1);
}

.board-reaction-pop-enter-active,
.board-reaction-pop-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.board-reaction-pop-enter-from,
.board-reaction-pop-leave-to {
  opacity: 0;
  transform: scale(0.5);
}
.board-reaction-pop-leave-active {
  position: absolute;
}

.board-fly-emoji {
  animation: board-fly-emoji-rise 1.8s ease-out forwards;
}

@keyframes board-fly-emoji-rise {
  0% {
    transform: translate(-50%, 0) scale(0.4);
    opacity: 0;
  }
  15% {
    transform: translate(-50%, -18px) scale(1.25);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -150px) scale(1);
    opacity: 0;
  }
}
</style>
