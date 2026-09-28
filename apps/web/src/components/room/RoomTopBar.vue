<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  name: string;
  teamId: string | null;
  /** Название команды для подзаголовка «Команда «…»» (07_Room); null — не известно */
  teamName: string | null;
  archived: boolean;
  connected: boolean;
  canArchive: boolean;
  canRename: boolean;
}>();

const emit = defineEmits<{ archive: []; rename: [] }>();

const { t } = useI18n();
const toast = useToast();

const subtitle = computed(() => {
  if (!props.teamId) return t('room.personalRoomSubtitle');
  return props.teamName ? t('common.teamOf', { name: props.teamName }) : t('room.teamRoomSubtitle');
});

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast.add({ title: t('room.linkCopied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('room.linkCopyError'), color: 'error' });
  }
}

const menuItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = [];
  if (props.canRename) {
    groups.push([
      { label: t('room.rename'), icon: 'i-lucide-pencil', onSelect: () => emit('rename') },
    ]);
  }
  groups.push([
    { label: t('room.copyLink'), icon: 'i-lucide-link', onSelect: () => void copyLink() },
  ]);
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
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2.5">
        <UTooltip :text="props.name" :ui="{ content: 'max-w-xs' }">
          <h1
            class="font-heading min-w-0 truncate text-[32px] leading-[40px] font-bold tracking-[-0.96px]"
          >
            {{ props.name }}
          </h1>
        </UTooltip>
        <UTooltip :text="props.connected ? t('room.connected') : t('room.disconnected')">
          <span
            class="size-[10px] shrink-0 rounded-full"
            :class="props.connected ? 'bg-[var(--icons-success)]' : 'bg-[var(--icons-tertiary)]'"
            :aria-label="props.connected ? t('room.connected') : t('room.disconnected')"
          />
        </UTooltip>
        <span v-if="props.archived" class="badge-pill badge-pill-neutral shrink-0">
          {{ t('room.archived') }}
        </span>
      </div>
      <p class="text-text-secondary mt-1 text-sm">
        {{ subtitle }}
      </p>
    </div>
    <UDropdownMenu :items="menuItems">
      <UButton
        icon="i-lucide-ellipsis-vertical"
        color="neutral"
        variant="ghost"
        size="sm"
        class="shrink-0"
        :aria-label="t('room.roomMenu')"
      />
    </UDropdownMenu>
  </div>
</template>
