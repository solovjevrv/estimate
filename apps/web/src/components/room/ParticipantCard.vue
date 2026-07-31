<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { Participant } from '@poker/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import ParticipantCardBody from './ParticipantCardBody.vue';

const props = defineProps<{
  participant: Participant;
  isSelf: boolean;
  /** none — раунда нет, voting — идёт голосование (значения скрыты), revealed — карты вскрыты */
  roundStatus: 'none' | 'voting' | 'revealed';
  /** Подпись значения после вскрытия; null — раунда не было или участник не голосовал */
  valueLabel: string | null;
  isWinner: boolean;
  /** Меню исключения — открывается по клику на карточку; решает вызывающий (скрам-мастер и не на себе) */
  canKick: boolean;
}>();

const emit = defineEmits<{ kick: [] }>();

const { t } = useI18n();

/**
 * Действие используется редко, поэтому кнопку не держим на виду постоянно —
 * она прячется во всплывающее меню по клику на саму карточку (решение
 * пользователя 31.07.2026).
 */
const menuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: t('room.kickButton'),
      icon: 'i-lucide-user-x',
      color: 'error',
      onSelect: () => emit('kick'),
    },
  ],
]);
</script>

<template>
  <UDropdownMenu v-if="props.canKick" :items="menuItems">
    <ParticipantCardBody
      class="cursor-pointer"
      role="button"
      tabindex="0"
      :aria-label="t('room.kickMenuLabel', { name: participant.name })"
      :participant="participant"
      :is-self="isSelf"
      :round-status="roundStatus"
      :value-label="valueLabel"
      :is-winner="isWinner"
    />
  </UDropdownMenu>
  <ParticipantCardBody
    v-else
    :participant="participant"
    :is-self="isSelf"
    :round-status="roundStatus"
    :value-label="valueLabel"
    :is-winner="isWinner"
  />
</template>
