<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  canManageTeam: boolean;
  inviteUrl: string | null;
}>();

const emit = defineEmits<{
  rotateClick: [];
  renameClick: [];
  leaveClick: [];
  deleteClick: [];
}>();

const { t } = useI18n();
const toast = useToast();

async function copyInvite(): Promise<void> {
  if (!props.inviteUrl) return;
  try {
    await navigator.clipboard.writeText(props.inviteUrl);
    toast.add({ title: t('team.copied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('team.copyFailed'), color: 'error' });
  }
}
</script>

<template>
  <div v-if="inviteUrl" class="surface-card px-4 py-5 sm:px-[30px] sm:py-[26px]">
    <h2 class="mb-1.5 text-[17px] font-bold">{{ t('team.inviteTitle') }}</h2>
    <p class="text-muted mb-4 text-sm">{{ t('team.inviteHint') }}</p>
    <div class="mb-3.5 flex flex-wrap items-center gap-3">
      <UInput
        :model-value="inviteUrl"
        readonly
        class="grow"
        :ui="{
          base: 'font-mono rounded-[11px] border-[length:1.5px] border-[color:var(--brand-border)] bg-[var(--brand-surface)] px-4 py-3 ring-0',
        }"
      />
      <UButton
        icon="i-lucide-copy"
        class="rounded-[10px] px-[18px] py-3 text-sm font-bold"
        @click="copyInvite"
      >
        {{ t('team.copy') }}
      </UButton>
    </div>
    <UButton
      icon="i-lucide-refresh-cw"
      color="neutral"
      variant="link"
      class="p-0 text-[13.5px] font-semibold"
      @click="emit('rotateClick')"
    >
      {{ t('team.rotate') }}
    </UButton>
  </div>

  <div class="surface-card px-4 py-5 sm:px-[30px] sm:py-[26px]">
    <h2 class="mb-[18px] text-[17px] font-bold">{{ t('team.settingsTitle') }}</h2>
    <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <UButton
        v-if="canManageTeam"
        icon="i-lucide-pencil"
        color="neutral"
        variant="outline"
        class="w-full justify-center rounded-[10px] px-[18px] py-[11px] text-sm font-bold sm:w-auto"
        @click="emit('renameClick')"
      >
        {{ t('team.rename') }}
      </UButton>
      <!-- Выйти может любой участник; единственному администратору бэкенд
           откажет (409) и предложит сначала назначить другого -->
      <UButton
        icon="i-lucide-log-out"
        color="neutral"
        variant="outline"
        class="w-full justify-center rounded-[10px] px-[18px] py-[11px] text-sm font-bold sm:w-auto"
        @click="emit('leaveClick')"
      >
        {{ t('team.leave') }}
      </UButton>
      <UButton
        v-if="canManageTeam"
        icon="i-lucide-trash-2"
        color="error"
        variant="subtle"
        class="w-full justify-center rounded-[10px] px-[18px] py-[11px] text-sm font-bold sm:w-auto"
        @click="emit('deleteClick')"
      >
        {{ t('team.deleteTeam') }}
      </UButton>
    </div>
  </div>
</template>
