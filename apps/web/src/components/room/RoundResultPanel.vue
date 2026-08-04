<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import StatRing from './StatRing.vue';

const props = withDefaults(
  defineProps<{
    average: number | null;
    minLabel: string;
    maxLabel: string;
    agreement: number;
    winnerLabel: string | null;
    /** Голоса тех, кто успел проголосовать и вышел до вскрытия — их карточки уже нет в «Участниках» */
    departedVotes?: Array<{ participantId: string; name: string; valueLabel: string }>;
  }>(),
  { departedVotes: () => [] },
);

const { t } = useI18n();

interface ConfettiPiece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  color: string;
}

const confettiColors = [
  'var(--ui-color-primary-500)',
  'var(--brand-amber)',
  'var(--brand-primary-text)',
];

const confetti = ref<ConfettiPiece[]>([]);
let nextConfettiId = 0;
let clearConfettiTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Панель монтируется заново на каждое вскрытие (`v-if="room.result"` в RoomPage —
 * `result` обнуляется новым раундом), поэтому `{ immediate: true }` = «сработай при
 * каждом реальном вскрытии» без отдельного watch на явное событие reveal.
 *
 * Эффект теперь не только для единодушного консенсуса (10.12: «анимация после любого
 * вскрытия» + «увеличить видимость конфетти») — срабатывает всегда, но при 100%
 * agreement заметно масштабнее (в 3+ раза больше конфетти), чем при частичном согласии.
 */
watch(
  () => props.agreement,
  (agreement) => {
    const isUnanimous = agreement === 100;
    const count = isUnanimous ? 70 : 18;
    confetti.value = Array.from({ length: count }, (_, i) => ({
      id: nextConfettiId++,
      left: Math.random() * 100,
      delay: Math.random() * (isUnanimous ? 0.4 : 0.2),
      duration: 1.4 + Math.random() * 0.8,
      color: confettiColors[i % confettiColors.length] ?? confettiColors[0]!,
    }));
    if (clearConfettiTimer) clearTimeout(clearConfettiTimer);
    clearConfettiTimer = setTimeout(() => {
      confetti.value = [];
    }, 2400);
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <!-- Во весь экран (не заперто в карточке результата) — 10.12: «увеличить видимость конфетти» -->
    <div class="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      <div
        v-for="piece in confetti"
        :key="piece.id"
        class="confetti-piece absolute top-0 size-2.5 rounded-sm"
        :style="{
          left: piece.left + '%',
          backgroundColor: piece.color,
          animationDelay: piece.delay + 's',
          animationDuration: piece.duration + 's',
        }"
      />
    </div>
  </Teleport>
  <div class="reveal-pop relative">
    <h2 class="text-muted mb-[18px] text-sm font-bold tracking-[0.03em] uppercase">
      {{ t('room.resultTitle') }}
    </h2>
    <div class="flex flex-wrap items-center gap-6">
      <div v-if="props.winnerLabel" class="flex flex-col items-center gap-1">
        <span class="text-muted text-xs">{{ t('room.resultWinnerLabel') }}</span>
        <span class="font-heading text-2xl font-extrabold text-[var(--brand-primary-text)]">{{
          props.winnerLabel
        }}</span>
      </div>

      <StatRing
        v-if="props.average !== null"
        :value-label="String(props.average)"
        :label="t('room.resultAverage', { average: props.average })"
      />
      <StatRing
        :value-label="`${props.agreement}%`"
        :percent="props.agreement"
        :label="t('room.resultAgreement', { agreement: props.agreement })"
      />
      <StatRing
        :value-label="props.minLabel"
        :label="t('room.resultMin', { min: props.minLabel })"
      />
      <StatRing
        :value-label="props.maxLabel"
        :label="t('room.resultMax', { max: props.maxLabel })"
      />
    </div>

    <div v-if="props.departedVotes.length" class="mt-4">
      <h3 class="text-muted mb-2 text-xs font-bold tracking-[0.03em] uppercase">
        {{ t('room.resultDepartedTitle') }}
      </h3>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="v in props.departedVotes"
          :key="v.participantId"
          class="badge-pill badge-pill-neutral"
        >
          {{ v.name }}: {{ v.valueLabel }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confetti-piece {
  animation-name: confetti-fall;
  animation-timing-function: ease-in;
  animation-fill-mode: forwards;
}

@keyframes confetti-fall {
  0% {
    opacity: 1;
    transform: translateY(-10px) rotate(0deg);
  }
  100% {
    opacity: 0;
    transform: translateY(100vh) rotate(360deg);
  }
}

.reveal-pop {
  animation: reveal-pop 0.3s ease-out;
}

@keyframes reveal-pop {
  0% {
    opacity: 0;
    transform: scale(0.96);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
