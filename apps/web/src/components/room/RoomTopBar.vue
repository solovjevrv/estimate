<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  name: string;
  archived: boolean;
  connected: boolean;
  canArchive: boolean;
}>();

const emit = defineEmits<{ archive: [] }>();

const { t } = useI18n();
const toast = useToast();

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast.add({ title: t('room.linkCopied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('room.linkCopyError'), color: 'error' });
  }
}

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = [
    [{ label: t('room.copyLink'), icon: 'i-lucide-link', onSelect: () => void copyLink() }],
  ];
  if (props.canArchive) {
    groups.push([
      {
        label: t('room.archive'),
        icon: 'i-lucide-archive',
        color: 'error',
        onSelect: () => emit('archive'),
      },
    ]);
  }
  return groups;
});
</script>

<template>
  <div class="flex items-start justify-between gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="text-2xl font-semibold">{{ props.name }}</h1>
      <UBadge :color="props.connected ? 'success' : 'error'" variant="subtle">
        {{ props.connected ? t('room.connected') : t('room.disconnected') }}
      </UBadge>
      <UBadge v-if="props.archived" color="warning" variant="subtle">
        {{ t('room.archived') }}
      </UBadge>
    </div>
    <UDropdownMenu :items="menuItems">
      <UButton
        icon="i-lucide-ellipsis-vertical"
        color="neutral"
        variant="ghost"
        :aria-label="t('room.roomMenu')"
      />
    </UDropdownMenu>
  </div>
</template>
