<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  FIBONACCI_DECK,
  GUEST_NAME_MAX_LENGTH,
  SCALE_0_5_DECK,
  type DeckType,
  type Room,
} from '@poker/shared';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { ApiError, api } from '../lib/api';
import { useRoomStore } from '../stores/room';
import { useSessionStore } from '../stores/session';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();
const room = useRoomStore();

const deckOptions = computed<Array<{ label: string; value: DeckType }>>(() => [
  { label: t('room.deckFibonacci'), value: 'fibonacci' },
  { label: t('room.deckScale05'), value: 'scale_0_5' },
]);
const selectedDeck = ref<DeckType>('fibonacci');
const starting = ref(false);

const deckCards = computed<readonly number[]>(() =>
  room.round?.deckType === 'scale_0_5' ? SCALE_0_5_DECK : FIBONACCI_DECK,
);
/** Свой голос не приходит со снимком (сервер скрывает его до вскрытия) — держим локально */
const myVote = ref<number | null>(null);
watch(
  () => room.round?.id,
  () => {
    myVote.value = null;
  },
);

async function onStartRound(): Promise<void> {
  starting.value = true;
  try {
    await room.startNewRound(selectedDeck.value);
  } catch {
    toast.add({ title: t('room.startRoundError'), color: 'error' });
  } finally {
    starting.value = false;
  }
}

async function onVote(value: number): Promise<void> {
  const previous = myVote.value;
  myVote.value = value;
  try {
    await room.submitVote(value);
  } catch {
    // Пока этот голос летел, могли успеть кликнуть другую карту — откатываем
    // только если выбор с тех пор не изменился, иначе затрём более новый голос
    if (myVote.value === value) myVote.value = previous;
    toast.add({ title: t('room.voteError'), color: 'error' });
  }
}

type Phase = 'loading' | 'notFound' | 'loadError' | 'naming' | 'joining' | 'joined' | 'joinError';

const phase = ref<Phase>('loading');
const roomInfo = ref<Room | null>(null);
const guestState = reactive({ name: readStoredGuestName() });
/** Имя, с которым гость реально вошёл (обрезанное) — отдельно от поля формы */
const joinedGuestName = ref('');

/**
 * Растёт при каждом `load()`/размонтировании: асинхронные продолжения (запрос
 * комнаты, вход по WS) сверяют его перед тем, как менять `phase`/`roomInfo`.
 * Без этого быстрый переход между комнатами мог бы показать одну комнату,
 * а подключиться при этом к другой — та проверка, что пришла последней,
 * побеждала бы независимо от того, к какой комнате она относится.
 */
let currentToken = 0;

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
  currentToken++;
  room.leave();
});

async function load(): Promise<void> {
  const token = ++currentToken;
  phase.value = 'loading';
  room.leave();
  let loadedRoom: Room;
  try {
    const res = await api.get<{ room: Room }>(`/api/rooms/${encodeURIComponent(props.id)}`);
    loadedRoom = res.room;
  } catch (err) {
    if (token !== currentToken) return; // уже перешли дальше — этот ответ не наш
    phase.value = err instanceof ApiError && err.status === 404 ? 'notFound' : 'loadError';
    return;
  }
  if (token !== currentToken) return;
  roomInfo.value = loadedRoom;

  if (session.isAuthenticated) {
    await joinAsSelf();
  } else {
    phase.value = 'naming';
  }
}

async function joinAsSelf(): Promise<void> {
  const token = currentToken;
  phase.value = 'joining';
  try {
    await room.join(props.id);
    if (token !== currentToken) return;
    phase.value = 'joined';
  } catch {
    if (token !== currentToken) return;
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
  const token = currentToken;
  const name = event.data.name.trim();
  storeGuestName(name);
  joinedGuestName.value = name;
  phase.value = 'joining';
  try {
    await room.join(props.id, name);
    if (token !== currentToken) return;
    phase.value = 'joined';
  } catch {
    if (token !== currentToken) return;
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
          {{ t('room.joinedAs', { name: session.user?.name ?? joinedGuestName }) }}
          <UBadge :color="room.isScrumMaster ? 'primary' : 'neutral'" variant="subtle" class="ml-2">
            {{ room.isScrumMaster ? t('room.roleScrumMaster') : t('room.roleVoter') }}
          </UBadge>
          <UBadge :color="room.connected ? 'success' : 'error'" variant="subtle" class="ml-2">
            {{ room.connected ? t('room.connected') : t('room.disconnected') }}
          </UBadge>
        </p>

        <UCard>
          <template #header>
            <h2 class="font-medium">{{ t('room.participantsTitle') }}</h2>
          </template>

          <p v-if="!room.round" class="text-muted mb-3 text-sm">{{ t('room.noRoundYet') }}</p>

          <ul class="divide-default divide-y">
            <li
              v-for="p in room.participants"
              :key="p.participantId"
              class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <UAvatar :src="p.avatarUrl ?? undefined" :alt="p.name" size="sm" />
              <span class="min-w-0 flex-1 truncate">
                {{ p.name }}
                <span v-if="p.participantId === room.participantId" class="text-muted text-xs">
                  {{ t('room.you') }}
                </span>
              </span>
              <UBadge v-if="p.isGuest" color="neutral" variant="subtle">
                {{ t('room.guestBadge') }}
              </UBadge>
              <UBadge :color="p.role === 'scrum_master' ? 'primary' : 'neutral'" variant="subtle">
                {{ p.role === 'scrum_master' ? t('room.roleScrumMaster') : t('room.roleVoter') }}
              </UBadge>
              <UBadge
                v-if="room.round"
                :color="p.hasVoted ? 'success' : 'neutral'"
                variant="subtle"
              >
                {{ p.hasVoted ? t('room.voted') : t('room.notVoted') }}
              </UBadge>
            </li>
          </ul>
        </UCard>

        <UCard v-if="room.isScrumMaster && !room.round">
          <template #header>
            <h2 class="font-medium">{{ t('room.startRoundTitle') }}</h2>
          </template>
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <URadioGroup v-model="selectedDeck" :items="deckOptions" orientation="horizontal" />
            <UButton :loading="starting" @click="onStartRound">
              {{ starting ? t('room.starting') : t('room.startRound') }}
            </UButton>
          </div>
        </UCard>

        <UCard v-if="room.round">
          <template #header>
            <h2 class="font-medium">{{ t('room.votingTitle') }}</h2>
          </template>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="card in deckCards"
              :key="card"
              :color="myVote === card ? 'primary' : 'neutral'"
              :variant="myVote === card ? 'solid' : 'outline'"
              @click="onVote(card)"
            >
              {{ card }}
            </UButton>
          </div>
        </UCard>

        <!-- Вскрытие карт и правка ссылок Jira/Confluence — Epic 5 -->
      </template>
    </template>
  </section>
</template>
