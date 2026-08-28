<script setup lang="ts">
/**
 * Кто сейчас на доске (14.1) — компактный список аватарок с наездом, как в
 * Miro. Показывается родителем только когда >1 участник: аватарка себя
 * выделена. Наведение — tooltip с именем. Вся панель — на общей белой
 * карточке-подложке (surface-card), а иконка+счётчик внутри неё —
 * дополнительно на своей серой пилюле (вложенная подложка, как на
 * референсе), аватарки — прямо на белой карточке, без своей. Вынесена из
 * `BoardCanvas.vue` (17.1).
 */
import type { BoardPresenceEntry } from '@estimate/shared';
import { Panel } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  presence: BoardPresenceEntry[];
  participantId: string | null;
  followedParticipantId: string | null;
  initials: (name: string) => string;
}>();

const emit = defineEmits<{
  avatarClick: [entry: BoardPresenceEntry];
}>();

const { t } = useI18n();

function isSelf(entry: BoardPresenceEntry): boolean {
  return entry.participantId === props.participantId;
}

function isFollowing(entry: BoardPresenceEntry): boolean {
  return entry.participantId === props.followedParticipantId;
}
</script>

<template>
  <Panel position="top-right">
    <div
      data-testid="board-presence"
      class="board-presence surface-card flex items-center"
      :aria-label="t('board.presence')"
    >
      <div
        class="board-presence-count"
        :title="t('board.presenceCount', { count: presence.length })"
      >
        <UIcon name="i-lucide-users-2" class="size-4" />
        <span>{{ presence.length }}</span>
      </div>
      <div class="board-presence-stack">
        <div
          v-for="(entry, index) in presence"
          :key="entry.participantId"
          data-testid="board-presence-avatar"
          :data-participant-id="entry.participantId"
          :data-self="isSelf(entry) ? 'true' : 'false'"
          :data-following="isFollowing(entry) ? 'true' : 'false'"
          role="button"
          :tabindex="isSelf(entry) ? -1 : 0"
          :aria-pressed="isFollowing(entry)"
          :class="[
            'board-presence-avatar',
            {
              'board-presence-avatar--self': isSelf(entry),
              'board-presence-avatar--following': isFollowing(entry),
            },
          ]"
          :style="{ zIndex: presence.length - index }"
          :title="isSelf(entry) ? t('board.you') : entry.name"
          :aria-label="
            isSelf(entry) ? undefined : t('board.followAvatarLabel', { name: entry.name })
          "
          @click="emit('avatarClick', entry)"
          @keydown.enter="emit('avatarClick', entry)"
          @keydown.space.prevent="emit('avatarClick', entry)"
        >
          <img
            v-if="entry.avatarUrl"
            :src="entry.avatarUrl"
            :alt="entry.name"
            class="board-presence-img"
          />
          <span v-else class="board-presence-initials">{{ initials(entry.name) }}</span>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style scoped>
/* Панель «кто на доске» (14.1) — общая карточка-подложка, внутри неё —
   пилюля счётчика и стек аватарок */
.board-presence {
  gap: 8px;
  max-width: 260px;
  padding: 6px;
  border-radius: 20px;
  overflow: hidden;
}

/* Стек аватарок: каждая наезжает на предыдущую */
.board-presence-stack {
  display: flex;
  align-items: center;
}

.board-presence-avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ui-bg);
  border: 2px solid var(--brand-surface);
  overflow: visible;
  z-index: 0;
}

/* gap не поддерживает отрицательные значения (невалидное CSS-объявление
   отбрасывается целиком) — наезд аватарок делаем отрицательным margin */
.board-presence-avatar + .board-presence-avatar {
  margin-left: -11px;
}

/* Себя выделяем акцентной обводкой */
.board-presence-avatar--self {
  border-color: var(--ui-primary);
}

/* Чужую аватарку, за которую слежим — та же акцентная обводка */
.board-presence-avatar--following {
  border-color: var(--ui-primary);
}

/* Аватарка себя не кликабельна — курсор pointer только для чужих */
.board-presence-avatar:not(.board-presence-avatar--self) {
  cursor: pointer;
}

.board-presence-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.board-presence-initials {
  font-size: 11px;
  font-weight: 700;
  color: var(--brand-ink);
}

/* Иконка + счётчик участников — одна серая пилюля (как на референсе), не
   общая карточка на весь блок presence */
.board-presence-count {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  color: var(--brand-ink2);
  background: var(--ui-bg);
  border-radius: 16px;
}

.board-presence-count span {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-ink);
}
</style>
