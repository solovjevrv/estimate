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
    <div class="flex flex-wrap items-center gap-2.5">
      <h1 class="font-heading text-[28px] font-extrabold">{{ props.name }}</h1>
      <UTooltip :text="props.connected ? t('room.connected') : t('room.disconnected')">
        <span
          class="badge-pill flex size-7 items-center justify-center p-0"
          :class="props.connected ? 'badge-pill-primary' : 'badge-pill-neutral'"
          :aria-label="props.connected ? t('room.connected') : t('room.disconnected')"
        >
          <UIcon :name="props.connected ? 'i-lucide-wifi' : 'i-lucide-wifi-off'" class="size-4" />
        </span>
      </UTooltip>
      <span v-if="props.archived" class="badge-pill badge-pill-neutral">
        {{ t('room.archived') }}
      </span>
    </div>
    <UDropdownMenu :items="menuItems">
      <UButton
        icon="i-lucide-ellipsis-vertical"
        color="neutral"
        variant="ghost"
        class="size-9 rounded-[10px]"
        :aria-label="t('room.roomMenu')"
      />
    </UDropdownMenu>
  </div>
</template>
