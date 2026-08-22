<script setup lang="ts">
/**
 * Плашка с названием доски поверх холста, как в Miro — не в потоке страницы
 * (12.5). Вынесена из `BoardCanvas.vue` (17.1) — чисто презентационная,
 * пункты меню и вычисление подзаголовка остаются у родителя.
 */
import type { Board } from '@poker/shared';
import type { DropdownMenuItem } from '@nuxt/ui';
import { Panel } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

defineProps<{
  board: Board;
  isArchived: boolean;
  subtitle: string;
  canManage: boolean;
  menuItems: DropdownMenuItem[][];
}>();

const { t } = useI18n();
</script>

<template>
  <Panel position="top-left">
    <div class="surface-card flex items-center gap-3.5 py-3.5 pr-2.5 pl-[18px]">
      <div class="flex min-w-0 flex-col">
        <RouterLink
          :to="{ name: 'boards' }"
          class="text-muted hover:text-highlighted w-fit text-xs font-semibold"
        >
          ← {{ t('board.backToBoards') }}
        </RouterLink>
        <div class="mt-0.5 flex min-w-0 items-center gap-2">
          <h1 class="font-heading min-w-0 truncate text-lg font-extrabold">
            {{ board.title }}
          </h1>
          <span v-if="isArchived" class="badge-pill badge-pill-neutral shrink-0">{{
            t('board.archivedBadge')
          }}</span>
        </div>
        <span class="text-muted text-xs font-semibold">{{ subtitle }}</span>
      </div>
      <UDropdownMenu v-if="canManage" :items="menuItems">
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="ghost"
          square
          :aria-label="t('board.moreActions')"
        />
      </UDropdownMenu>
    </div>
  </Panel>
</template>
