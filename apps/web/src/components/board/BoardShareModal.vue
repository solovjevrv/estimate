<template>
  <UModal v-model:open="modelValue" :title="t('board.shareTitle')" :ui="MODAL_UI">
    <template #body>
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <p class="text-[14.5px] font-bold">{{ t('board.shareToggleLabel') }}</p>
            <p class="text-muted mt-0.5 text-[13px]">{{ t('board.shareDescription') }}</p>
          </div>
          <USwitch :model-value="enabled" @update:model-value="onToggle" />
        </div>

        <template v-if="enabled">
          <USelect
            :model-value="shareRole ?? undefined"
            :items="roleItems"
            value-key="value"
            :aria-label="t('board.shareRoleLabel')"
            class="w-full"
            :ui="{ base: SHARE_SELECT_UI_BASE }"
            @update:model-value="onRoleChange($event as BoardShareRole)"
          />

          <div class="flex items-center gap-2">
            <UInput :model-value="link" readonly class="min-w-0 flex-1" :ui="MODAL_INPUT_UI" />
            <UButton
              icon="i-lucide-copy"
              :aria-label="t('board.shareCopy')"
              color="neutral"
              variant="outline"
              :ui="MODAL_BUTTON_UI"
              @click="copy"
            />
          </div>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end">
        <UButton
          color="neutral"
          variant="outline"
          :ui="MODAL_BUTTON_UI"
          @click="modelValue = false"
        >
          {{ t('board.shareClose') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import type { Board, BoardShareRole } from '@poker/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../../lib/modal-ui';
import { useBoardSessionStore } from '../../stores/board-session';

/**
 * Те же токены, что у MODAL_INPUT_UI (радиус/бордер/паддинг/шрифт) — иначе
 * select визуально отличался от соседнего поля со ссылкой (другая высота,
 * скругление). Правый паддинг чуть больше — там рисуется шеврон.
 */
const SHARE_SELECT_UI_BASE = MODAL_INPUT_UI.base.replace('px-4', 'ps-4 pe-9');

/**
 * canManage не проверяем здесь: модалка открывается только из пункта меню
 * «Поделиться», а сам этот пункт виден только под `v-if="canManage"` в
 * BoardCanvas.vue — если модалка открыта, доступ уже подтверждён.
 */
const props = defineProps<{
  board: Board;
}>();
const modelValue = defineModel<boolean>();
const { t } = useI18n();
const toast = useToast();
const bs = useBoardSessionStore();

const shareRole = ref<BoardShareRole | null>(props.board.shareRole);
const enabled = computed(() => shareRole.value !== null);

const roleItems = computed(() => [
  { label: t('board.shareRoleView'), value: 'view' as const },
  { label: t('board.shareRoleEdit'), value: 'edit' as const },
]);

const link = computed(() => `${window.location.origin}/boards/${props.board.id}`);

async function apply(role: BoardShareRole | null): Promise<void> {
  const previous = shareRole.value;
  shareRole.value = role;
  try {
    const board = await bs.setShare(role);
    shareRole.value = board.shareRole;
  } catch {
    shareRole.value = previous;
    toast.add({ title: t('board.shareError'), color: 'error' });
  }
}

/** Включение — сразу с уровнем «только просмотр», как более безопасный дефолт */
function onToggle(next: boolean): void {
  void apply(next ? 'view' : null);
}

function onRoleChange(role: BoardShareRole): void {
  void apply(role);
}

function copy(): void {
  void navigator.clipboard
    .writeText(link.value)
    .then(() => {
      toast.add({ title: t('board.shareCopied'), color: 'success' });
    })
    .catch(() => {
      toast.add({ title: t('board.shareError'), color: 'error' });
    });
}
</script>
