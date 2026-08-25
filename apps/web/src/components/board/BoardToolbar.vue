<script setup lang="ts">
/**
 * Левый вертикальный тулбар инструментов холста (12.6+12.7+12.9+13.2+13.3+13.4) — позиция/чехол
 * по референсу `.design/main.html` (`top:50%; left:20px`, кнопки 40×40, radius 11).
 * Из макета взяты «Выделение»/«Стикер»/«Фигура»/«Текст»/«Картинка»/«Эмодзи»/«Стикер-паки»/«Стрелка».
 *
 * «Стрелка» (12.9) — не альтернативный механизм создания связи (он уже есть и
 * не требует инструмента — drag от хендла карточки, `onConnect` в
 * `BoardCanvas.vue`), а чистый affordance: пока инструмент активен, хендлы
 * карточек становятся видны на ВСЕХ карточках сразу (не только по hover) —
 * подсказка новичку, откуда тянуть стрелку. Решение пользователя 07.08.2026 —
 * не городить второй, click-to-connect, механизм создания рядом с уже рабочим.
 *
 * «Эмодзи» (13.3) — единственная кнопка без режима "инструмент+клик по
 * холсту": сама кнопка — триггер попапа со списком, клик по эмодзи сразу
 * создаёт элемент в центре текущего вьюпорта (решение пользователя — так же,
 * как вставка картинки из буфера, без лишнего клика по пустому месту).
 *
 * «Стикер-паки» (13.4) — аналогично эмодзи: кнопка открывает поповер
 * (`BoardStickerPicker.vue` — общий с «Заменить стикер» в тулбаре выделения),
 * клик по стикеру сразу вставляет его на доску в центр вьюпорта. Не
 * "инструмент" в духе стикера/фигуры/текста.
 */
import { useI18n } from 'vue-i18n';

import type { BoardTool } from '../../features/boards/board-tools';
import type { EmojiSequence, PersonalStickerFormat } from '@poker/shared';
import BoardStickerPicker from './BoardStickerPicker.vue';
import EmojiPicker from '../EmojiPicker.vue';

export type { BoardTool };

const tool = defineModel<BoardTool>({ required: true });

const emit = defineEmits<{
  /** Эмодзи выбран из пикера — вставить на доску (13.3). Своего "инструмента"
   * у эмодзи нет: клик по кнопке сразу открывает список, клик по эмодзи в
   * списке сразу создаёт элемент, без промежуточного клика по холсту. */
  emoji: [emoji: EmojiSequence];
  /** Стикер выбран из пикера — вставить на доску (13.4). format — только у личных Telegram-паков (21.7) */
  sticker: [pack: string, id: string, format?: PersonalStickerFormat];
}>();

const { t } = useI18n();

function isActive(value: BoardTool): boolean {
  return tool.value === value;
}
</script>

<template>
  <div data-testid="board-toolbar" class="board-toolbar" @click.stop>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('select') }"
      :aria-label="t('board.toolSelect')"
      :aria-pressed="isActive('select')"
      @click="tool = 'select'"
    >
      <UIcon name="i-lucide-mouse-pointer-2" class="size-[19px]" />
    </button>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('sticky') }"
      :aria-label="t('board.toolSticky')"
      :aria-pressed="isActive('sticky')"
      @click="tool = 'sticky'"
    >
      <UIcon name="i-lucide-sticky-note" class="size-[19px]" />
    </button>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('shape') }"
      :aria-label="t('board.toolShape')"
      :aria-pressed="isActive('shape')"
      @click="tool = 'shape'"
    >
      <UIcon name="i-lucide-square" class="size-[19px]" />
    </button>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('text') }"
      :aria-label="t('board.toolText')"
      :aria-pressed="isActive('text')"
      @click="tool = 'text'"
    >
      <UIcon name="i-lucide-type" class="size-[19px]" />
    </button>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('image') }"
      :aria-label="t('board.toolImage')"
      :aria-pressed="isActive('image')"
      @click="tool = 'image'"
    >
      <UIcon name="i-lucide-image" class="size-[19px]" />
    </button>
    <!-- Эмодзи (13.3) — не "инструмент" в духе стикера/фигуры/текста: сразу
         открывает список, клик по эмодзи сразу вставляет его на доску
         (в центр текущего вьюпорта), без промежуточного клика по холсту. -->
    <UPopover :content="{ side: 'right', sideOffset: 20 }">
      <button type="button" class="board-toolbar-btn" :aria-label="t('board.toolEmoji')">
        <UIcon name="i-lucide-smile" class="size-[19px]" />
      </button>

      <template #content="{ close }">
        <EmojiPicker
          @select="
            (emoji: string) => {
              emit('emoji', emoji);
              close();
            }
          "
        />
      </template>
    </UPopover>

    <!-- Стикер-паки (13.4) — не "инструмент": кнопка открывает поповер с
         BoardStickerPicker (общий с «Заменить стикер» в тулбаре выделения),
         клик по стикеру сразу вставляет его на доску в центр вьюпорта. -->
    <UPopover :content="{ side: 'right', sideOffset: 20 }">
      <button type="button" class="board-toolbar-btn" :aria-label="t('board.toolSticker')">
        <UIcon name="i-lucide-sticker" class="size-[19px]" />
      </button>

      <template #content="{ close }">
        <BoardStickerPicker
          @select="
            (pack, id, format) => {
              emit('sticker', pack, id, format);
              close();
            }
          "
        />
      </template>
    </UPopover>
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('arrow') }"
      :aria-label="t('board.toolArrow')"
      :aria-pressed="isActive('arrow')"
      @click="tool = 'arrow'"
    >
      <UIcon name="i-lucide-move-up-right" class="size-[19px]" />
    </button>
    <!-- Фрейм (14.3) — инструмент "клик по пустому холсту создаёт фрейм", как у стикера -->
    <button
      type="button"
      class="board-toolbar-btn"
      :class="{ 'board-toolbar-btn-active': isActive('frame') }"
      :aria-label="t('board.toolFrame')"
      :aria-pressed="isActive('frame')"
      @click="tool = 'frame'"
    >
      <UIcon name="i-lucide-frame" class="size-[19px]" />
    </button>
  </div>
</template>

<style scoped>
@import './shared/board-toolbar.css';

.board-toolbar {
  position: absolute;
  top: 50%;
  left: 20px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--brand-surface);
  border-radius: 16px;
  box-shadow: var(--brand-shadow-card);
  transform: translateY(-50%);
}

.board-toolbar-btn {
  display: flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  color: var(--brand-ink);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 11px;
}

.board-toolbar-btn:hover {
  background: var(--ui-bg-elevated);
}

.board-toolbar-btn-active {
  color: white;
  background: var(--ui-primary);
}

.board-toolbar-btn-active:hover {
  background: var(--ui-primary);
}
</style>
