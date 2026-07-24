<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { GUEST_NAME_MAX_LENGTH, type Room } from '@poker/shared';
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError, api } from '../lib/api';
import { useRoomStore } from '../stores/room';
import { useSessionStore } from '../stores/session';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const session = useSessionStore();
const room = useRoomStore();

type Phase = 'loading' | 'notFound' | 'loadError' | 'naming' | 'joining' | 'joined' | 'joinError';

const phase = ref<Phase>('loading');
const roomInfo = ref<Room | null>(null);
const guestState = reactive({ name: readStoredGuestName() });

/** Гость называет имя один раз за вкладку — переживает перезагрузку, не переживает закрытие */
function readStoredGuestName(): string {
  try {
    return sessionStorage.getItem('poker:guest-name') ?? '';
  } catch {
    return '';
  }
}

function storeGuestName(name: string): void {
  try {
    sessionStorage.setItem('poker:guest-name', name);
  } catch {
    // Приватный режим браузера может запрещать хранилище — в рамках вкладки не критично
  }
}

watch(() => props.id, load, { immediate: true });

onBeforeUnmount(() => {
  room.leave();
});

async function load(): Promise<void> {
  phase.value = 'loading';
  room.leave();
  try {
    const res = await api.get<{ room: Room }>(`/api/rooms/${encodeURIComponent(props.id)}`);
    roomInfo.value = res.room;
  } catch (err) {
    phase.value = err instanceof ApiError && err.status === 404 ? 'notFound' : 'loadError';
    return;
  }

  if (session.isAuthenticated) {
    await joinAsSelf();
  } else {
    phase.value = 'naming';
  }
}

async function joinAsSelf(): Promise<void> {
  phase.value = 'joining';
  try {
    await room.join(props.id);
    phase.value = 'joined';
  } catch {
    phase.value = 'joinError';
  }
}

function validateName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = s.name.trim();
  if (!name) {
    errors.push({ name: 'name', message: t('room.nameRequired') });
  } else if (name.length > GUEST_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('room.nameTooLong', { max: GUEST_NAME_MAX_LENGTH }) });
  }
  return errors;
}

async function onJoinAsGuest(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  const name = event.data.name.trim();
  storeGuestName(name);
  phase.value = 'joining';
  try {
    await room.join(props.id, name);
    phase.value = 'joined';
  } catch {
    phase.value = 'joinError';
  }
}

/** После сбоя входа гостю дают попробовать снова с тем же именем, вошедшему — без формы */
function retry(): void {
  if (session.isAuthenticated) {
    void joinAsSelf();
  } else {
    phase.value = 'naming';
  }
}
</script>

<template>
  <section class="space-y-6">
    <UAlert
      v-if="phase === 'notFound'"
      color="error"
      variant="subtle"
      :description="t('room.notFound')"
    />
    <UAlert
      v-else-if="phase === 'loadError'"
      color="error"
      variant="subtle"
      :description="t('room.loadError')"
    />

    <div v-else-if="phase === 'loading'" class="text-muted flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
    </div>

    <template v-else-if="roomInfo">
      <h1 class="text-2xl font-semibold">{{ roomInfo.name }}</h1>

      <UCard v-if="phase === 'naming'" class="max-w-sm">
        <template #header>
          <h2 class="font-medium">{{ t('room.nameTitle') }}</h2>
        </template>
        <UForm
          :state="guestState"
          :validate="validateName"
          class="space-y-4"
          @submit="onJoinAsGuest"
        >
          <UFormField :label="t('room.nameLabel')" name="name">
            <UInput
              v-model="guestState.name"
              :placeholder="t('room.namePlaceholder')"
              :maxlength="GUEST_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
            />
          </UFormField>
          <UButton type="submit" block>{{ t('room.join') }}</UButton>
        </UForm>
      </UCard>

      <div v-else-if="phase === 'joining'" class="text-muted flex items-center gap-2">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
        {{ t('room.joining') }}
      </div>

      <template v-else-if="phase === 'joinError'">
        <UAlert color="error" variant="subtle" :description="t('room.joinError')" />
        <UButton class="mt-3" color="neutral" variant="subtle" @click="retry">
          {{ t('room.retry') }}
        </UButton>
      </template>

      <template v-else-if="phase === 'joined'">
        <p class="text-muted text-sm">
          {{ t('room.joinedAs', { name: session.user?.name ?? guestState.name }) }}
          <UBadge :color="room.connected ? 'success' : 'error'" variant="subtle" class="ml-2">
            {{ room.connected ? t('room.connected') : t('room.disconnected') }}
          </UBadge>
        </p>
        <!-- Игровой стол и участники — Epic 5 -->
        <p class="text-muted">{{ t('room.soon') }}</p>
      </template>
    </template>
  </section>
</template>
