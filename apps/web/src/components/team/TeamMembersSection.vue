<script setup lang="ts">
import type { TeamMember, TeamRole } from '@poker/shared';
import { useI18n } from 'vue-i18n';

import { roleBadgeColor, teamAvatarColor } from '../../lib/team-roles';

defineProps<{
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
</script>

<template>
  <div class="surface-card px-4 py-5 sm:px-[30px] sm:py-[26px]">
    <h2 class="mb-[18px] text-[17px] font-bold">{{ t('team.membersTitle') }}</h2>
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
          size="md"
          class="size-[38px] shrink-0"
          :class="teamAvatarColor(member.userId)"
          :ui="{ fallback: 'font-heading text-[12px] font-bold text-white' }"
        />
        <span class="min-w-0 truncate text-[15.5px] font-bold">{{ member.name }}</span>
      </RouterLink>

      <div class="ml-[52px] flex shrink-0 items-center gap-3 sm:ml-0">
        <!-- Администратор меняет роли всем, кроме себя; себе показываем бейдж -->
        <USelect
          v-if="canManageTeam && member.userId !== currentUserId"
          :model-value="member.role"
          :items="roleItems"
          value-key="value"
          :aria-label="t('team.roleLabel')"
          :disabled="isBusy(member.userId)"
          class="w-40"
          :ui="{
            base: 'rounded-[9px] border border-[var(--brand-border)] bg-[var(--brand-surface)] py-2 ps-3.5 pe-[34px] ring-0',
          }"
          @update:model-value="emit('roleChange', member, $event as TeamRole)"
        />
        <span
          v-else
          class="badge-pill"
          :class="
            roleBadgeColor(member.role) === 'primary' ? 'badge-pill-primary' : 'badge-pill-neutral'
          "
        >
          {{ t(`role.${member.role}`) }}
        </span>

        <UButton
          v-if="canManageTeam && member.userId !== currentUserId"
          icon="i-lucide-user-minus"
          color="error"
          variant="ghost"
          size="sm"
          :aria-label="t('team.remove')"
          :disabled="isBusy(member.userId)"
          @click="emit('remove', member)"
        />
      </div>
    </div>
  </div>
</template>
