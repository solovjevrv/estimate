<script setup lang="ts">
/**
 * Общий рендер стикера любого формата (21.7) — единая точка, где решается,
 * каким тегом показать личный Telegram-стикер: video (webm), LottieSticker
 * (TGS→JSON) или img (static webp, тот же путь, что и встроенные паки).
 * Используется и в пикере (превью табов/сетки), и на самой доске
 * (BoardStickerNode.vue) — чтобы не дублировать этот switch в обоих местах.
 */
import type { PersonalStickerFormat } from '@estimate/shared';

import LottieSticker from './LottieSticker.vue';

withDefaults(
  defineProps<{
    src: string;
    format?: PersonalStickerFormat;
    alt?: string;
  }>(),
  { format: 'static', alt: 'sticker' },
);
</script>

<template>
  <video
    v-if="format === 'video'"
    class="h-full w-full object-contain"
    :src="src"
    autoplay
    loop
    muted
    playsinline
    disablepictureinpicture
  />
  <LottieSticker v-else-if="format === 'animated'" class="h-full w-full" :src="src" />
  <img
    v-else
    class="h-full w-full object-contain"
    :src="src"
    :alt="alt"
    draggable="false"
    @load.stop
    @error.stop
  />
</template>
