<script setup lang="ts">
/**
 * Рендер анимированного личного стикера (21.7): Telegram TGS распаковывается
 * из gzip на сервере при импорте и хранится как обычный Lottie-JSON
 * (personal-stickers.service.ts) — здесь просто скармливаем URL lottie-web.
 *
 * lottie-web лениво импортируется (~130 КБ gzip) — тот же приём, что и с
 * emoji-каталогом в 21.4: не хотим тащить библиотеку в основной бандл ради
 * досок, на которых анимированных стикеров может не быть вовсе.
 *
 * Оптимизация нагрузки (21.8, по итогам замера `docs/sticker-animation-perf-report.md`):
 * 50 одновременных анимаций на `renderer: 'svg'` держат 60fps, но занимают ~90%
 * одного ядра CPU — запаса на другую работу (драг, клик) почти не остаётся.
 * `renderer: 'canvas'` снижает это до ~58% и полностью убирает DOM-стоимость
 * (Layout/Recalc Style), т.к. рисует в растровый буфer, а не мутирует DOM на
 * каждый кадр. Плюс `IntersectionObserver` останавливает анимацию, когда
 * стикер уходит за пределы экрана (панорамирование Vue Flow — это
 * CSS-transform, не скролл, но обсёрвер считает по фактической геометрии на
 * экране, так что срабатывает корректно без кастомного `root`) — число
 * реально работающих анимаций ограничено видимой областью, а не всей доской.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ src: string }>();

const container = ref<HTMLDivElement | null>(null);
let anim: import('lottie-web').AnimationItem | null = null;
let observer: IntersectionObserver | null = null;
let isVisible = false;

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
    renderer: 'canvas',
    loop: true,
    autoplay: isVisible,
    path: props.src,
  });
}

function setupObserver(): void {
  const el = container.value;
  if (!el) return;
  observer = new IntersectionObserver(([entry]) => {
    isVisible = entry?.isIntersecting ?? false;
    if (isVisible) {
      anim?.play();
    } else {
      anim?.pause();
    }
  });
  observer.observe(el);
}

onMounted(() => {
  setupObserver();
  void load();
});
watch(() => props.src, load);
onBeforeUnmount(() => {
  anim?.destroy();
  observer?.disconnect();
});
</script>

<template>
  <div ref="container" class="h-full w-full" />
</template>
