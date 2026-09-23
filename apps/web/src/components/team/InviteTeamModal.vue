<script setup lang="ts">
import { useToast } from '@nuxt/ui/composables';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  inviteUrl: string | null;
  rotating: boolean;
}>();

const emit = defineEmits<{ rotate: [] }>();
const open = defineModel<boolean>('open', { required: true });

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
  <UModal v-model:open="open" :title="t('team.inviteTitle')" :description="t('team.inviteHint')">
    <template #body>
      <div class="flex flex-col gap-3.5">
        <div class="flex flex-wrap items-center gap-3">
          <UInput :model-value="inviteUrl ?? ''" readonly class="grow font-mono" />
          <UButton icon="i-lucide-copy" @click="copyInvite">
            {{ t('team.copy') }}
          </UButton>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="link"
          class="w-fit p-0 text-sm font-semibold"
          :loading="rotating"
          @click="emit('rotate')"
        >
          {{ t('team.rotate') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
