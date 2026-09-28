<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { BoardSummary } from '@estimate/shared';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  board: BoardSummary;
  formatDate: (iso: string) => string;
  /** Плашка с именем команды (08_Boards, «Доски — Список») — видна только на личной
   *  странице «Доски», где вперемешку личные и командные; внутри самой команды не нужна */
  teamTag?: string | null;
  /** Кебаб-меню карточки видно только тому, кто может управлять этой доской — отсутствие
   *  массива, а не пустой массив, означает «действий нет, меню не показывать» */
  menuItems?: DropdownMenuItem[][];
  menuAriaLabel: string;
}>();

const { t } = useI18n();

const thumbnailFailed = ref(false);
watch(
  () => props.board.thumbnailUrl,
  () => {
    thumbnailFailed.value = false;
  },
);
</script>

<template>
  <div class="bg-surface-block shadow-elevation-2 flex flex-col overflow-hidden rounded-r24">
    <RouterLink
      :to="{ name: 'board', params: { id: board.id } }"
      class="bg-surface-tertiary flex h-[140px] shrink-0 items-center justify-center"
      :aria-label="t('board.openBoard', { title: board.title })"
    >
      <img
        v-if="board.itemCount > 0 && board.thumbnailUrl && !thumbnailFailed"
        :src="board.thumbnailUrl"
        :alt="t('board.thumbnailAlt', { title: board.title })"
        class="size-full object-cover"
        @error="thumbnailFailed = true"
      />
      <UIcon v-else name="i-lucide-image" class="text-muted size-8" />
    </RouterLink>
    <div class="flex flex-col gap-1.5 py-4 pr-4 pl-5">
      <div class="flex h-8 items-center gap-2">
        <RouterLink
          :to="{ name: 'board', params: { id: board.id } }"
          class="min-w-0 flex-1 truncate text-base font-bold"
        >
          {{ board.title }}
        </RouterLink>
        <UDropdownMenu v-if="menuItems" :items="menuItems">
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="menuAriaLabel"
          />
        </UDropdownMenu>
      </div>
      <div class="flex flex-col items-start gap-2">
        <span class="text-muted text-xs">{{ formatDate(board.createdAt) }}</span>
        <div v-if="teamTag" class="flex h-[34px] items-start gap-2">
          <span
            class="bg-surface-brand shrink-0 rounded-full px-3 py-2 text-xs font-bold text-white"
          >
            {{ teamTag }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
