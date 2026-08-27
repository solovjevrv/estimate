<script setup lang="ts">
/**
 * Содержимое попапа «Размер фрейма» (22.4.2, тулбар выделения, по референсу
 * Miro) — вынесено из `BoardSelectionToolbar.vue` отдельным компонентом
 * (лимит `max-lines`), как уже сделано для похожих popup-блоков
 * (`BoardColorPickerMenu.vue`, `BoardFormatButtons.vue`).
 *
 * Превью-прямоугольник масштабируется под реальную пропорцию пресета (а не
 * рисуется одинаковым квадратом с подписью) — так «16:9» и «1:1» отличимы на
 * глаз ещё до чтения текста. `custom` в `FRAME_SIZE_PRESETS` не входит (см.
 * `board-constants.ts`) — своя кнопка выше остальных, без превью-прямоугольника.
 */
import {
  FRAME_SIZE_PRESETS,
  type FrameSizePresetKey,
} from '../../features/boards/config/board-constants';
import { useI18n } from 'vue-i18n';

const emit = defineEmits<{ select: [preset: FrameSizePresetKey] }>();
const { t } = useI18n();

const PREVIEW_MAX = 22;
function previewStyle(width: number, height: number): { width: string; height: string } {
  const ratio = width / height;
  return ratio >= 1
    ? { width: `${PREVIEW_MAX}px`, height: `${PREVIEW_MAX / ratio}px` }
    : { width: `${PREVIEW_MAX * ratio}px`, height: `${PREVIEW_MAX}px` };
}
</script>

<template>
  <div class="board-frame-size-menu">
    <button
      type="button"
      class="board-frame-size-item"
      :aria-label="t('board.frameSizePresets.custom')"
      @click="emit('select', 'custom')"
    >
      <span class="board-frame-size-preview board-frame-size-preview-custom">
        <UIcon name="i-lucide-scan" class="size-5" />
      </span>
      <span class="board-frame-size-caption">{{ t('board.frameSizePresets.custom') }}</span>
    </button>
    <button
      v-for="preset in FRAME_SIZE_PRESETS"
      :key="preset.key"
      type="button"
      class="board-frame-size-item"
      :aria-label="t(`board.frameSizePresets.${preset.key}`)"
      @click="emit('select', preset.key)"
    >
      <span class="board-frame-size-preview">
        <span
          class="board-frame-size-preview-box"
          :style="previewStyle(preset.width, preset.height)"
        />
      </span>
      <span class="board-frame-size-caption">{{ t(`board.frameSizePresets.${preset.key}`) }}</span>
    </button>
  </div>
</template>

<style scoped>
.board-frame-size-menu {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  width: 204px;
  padding: 8px;
}

.board-frame-size-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px 2px;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
}

.board-frame-size-item:hover {
  background: var(--ui-bg-elevated);
}

.board-frame-size-preview {
  display: flex;
  width: 100%;
  height: 24px;
  align-items: center;
  justify-content: center;
}

.board-frame-size-preview-box {
  box-sizing: border-box;
  border: 1.5px solid var(--brand-ink2);
  border-radius: 2px;
}

.board-frame-size-preview-custom {
  color: var(--brand-ink2);
}

.board-frame-size-caption {
  max-width: 100%;
  color: var(--brand-ink2);
  text-align: center;
  white-space: normal;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.15;
}
</style>
