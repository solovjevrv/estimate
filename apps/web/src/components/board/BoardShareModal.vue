<script setup lang="ts">
import { BOARD_SHARE_ROLES } from '@poker/shared';
import type { Board, BoardShareRole } from '@poker/shared';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useBoardSessionStore } from '../../stores/board-session';

const props = defineProps<{
  board: Board;
  canManage: boolean;
}>();
const modelValue = defineModel<boolean>();

const { t } = useI18n();

const bs = useBoardSessionStore();

const isOwner = computed(() => props.canManage);

// Текущий роль шаринга — из пропса board.shareRole; при отключённом шаринге null
const shareRole = ref<BoardShareRole | null>(props.board.shareRole);

const link = computed(() => {
  const base = window.location.origin;
  const url = `${base}/boards/${props.board.id}`;
  return shareRole.value ? `${url}?role=${shareRole.value}` : url;
});

async function apply(role: BoardShareRole | null): Promise<void> {
  const board = await bs.setShare(role);
  shareRole.value = board.shareRole;
  if (role !== null) {
    await copy();
  }
}

const copied = ref(false);
async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
    window.dispatchEvent(
      new CustomEvent('toast', { detail: { message: t('board.shareCopied') } }),
    );
  } catch {
    window.dispatchEvent(new CustomEvent('toast', { detail: { message: t('board.shareError') } }));
  }
}
</script>

<template>
  <teleport to="body">
    <dialog v-if="modelValue" class="share-dialog" @click.self="modelValue = false">
     <div class="share-dialog__panel" @click.stop>
      <h2 class="share-dialog__title">{{ t('board.shareTitle') }}</h2>

      <p v-if="isOwner" class="share-dialog__hint">
        {{ t('board.shareDescription') }}
      </p>

      <template v-if="isOwner">
        <div class="share-dialog__roles">
          <label class="share-dialog__role">
            <input
              type="radio"
              name="role"
              :value="null"
              :checked="shareRole === null"
              @change="apply(null)"
            />
            {{ t('board.shareDisabled') }}
          </label>
          <label
            v-for="role in BOARD_SHARE_ROLES"
            :key="role"
            class="share-dialog__role"
          >
            <input
              type="radio"
              name="role"
              :value="role"
              :checked="shareRole === role"
              @change="apply(role)"
            />
            {{ role === 'view' ? t('board.shareRoleView') : t('board.shareRoleEdit') }}
          </label>
        </div>

        <div v-if="shareRole" class="share-dialog__row">
          <input
            readonly
            :value="link"
            class="share-dialog__input"
            @click="copy"
          />
          <button
            v-if="copied"
            type="button"
            class="share-dialog__copied"
          >
            ✓
          </button>
        </div>

        <p v-else class="share-dialog__hint">
          {{ t('board.shareEnableView') }} / {{ t('board.shareEnableEdit') }}
        </p>
      </template>

      <template v-else>
        <p class="share-dialog__hint">
          {{ t('board.guestName') }}: {{ props.board.shareRole ?? t('board.shareRoleView') }}
        </p>
      </template>

      <footer class="share-dialog__footer">
        <button type="button" class="btn btn--ghost" @click="modelValue = false">
          {{ t('common.close') }}
        </button>
      </footer>
    </div>
  </dialog>
  </teleport>
</template>

<style>
.share-dialog {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.share-dialog__panel {
  background: var(--surface-elevated);
  border-radius: 12px;
  padding: 20px;
  max-width: 480px;
  width: 90%;
  color: var(--text-primary);
}

.share-dialog__title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
}

.share-dialog__hint {
  margin: 8px 0 16px;
  color: var(--text-secondary);
  font-size: 14px;
}

.share-dialog__roles {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.share-dialog__role {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}

.share-dialog__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.share-dialog__input {
  flex: 1;
  padding: 6px 8px;
  font-size: 13px;
  background: var(--surface-base);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.share-dialog__copied {
  background: var(--green-500);
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
}

.share-dialog__footer {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
