<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { TeamMember, TeamRole } from '@estimate/shared';
import { useI18n } from 'vue-i18n';

import { roleBadgeColor, teamAvatarColor } from '../../lib/team-roles';

const props = defineProps<{
  teamId: string;
  members: TeamMember[];
  canManageTeam: boolean;
  currentUserId: string | null;
  roleItems: { label: string; value: TeamRole }[];
  isBusy: (userId: string) => boolean;
}>();

const emit = defineEmits<{
  roleChange: [member: TeamMember, role: TeamRole];
  remove: [member: TeamMember];
}>();

const { t } = useI18n();

/**
 * Действия скрыты за меню (05_Members): бейдж роли статичный, смена роли —
 * подменю-чеклист с текущим значением, а не всегда открытый select в строке.
 */
function menuItems(member: TeamMember): DropdownMenuItem[][] {
  return [
    [
      {
        label: t('team.changeRole'),
        icon: 'i-lucide-shield',
        children: props.roleItems.map((item) => ({
          label: item.label,
          type: 'checkbox' as const,
          checked: member.role === item.value,
          onSelect: () => emit('roleChange', member, item.value),
        })),
      },
    ],
    [
      {
        label: t('team.remove'),
        icon: 'i-lucide-user-minus',
        color: 'error' as const,
        onSelect: () => emit('remove', member),
      },
    ],
  ];
}
</script>

<template>
  <div class="surface-card px-4 py-5 sm:px-[30px] sm:py-[26px]">
    <h2 class="mb-[18px] text-lg font-bold">{{ t('team.membersTitle') }}</h2>
    <div
      v-for="member in members"
      :key="member.userId"
      class="border-default flex flex-wrap items-center justify-between gap-3 border-t py-3.5 first:border-t-0 first:pt-0 last:pb-0"
    >
      <RouterLink
        :to="{ name: 'team-member', params: { id: teamId, userId: member.userId } }"
        class="hover:text-primary flex min-w-36 items-center gap-3.5"
      >
        <UAvatar
          :src="member.avatarUrl ?? undefined"
          :alt="member.name"
          size="xl"
          class="shrink-0"
          :class="teamAvatarColor(member.userId)"
          :ui="{ fallback: 'font-heading text-sm font-bold text-white' }"
        />
        <span class="min-w-0 truncate text-sm font-bold">{{ member.name }}</span>
      </RouterLink>

      <div class="ml-[52px] flex shrink-0 items-center gap-3 sm:ml-0">
        <span
          class="badge-pill"
          :class="
            roleBadgeColor(member.role) === 'primary' ? 'badge-pill-primary' : 'badge-pill-neutral'
          "
        >
          {{ t(`role.${member.role}`) }}
        </span>

        <UDropdownMenu
          v-if="canManageTeam && member.userId !== currentUserId"
          :items="menuItems(member)"
        >
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="t('team.memberMenu')"
            :disabled="isBusy(member.userId)"
          />
        </UDropdownMenu>
      </div>
    </div>
  </div>
</template>
