<script setup lang="ts">
/**
 * Рендер анимированного личного стикера (21.7): Telegram TGS распаковывается
 * из gzip на сервере при импорте и хранится как обычный Lottie-JSON
 * (personal-stickers.service.ts) — здесь просто скармливаем URL lottie-web.
 *
 * lottie-web лениво импортируется (~130 КБ gzip) — тот же приём, что и с
 * emoji-каталогом в 21.4: не хотим тащить библиотеку в основной бандл ради
 * досок, на которых анимированных стикеров может не быть вовсе.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ src: string }>();

const container = ref<HTMLDivElement | null>(null);
let anim: import('lottie-web').AnimationItem | null = null;

async function load(): Promise<void> {
  const el = container.value;
  if (!el) return;
  anim?.destroy();
  anim = null;
  const { default: lottie } = await import('lottie-web');
  // Контейнер мог размонтироваться, пока shel await — не рендерим в никуда
  if (!container.value) return;
  anim = lottie.loadAnimation({
    container: container.value,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: props.src,
  });
}

onMounted(load);
watch(() => props.src, load);
onBeforeUnmount(() => anim?.destroy());
</script>

<template>
  <div ref="container" class="h-full w-full" />
</template>
