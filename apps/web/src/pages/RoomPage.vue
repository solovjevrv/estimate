<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  GUEST_NAME_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  trimText,
  type DeckType,
  type Room,
} from '@estimate/shared';
import { onBeforeUnmount, reactive, ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';

import ConfirmModal from '../components/ConfirmModal.vue';
import EntityTextModal from '../components/EntityTextModal.vue';
import DeckBar from '../components/room/DeckBar.vue';
import ParticipantCard from '../components/room/ParticipantCard.vue';
import RoomTimerCard from '../components/room/RoomTimerCard.vue';
import RoomTopBar from '../components/room/RoomTopBar.vue';
import RoundResultPanel from '../components/room/RoundResultPanel.vue';
import { ApiError } from '../lib/api';
import { useGuestIdentity } from '../composables/use-guest-identity';
import { getRoom } from '../features/rooms/api/rooms-api';
import { useRoomAdminActions } from '../features/rooms/composables/use-room-admin-actions';
import { useRoomReactions } from '../features/rooms/composables/use-room-reactions';
import { useRoomTimer } from '../features/rooms/composables/use-room-timer';
import { useRoomVoting } from '../features/rooms/composables/use-room-voting';
import { useRoundHistory } from '../features/rooms/composables/use-round-history';
import { useRoomStore } from '../stores/room';
import { useSessionStore } from '../stores/session';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();
const room = useRoomStore();

const isArchived = computed(() => room.room?.archivedAt != null);

async function copyInviteLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast.add({ title: t('room.linkCopied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('room.linkCopyError'), color: 'error' });
  }
}

const {
  archiveOpen,
  archiving,
  onArchive,
  renameModal,
  renaming,
  onRename,
  kickTarget,
  kickConfirmOpen,
  kicking,
  onKickClick,
  onKickConfirm,
} = useRoomAdminActions({
  roomId: () => props.id,
  room,
  onRoomRenamed: (renamed) => {
    roomInfo.value = renamed;
  },
});

const { receivedReactionsFor, flyingReactionsFor, onReactClick } = useRoomReactions({ room });

const { timerPending, onTimerStart, onTimerPause, onTimerReset } = useRoomTimer({ room });

const {
  deckOptions,
  selectedDeck,
  deckCards,
  cardLabel,
  effectiveMyVote,
  roundPhase,
  waitingForText,
  winnerLabel,
  departedVotes,
  deckCardButtonLabel,
  cancelConfirmOpen,
  revealConfirmOpen,
  pendingDeckChange,
  starting,
  revealing,
  onStartRound,
  onDeckActionClick,
  onDeckOptionClick,
  onVote,
  onRevealClick,
  onReveal,
  revealedValueLabel,
  isWinnerParticipant,
} = useRoomVoting({ room });

function onDeckSelectChange(value: unknown): void {
  onDeckOptionClick(value as DeckType);
}

const participantsSubtitle = computed(() => {
  if (roundPhase.value === 'voting') return t('room.participantsVoting');
  if (roundPhase.value === 'revealed') return t('room.participantsRevealed');
  return t('room.participantsNoRound');
});

const {
  historyEntries,
  historyLoading,
  historyFailed,
  historyVotesText,
  historyResultLabel,
  reset: resetHistory,
} = useRoundHistory({ roomId: () => props.id, room });

/** Скрам-мастер исключил именно этого участника — экран стола сменяем на отдельный, как при joinError */
watch(
  () => room.kickedOut,
  (kicked) => {
    if (kicked) {
      phase.value = 'kicked';
      toast.add({ title: t('room.kickedNotice'), color: 'warning' });
    }
  },
);

type Phase =
  'loading' | 'notFound' | 'loadError' | 'naming' | 'joining' | 'joined' | 'joinError' | 'kicked';

const phase = ref<Phase>('loading');
const roomInfo = ref<Room | null>(null);
const guestIdentity = useGuestIdentity('room');
const guestState = reactive({ name: guestIdentity.name.value });

/**
 * Растёт при каждом `load()`/размонтировании: асинхронные продолжения (запрос
 * комнаты, вход по WS) сверяют его перед тем, как менять `phase`/`roomInfo`.
 * Без этого быстрый переход между комнатами мог бы показать одну комнату,
 * а подключиться при этом к другой — та проверка, что пришла последней,
 * побеждала бы независимо от того, к какой комнате она относится.
 */
let currentToken = 0;

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
    loadedRoom = await getRoom(props.id);
  } catch (err) {
    if (token !== currentToken) return; // уже перешли дальше — этот ответ не наш
    phase.value = err instanceof ApiError && err.status === 404 ? 'notFound' : 'loadError';
    return;
  }
  if (token !== currentToken) return;
  roomInfo.value = loadedRoom;
  resetHistory();

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
    await room.join(props.id, undefined, () => {
      if (token !== currentToken) return;
      void recoverAuthenticatedJoin();
    });
    if (token !== currentToken) return;
    phase.value = 'joined';
  } catch {
    if (token !== currentToken) return;
    phase.value = 'joinError';
  }
}

/**
 * Сокет мог переподключиться (сон ноутбука, обрыв сети, а с 7.7 — и штатное
 * истечение access-токена раз в 15 минут) уже после того, как протух
 * access-токен, — сервер на хэндшейке видит гостя без имени, и вход
 * отклоняется. Вместо повтора того же запроса по кругу сверяемся с сервером,
 * жива ли сессия на самом деле: `session.load()` попутно один раз попробует
 * продлить её (см. `lib/api.ts`). Если сессия и правда закончилась — не
 * долбим сервер тем же запросом, а даём войти гостем (7.16).
 *
 * `phase` намеренно не трогаем, пока не станет ясен исход: с 7.7 этот путь
 * срабатывает на каждое штатное истечение токена, а не только в редких
 * сбоях сети, — переключение на экран «joining» и обратно каждые 15 минут
 * было бы заметным миганием стола для всех участников разом.
 */
async function recoverAuthenticatedJoin(): Promise<void> {
  const token = currentToken;
  await session.load();
  if (token !== currentToken) return;

  if (session.isAuthenticated) {
    // Место за столом было привязано к сломанному соединению — нужен новый сокет,
    // чтобы хэндшейк на сервере перечитал куку заново. Стол на экране не сбрасываем.
    room.resetConnection();
    try {
      await room.join(props.id, undefined, () => {
        if (token !== currentToken) return;
        void recoverAuthenticatedJoin();
      });
      if (token !== currentToken) return;
      phase.value = 'joined';
    } catch {
      if (token !== currentToken) return;
      phase.value = 'joinError';
    }
    return;
  }

  phase.value = 'naming';
  toast.add({ title: t('room.sessionExpired'), color: 'warning' });
}

function validateName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = trimText(s.name);
  if (!name) {
    errors.push({ name: 'name', message: t('room.nameRequired') });
  } else if (name.length > GUEST_NAME_MAX_LENGTH) {
    errors.push({ name: 'name', message: t('room.nameTooLong', { max: GUEST_NAME_MAX_LENGTH }) });
  }
  return errors;
}

async function onJoinAsGuest(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  const token = currentToken;
  const name = trimText(event.data.name);
  guestIdentity.remember(name);
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

/** После сбоя входа гостю дают попробовать снова с тем же именем, вошедшему — сверяем сессию заново */
function retry(): void {
  if (session.isAuthenticated) {
    void recoverAuthenticatedJoin();
  } else {
    phase.value = 'naming';
  }
}
</script>

<template>
  <section class="space-y-6">
    <UAlert
      v-if="phase === 'notFound'"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="t('room.notFound')"
    />
    <UAlert
      v-else-if="phase === 'loadError'"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      orientation="horizontal"
      :description="t('room.loadError')"
      :actions="[
        {
          label: t('common.refresh'),
          color: 'error',
          variant: 'outline',
          size: 'sm',
          onClick: load,
        },
      ]"
    />

    <div v-else-if="phase === 'loading'" class="space-y-6">
      <USkeleton class="h-9 w-1/3" />
      <div class="surface-card surface-card-lg space-y-4 px-4 py-5 sm:px-8 sm:py-8">
        <USkeleton class="h-5 w-1/4" />
        <USkeleton class="h-11 w-full rounded-r10" />
      </div>
    </div>

    <template v-else-if="roomInfo">
      <h1 v-if="phase !== 'joined'" class="font-heading text-3xl font-extrabold">
        {{ roomInfo.name }}
      </h1>

      <div
        v-if="phase === 'naming'"
        class="surface-card surface-card-lg mx-auto flex max-w-[420px] flex-col items-center gap-6 p-10"
      >
        <h2 class="font-heading text-[32px] leading-[40px] font-bold tracking-[-0.96px]">
          {{ t('room.nameTitle') }}
        </h2>
        <UForm
          :state="guestState"
          :validate="validateName"
          class="flex w-full flex-col gap-6"
          @submit="onJoinAsGuest"
        >
          <UFormField :label="t('room.nameLabel')" name="name" :ui="{ label: 'text-sm font-bold' }">
            <UInput
              v-model="guestState.name"
              icon="i-lucide-user"
              :placeholder="t('room.namePlaceholder')"
              :maxlength="GUEST_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
              :ui="{ base: 'bg-surface-frame border-border-strong' }"
            />
          </UFormField>
          <UButton type="submit" block class="justify-center">{{ t('room.join') }}</UButton>
        </UForm>
      </div>

      <div v-else-if="phase === 'joining'" class="text-muted flex items-center gap-2">
        <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
        {{ t('room.joining') }}
      </div>

      <template v-else-if="phase === 'joinError'">
        <UAlert
          icon="i-lucide-circle-alert"
          color="error"
          variant="subtle"
          :description="t('room.joinError')"
        />
        <UButton
          color="neutral"
          variant="outline"
          class="mt-3 rounded-[10px] px-4 py-[9px] text-[13.5px] font-bold"
          @click="retry"
        >
          {{ t('room.retry') }}
        </UButton>
      </template>

      <template v-else-if="phase === 'kicked'">
        <!-- Не «Войти снова» — того же результата (исключения) можно добиться только
             уведя человека из этой комнаты, повторный вход сюда же ни к чему не приведёт -->
        <UAlert
          icon="i-lucide-circle-alert"
          color="warning"
          variant="subtle"
          orientation="horizontal"
          :description="t('room.kickedMessage')"
          :actions="[
            {
              label: t('room.toRooms'),
              color: 'warning',
              variant: 'outline',
              size: 'sm',
              to: { name: 'my-rooms' },
            },
          ]"
        />
      </template>

      <template v-else-if="phase === 'joined'">
        <RoomTopBar
          :name="roomInfo.name"
          :team-id="roomInfo.teamId"
          :archived="isArchived"
          :connected="room.connected"
          :can-archive="room.isScrumMaster && !isArchived"
          :can-rename="room.isScrumMaster"
          @archive="archiveOpen = true"
          @rename="renameModal.show"
        />

        <UAlert
          v-if="!room.connected"
          icon="i-lucide-circle-alert"
          color="warning"
          variant="subtle"
          :title="t('room.disconnectedTitle')"
          :description="t('room.disconnectedDescription')"
        />

        <UAlert
          v-if="isArchived"
          icon="i-lucide-circle-alert"
          color="warning"
          variant="subtle"
          :title="t('room.archivedAlertTitle')"
          :description="t('room.archivedAlert')"
        />

        <div v-if="!isArchived" class="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div
            v-if="room.isScrumMaster"
            class="surface-card surface-card-lg min-w-0 px-4 py-5 sm:px-8 sm:py-8 lg:col-span-7"
          >
            <h2 class="font-heading text-text-secondary mb-5 text-xl font-bold tracking-[-0.4px]">
              {{ t('room.deckTitle') }}
            </h2>
            <div class="flex flex-col gap-3 sm:flex-row">
              <USelect
                :model-value="selectedDeck"
                :items="deckOptions"
                value-key="value"
                class="w-full sm:min-w-0 sm:flex-1"
                @update:model-value="onDeckSelectChange"
              />
              <UButton
                :color="roundPhase === 'voting' ? 'neutral' : 'primary'"
                :variant="roundPhase === 'voting' ? 'outline' : 'solid'"
                class="w-full justify-center sm:w-auto"
                :loading="starting"
                @click="onDeckActionClick"
              >
                {{ starting ? t('room.starting') : deckCardButtonLabel }}
              </UButton>
            </div>
          </div>

          <RoomTimerCard
            class="min-w-0 lg:col-span-5"
            :timer="room.timer"
            :pending="timerPending"
            @start="onTimerStart"
            @pause="onTimerPause"
            @reset="onTimerReset"
          />

          <!-- У участника нет панели управления колодой: таймер и статистика делят
               одну 12-колоночную строку 5/7, без пустых семи колонок слева. -->
          <div
            v-if="room.result && !room.isScrumMaster"
            class="surface-card surface-card-lg min-w-0 px-4 py-5 sm:px-8 sm:py-8 lg:col-span-7"
          >
            <RoundResultPanel
              :average="room.result.average"
              :min-label="cardLabel(room.result.min)"
              :max-label="cardLabel(room.result.max)"
              :agreement="room.result.agreement"
              :winner-label="winnerLabel"
              :departed-votes="departedVotes"
            />
          </div>
        </div>

        <div
          v-if="room.result && (room.isScrumMaster || isArchived)"
          class="surface-card surface-card-lg px-4 py-5 sm:px-8 sm:py-8"
        >
          <RoundResultPanel
            :average="room.result.average"
            :min-label="cardLabel(room.result.min)"
            :max-label="cardLabel(room.result.max)"
            :agreement="room.result.agreement"
            :winner-label="winnerLabel"
            :departed-votes="departedVotes"
          />
        </div>

        <div
          class="surface-card surface-card-lg flex flex-col gap-4 px-4 py-5 sm:px-8 sm:py-8 lg:min-h-[375px]"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="font-heading text-text-secondary text-xl font-bold tracking-[-0.4px]">
                {{ t('room.participantsTitle') }}
              </h2>
              <p class="text-text-secondary mt-1 text-sm font-medium">{{ participantsSubtitle }}</p>
            </div>
            <UButton
              icon="i-lucide-user-plus"
              color="neutral"
              variant="outline"
              class="shrink-0"
              @click="copyInviteLink"
            >
              {{ t('room.invite') }}
            </UButton>
          </div>

          <!-- pt-5 резервирует место под аватар-бейдж участника, который своим -top-5
               выходит за пределы карточки — без отступа он наезжает на текст/контент выше -->
          <div class="flex flex-wrap justify-center gap-[22px] pt-5 sm:justify-start">
            <ParticipantCard
              v-for="(p, participantIndex) in room.participants"
              :key="p.participantId"
              :participant="p"
              :is-self="p.participantId === room.participantId"
              :round-status="roundPhase"
              :value-label="revealedValueLabel(p.participantId)"
              :is-winner="isWinnerParticipant(p.participantId)"
              :can-kick="room.isScrumMaster && p.participantId !== room.participantId"
              :received-reactions="receivedReactionsFor(p.participantId)"
              :flying-reactions="flyingReactionsFor(p.participantId)"
              :flip-index="participantIndex"
              @kick="onKickClick(p)"
              @react="onReactClick(p, $event)"
            />
          </div>
        </div>

        <DeckBar
          v-if="
            room.round &&
            (room.round.status === 'voting' || room.round.status === 'revealed') &&
            !isArchived
          "
          :title="t('room.estimatesTitle')"
          :subtitle="
            room.round.status === 'voting'
              ? t('room.estimatesSubtitleVoting')
              : t('room.estimatesSubtitleRevealed')
          "
          :cards="deckCards"
          :card-label="cardLabel"
          :selected-value="effectiveMyVote"
          :is-scrum-master="room.isScrumMaster"
          :revealed="room.round.status === 'revealed'"
          :revealing="revealing"
          :reveal-label="revealing ? t('room.revealing') : t('room.reveal')"
          :waiting-for-text="waitingForText"
          @vote="onVote"
          @reveal="onRevealClick"
        />

        <div class="surface-card surface-card-lg px-4 py-5 sm:px-8 sm:py-8">
          <h2 class="font-heading text-text-secondary mb-4 text-xl font-bold tracking-[-0.4px]">
            {{ t('room.historyTitle') }}
          </h2>

          <UAlert
            v-if="historyFailed"
            icon="i-lucide-circle-alert"
            color="error"
            variant="subtle"
            :description="t('room.historyLoadError')"
          />
          <div v-else-if="historyLoading && historyEntries.length === 0" class="space-y-3">
            <USkeleton class="h-12 w-full" />
            <USkeleton class="h-12 w-full" />
          </div>
          <p
            v-else-if="historyEntries.length === 0"
            class="text-text-secondary text-sm font-medium"
          >
            {{ t('room.historyEmpty') }}
          </p>
          <!-- RoundHistoryRow (54_RoundResult): разделитель над каждой строкой, 18px по
               вертикали, «Раунд N» — Body/Large/Bold, голоса — Body/Small/Medium tertiary -->
          <div v-else>
            <div
              v-for="entry in historyEntries"
              :key="entry.round.id"
              class="border-default flex flex-wrap items-center justify-between gap-3 border-t py-[18px]"
            >
              <div class="flex min-w-0 flex-col gap-0.5">
                <div class="text-text-primary text-base leading-6 font-bold tracking-[-0.01em]">
                  {{ t('room.historyRound', { seq: entry.round.seq }) }}
                </div>
                <div class="text-text-tertiary text-xs font-medium">
                  {{ t('room.historyVotes', { votes: historyVotesText(entry) }) }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-2.5">
                <span class="badge-pill badge-pill-neutral">
                  {{ t('room.historyAgreement', { percent: entry.result.agreement }) }}
                </span>
                <span class="badge-pill badge-pill-primary">{{ historyResultLabel(entry) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <ConfirmModal
      v-model:open="archiveOpen"
      :title="t('room.archiveConfirmTitle')"
      :description="t('room.archiveConfirmText')"
      :confirm-label="t('room.archiveConfirm')"
      :loading="archiving"
      @confirm="onArchive"
    />

    <EntityTextModal
      v-model:open="renameModal.open"
      :title="t('room.renameTitle')"
      :label="t('room.roomNameLabel')"
      :initial-value="roomInfo?.name ?? ''"
      :max-length="ROOM_NAME_MAX_LENGTH"
      :required-message="t('room.renameNameRequired')"
      :too-long-message="t('room.renameNameTooLong', { max: ROOM_NAME_MAX_LENGTH })"
      :cancel-label="t('common.cancel')"
      :submit-label="t('room.rename')"
      :pending="renaming"
      @submit="onRename"
    />

    <ConfirmModal
      v-model:open="cancelConfirmOpen"
      :title="t('room.cancelRoundConfirmTitle')"
      :description="t('room.cancelRoundConfirmText')"
      :confirm-label="t('room.cancelRoundConfirm')"
      :loading="starting"
      @confirm="onStartRound({ deckType: pendingDeckChange ?? undefined })"
    />

    <ConfirmModal
      v-model:open="revealConfirmOpen"
      :title="t('room.revealConfirmTitle')"
      :description="t('room.revealConfirmText')"
      :confirm-label="t('room.revealConfirmButton')"
      confirm-color="primary"
      :loading="revealing"
      @confirm="onReveal"
    />

    <ConfirmModal
      v-model:open="kickConfirmOpen"
      :title="t('room.kickConfirmTitle')"
      :description="t('room.kickConfirmText', { name: kickTarget?.name ?? '' })"
      :confirm-label="t('room.kickConfirmButton')"
      :loading="kicking"
      @confirm="onKickConfirm"
    />
  </section>
</template>
