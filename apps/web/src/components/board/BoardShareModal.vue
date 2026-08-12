<template>
  <UModal
    v-model:open="modelValue"
    :title="t('board.shareTitle')"
  >
    <template #body>
      <div class="space-y-4">
        <p v-if="canManage" class="text-sm text-muted">
          {{ t('board.shareDescription') }}
        </p>

        <div v-if="canManage" class="space-y-2">
          <div class="flex gap-2">
            <UButton
              size="sm"
              :color="shareRole === null ? 'primary' : 'neutral'"
              :variant="shareRole === null ? 'solid' : 'ghost'"
              @click="apply(null)"
            >
              {{ t('board.shareDisabled') }}
            </UButton>
            <UButton
              size="sm"
              :color="shareRole === 'view' ? 'primary' : 'neutral'"
              :variant="shareRole === 'view' ? 'solid' : 'ghost'"
              @click="apply('view')"
            >
              {{ t('board.shareRoleView') }}
            </UButton>
            <UButton
              size="sm"
              :color="shareRole === 'edit' ? 'primary' : 'neutral'"
              :variant="shareRole === 'edit' ? 'solid' : 'ghost'"
              @click="apply('edit')"
            >
              {{ t('board.shareRoleEdit') }}
            </UButton>
          </div>

          <div v-if="shareRole" class="flex items-center gap-2">
            <UInput v-model="link" readonly variant="narrowed" size="sm" />
            <UButton
              icon="i-lucide-copy"
              :aria-label="t('board.shareCopied')"
              color="neutral"
              variant="ghost"
              @click="copy"
            />
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end">
        <UButton
          color="neutral"
          variant="ghost"
          @click="modelValue = false"
        >
          {{ t('common.close') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { Board, BoardShareRole } from '@poker/shared';
import { computed, ref } from 'vue';
import { useToast } from '@nuxt/ui/composables';
import { useI18n } from 'vue-i18n';

import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<{
  board: Board;
  canManage: boolean;
}>();
const modelValue = defineModel<boolean>();
const { t } = useI18n();
const toast = useToast();
const bs = useBoardSessionStore();

const shareRole = ref<BoardShareRole | null>(props.board.shareRole);

const link = computed(() => {
  const url = `${window.location.origin}/boards/${props.board.id}`;
  return shareRole.value ? `${url}?role=${shareRole.value}` : url;
});

async function apply(role: BoardShareRole | null): Promise<void> {
  try {
    const board = await bs.setShare(role);
    shareRole.value = board.shareRole;
    if (role !== null) {
      copy();
    }
  } catch {
    toast.add({ title: t('board.shareError'), color: 'error' });
  }
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
