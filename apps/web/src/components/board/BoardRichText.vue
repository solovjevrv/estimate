<script setup lang="ts">
/**
 * Режим просмотра форматированного текста стикера/фигуры (12.13) — вынесено
 * в отдельный компонент, а не продублировано в `BoardStickyNode.vue`/
 * `BoardShapeNode.vue` (было ревью-находкой: блок `<a>`/`<span>` был
 * побайтово одинаков в обоих файлах). Только рендер runs текстом/ссылками —
 * без стилей/размера обёртки, это остаётся заботой компонента-хозяина
 * (у стикера и фигуры разное позиционирование бокса).
 */
import type { BoardTextRun } from '@poker/shared';

import { markCssProperties } from '../../lib/board/board-rich-text';

defineProps<{ runs: BoardTextRun[] }>();
</script>

<template>
  <template v-for="(run, index) in runs" :key="index">
    <a
      v-if="run.marks?.link"
      :href="run.marks.link"
      target="_blank"
      rel="noopener noreferrer"
      :style="markCssProperties(run.marks)"
      @click.stop
      >{{ run.text }}</a
    >
    <span v-else :style="markCssProperties(run.marks)">{{ run.text }}</span>
  </template>
</template>
