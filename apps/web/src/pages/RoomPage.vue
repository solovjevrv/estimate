<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  DECK_CARDS,
  GUEST_NAME_MAX_LENGTH,
  type DeckType,
  type Room,
  tshirtLabel,
} from '@poker/shared';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import DeckBar from '../components/room/DeckBar.vue';
import ParticipantCard from '../components/room/ParticipantCard.vue';
import RoomTimerCard from '../components/room/RoomTimerCard.vue';
import RoomTopBar from '../components/room/RoomTopBar.vue';
import RoundResultPanel from '../components/room/RoundResultPanel.vue';
import { ApiError, api } from '../lib/api';
import { useRoomStore } from '../stores/room';
import { useRoomsStore } from '../stores/rooms';
import { useSessionStore } from '../stores/session';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();
const room = useRoomStore();
const roomsStore = useRoomsStore();

const isArchived = computed(() => room.room?.archivedAt != null);
const archiveOpen = ref(false);
const archiving = ref(false);

async function copyInviteLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast.add({ title: t('room.linkCopied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('room.linkCopyError'), color: 'error' });
  }
}

async function onArchive(): Promise<void> {
  archiving.value = true;
  try {
    const archivedRoom = await roomsStore.archive(props.id);
    const current = room.state;
    if (current) {
      room.applyState({ ...current, room: archivedRoom });
    }
    archiveOpen.value = false;
    toast.add({ title: t('room.archivedToast'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('room.archiveError'), color: 'error' });
  } finally {
    archiving.value = false;
  }
}

/**
 * Таймером управляет любой участник (решение 27.07.2026) — прав здесь не
 * проверяем, сервер тоже их не проверяет. Актуальное состояние приходит
 * рассылкой `room_state`, поэтому здесь только флаг «идёт запрос».
 */
const timerPending = ref(false);

async function onTimerStart(): Promise<void> {
  timerPending.value = true;
  try {
    await room.startTimer();
  } catch {
    toast.add({ title: t('room.timerError'), color: 'error' });
  } finally {
    timerPending.value = false;
  }
}

async function onTimerPause(): Promise<void> {
  timerPending.value = true;
  try {
    await room.pauseTimer();
  } catch {
    toast.add({ title: t('room.timerError'), color: 'error' });
  } finally {
    timerPending.value = false;
  }
}

async function onTimerReset(durationSec: number): Promise<void> {
  timerPending.value = true;
  try {
    await room.resetTimer(durationSec);
  } catch {
    toast.add({ title: t('room.timerError'), color: 'error' });
  } finally {
    timerPending.value = false;
  }
}

const deckOptions = computed<Array<{ label: string; value: DeckType }>>(() => [
  { label: t('room.deckFibonacci'), value: 'fibonacci' },
  { label: t('room.deckScale05'), value: 'scale_0_5' },
  { label: t('room.deckTshirt'), value: 'tshirt' },
]);
const selectedDeck = ref<DeckType>('fibonacci');
const starting = ref(false);
const revealing = ref(false);

const deckCards = computed<readonly number[]>(
  () => DECK_CARDS[room.round?.deckType ?? 'fibonacci'],
);
/** Для футболочных размеров подписью карты служит буквенный размер, а не число */
function cardLabel(value: number): string {
  return room.round?.deckType === 'tshirt' ? tshirtLabel(value) : String(value);
}
/** Свой голос не приходит со снимком (сервер скрывает его до вскрытия) — держим локально */
const myVote = ref<number | null>(null);
watch(
  () => room.round?.id,
  () => {
    myVote.value = null;
  },
);

type RoundPhase = 'none' | 'voting' | 'revealed';
const roundPhase = computed<RoundPhase>(() => room.round?.status ?? 'none');

const votedCount = computed(() => room.participants.filter((p) => p.hasVoted).length);
const totalCount = computed(() => room.participants.length);
const allVoted = computed(() => totalCount.value > 0 && votedCount.value === totalCount.value);

const waitingForText = computed<string | null>(() => {
  const names = room.participants.filter((p) => !p.hasVoted).map((p) => p.name);
  if (names.length === 0) return null;
  return t('room.waitingFor', { names: names.join(', ') });
});

const votesByParticipant = computed<Map<string, number>>(
  () => new Map((room.result?.votes ?? []).map((v) => [v.participantId, v.value])),
);

/**
 * Значение-мода среди оценок раунда — победитель для панели результатов и
 * подсветки карточек. При ничьей чёткого победителя нет — никого не подсвечиваем.
 */
const winnerValue = computed<number | null>(() => {
  const counts = new Map<number, number>();
  for (const value of votesByParticipant.value.values()) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  return tie ? null : best;
});
const winnerLabel = computed(() =>
  winnerValue.value === null ? null : cardLabel(winnerValue.value),
);

const resultVotes = computed(() =>
  (room.result?.votes ?? []).map((v) => ({
    participantId: v.participantId,
    name: v.name,
    valueLabel: cardLabel(v.value),
  })),
);

function revealedValueLabel(participantId: string): string | null {
  if (roundPhase.value !== 'revealed') return null;
  const value = votesByParticipant.value.get(participantId);
  return value === undefined ? null : cardLabel(value);
}

function isWinnerParticipant(participantId: string): boolean {
  return (
    roundPhase.value === 'revealed' &&
    winnerValue.value !== null &&
    votesByParticipant.value.get(participantId) === winnerValue.value
  );
}

const deckCardButtonLabel = computed(() => {
  if (roundPhase.value === 'voting') return t('room.cancelRound');
  if (roundPhase.value === 'revealed') return t('room.newRound');
  return t('room.startRound');
});

const cancelConfirmOpen = ref(false);
const revealConfirmOpen = ref(false);

/** Смена раунда переиспользует один и тот же WS-запрос — сервер и отменяет текущий, и начинает следующий */
async function onStartRound(options?: { silentRestart?: boolean }): Promise<void> {
  starting.value = true;
  try {
    await room.startNewRound(selectedDeck.value);
    cancelConfirmOpen.value = false;
    // Без голосов раунд перезапускается без вопроса (см. onDeckActionClick) — новый раунд
    // визуально неотличим от старого, поэтому без тоста клик выглядит так, будто ничего не произошло
    if (options?.silentRestart) {
      toast.add({ title: t('room.roundRestarted'), color: 'success', icon: 'i-lucide-refresh-cw' });
    }
  } catch {
    toast.add({ title: t('room.startRoundError'), color: 'error' });
  } finally {
    starting.value = false;
  }
}

/** Раунд ещё не начат или уже вскрыт — терять нечего, спрашивать не о чем */
function onDeckActionClick(): void {
  if (roundPhase.value === 'voting') {
    if (votedCount.value > 0) {
      cancelConfirmOpen.value = true;
    } else {
      void onStartRound({ silentRestart: true });
    }
  } else {
    void onStartRound();
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

async function onReveal(): Promise<void> {
  revealing.value = true;
  try {
    await room.revealCards();
    revealConfirmOpen.value = false;
  } catch {
    toast.add({ title: t('room.revealError'), color: 'error' });
  } finally {
    revealing.value = false;
  }
}

/** Если проголосовали все — вскрываем сразу, иначе сперва спрашиваем подтверждение */
function onRevealClick(): void {
  if (allVoted.value) {
    void onReveal();
  } else {
    revealConfirmOpen.value = true;
  }
}

const linksForm = reactive({ jiraUrl: '', confluenceUrl: '' });
/** Есть несохранённая правка — рассылка с сервера не должна её затереть */
const linksDirty = ref(false);
/**
 * Версия, на которой основан черновик. Пока он не сохранён, рассылки могут
 * подвинуть версию в сторе вперёд — если бы сохранение брало версию оттуда,
 * а не отсюда, оно бы прошло поверх чужой правки, не заметив её.
 */
const linksBaseVersion = ref<number | null>(null);
const savingLinks = ref(false);

watch(
  () => room.room,
  (current) => {
    if (!current || linksDirty.value) return;
    linksForm.jiraUrl = current.jiraUrl ?? '';
    linksForm.confluenceUrl = current.confluenceUrl ?? '';
    linksBaseVersion.value = current.linksVersion;
  },
  { immediate: true },
);

function validateLinks(state: { jiraUrl: string; confluenceUrl: string }): FormError[] {
  const errors: FormError[] = [];
  if (state.jiraUrl.trim() && !/^https?:\/\//i.test(state.jiraUrl.trim())) {
    errors.push({ name: 'jiraUrl', message: t('room.linksInvalid') });
  }
  if (state.confluenceUrl.trim() && !/^https?:\/\//i.test(state.confluenceUrl.trim())) {
    errors.push({ name: 'confluenceUrl', message: t('room.linksInvalid') });
  }
  return errors;
}

async function onSaveLinks(
  event: FormSubmitEvent<{ jiraUrl: string; confluenceUrl: string }>,
): Promise<void> {
  savingLinks.value = true;
  try {
    await room.updateLinks({
      jiraUrl: event.data.jiraUrl.trim(),
      confluenceUrl: event.data.confluenceUrl.trim(),
      version: linksBaseVersion.value,
    });
    linksDirty.value = false;
  } catch {
    toast.add({ title: t('room.linksError'), color: 'error' });
  } finally {
    savingLinks.value = false;
  }
}

type Phase = 'loading' | 'notFound' | 'loadError' | 'naming' | 'joining' | 'joined' | 'joinError';

const phase = ref<Phase>('loading');
const roomInfo = ref<Room | null>(null);
const guestState = reactive({ name: readStoredGuestName() });

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

    <div v-else-if="phase === 'loading'" class="space-y-6">
      <USkeleton class="h-9 w-1/3 bg-[var(--brand-border)]" />
      <div class="surface-card surface-card-lg space-y-4 px-[30px] py-[26px]">
        <USkeleton class="h-5 w-1/4 bg-[var(--brand-border)]" />
        <USkeleton class="h-11 w-full rounded-[11px] bg-[var(--brand-border)]" />
      </div>
    </div>

    <template v-else-if="roomInfo">
      <h1 v-if="phase !== 'joined'" class="font-heading text-3xl font-extrabold">
        {{ roomInfo.name }}
      </h1>

      <div
        v-if="phase === 'naming'"
        class="surface-card surface-card-lg max-w-sm px-[30px] py-[26px]"
      >
        <h2 class="mb-[18px] text-[17px] font-bold">{{ t('room.nameTitle') }}</h2>
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
              :ui="{
                base: 'rounded-[11px] border-[1.5px] border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 py-3 ring-0',
              }"
            />
          </UFormField>
          <UButton type="submit" block class="rounded-[11px] py-3 text-[15px] font-bold">
            {{ t('room.join') }}
          </UButton>
        </UForm>
      </div>

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
        <RoomTopBar
          :name="roomInfo.name"
          :archived="isArchived"
          :connected="room.connected"
          :can-archive="room.isScrumMaster && !isArchived"
          @archive="archiveOpen = true"
        />

        <UAlert
          v-if="isArchived"
          color="warning"
          variant="subtle"
          :description="t('room.archivedAlert')"
        />

        <div v-if="!isArchived" class="flex flex-col gap-5 lg:flex-row lg:items-stretch">
          <div
            v-if="room.isScrumMaster"
            class="surface-card surface-card-lg min-w-0 flex-[1.4] px-[30px] py-[26px]"
          >
            <div class="text-muted mb-[18px] text-sm font-bold tracking-[0.03em] uppercase">
              {{ t('room.deckTitle') }}
            </div>
            <div
              class="mb-[22px] inline-flex gap-1 rounded-[12px] p-1"
              style="background-color: var(--brand-well-bg)"
            >
              <button
                v-for="option in deckOptions"
                :key="option.value"
                type="button"
                class="rounded-[9px] px-4 py-[9px] text-sm font-bold whitespace-nowrap transition-colors"
                :class="
                  selectedDeck === option.value
                    ? 'bg-[var(--brand-surface)] text-[var(--brand-primary-text)] shadow-[0_1px_3px_rgba(0,0,0,0.15)]'
                    : 'text-muted cursor-pointer'
                "
                @click="selectedDeck = option.value"
              >
                {{ option.label }}
              </button>
            </div>
            <div>
              <UButton
                color="neutral"
                variant="outline"
                class="rounded-[11px] px-[22px] py-3 text-[14.5px] font-bold"
                :loading="starting"
                @click="onDeckActionClick"
              >
                {{ starting ? t('room.starting') : deckCardButtonLabel }}
              </UButton>
            </div>
          </div>

          <RoomTimerCard
            class="min-w-0 flex-1"
            :timer="room.timer"
            :pending="timerPending"
            @start="onTimerStart"
            @pause="onTimerPause"
            @reset="onTimerReset"
          />
        </div>

        <div v-if="!isArchived" class="surface-card surface-card-lg px-[30px] py-[26px]">
          <h2 class="text-muted mb-[18px] text-sm font-bold tracking-[0.03em] uppercase">
            {{ t('room.linksTitle') }}
          </h2>
          <UForm
            :state="linksForm"
            :validate="validateLinks"
            class="flex flex-col gap-4 sm:flex-row sm:items-end"
            @submit="onSaveLinks"
          >
            <UFormField
              :label="t('room.linksJira')"
              name="jiraUrl"
              class="flex-1"
              :ui="{ label: 'text-sm font-bold mb-2' }"
            >
              <UInput
                v-model="linksForm.jiraUrl"
                icon="i-lucide-link"
                :placeholder="t('room.linksJiraPlaceholder')"
                class="w-full"
                :ui="{
                  base: 'rounded-[11px] border-[1.5px] border-[var(--brand-border)] bg-[var(--brand-surface)] py-[13px] pe-4 ring-0',
                }"
                @update:model-value="linksDirty = true"
              />
            </UFormField>
            <UFormField
              :label="t('room.linksConfluence')"
              name="confluenceUrl"
              class="flex-1"
              :ui="{ label: 'text-sm font-bold mb-2' }"
            >
              <UInput
                v-model="linksForm.confluenceUrl"
                icon="i-lucide-link"
                :placeholder="t('room.linksConfluencePlaceholder')"
                class="w-full"
                :ui="{
                  base: 'rounded-[11px] border-[1.5px] border-[var(--brand-border)] bg-[var(--brand-surface)] py-[13px] pe-4 ring-0',
                }"
                @update:model-value="linksDirty = true"
              />
            </UFormField>
            <UButton
              type="submit"
              class="rounded-[11px] px-6 py-[13px] text-[14.5px] font-bold"
              :loading="savingLinks"
            >
              {{ savingLinks ? t('room.linksSaving') : t('room.linksSave') }}
            </UButton>
          </UForm>
        </div>

        <div v-if="room.result" class="surface-card surface-card-lg px-[30px] py-[26px]">
          <RoundResultPanel
            :average="room.result.average"
            :min-label="cardLabel(room.result.min)"
            :max-label="cardLabel(room.result.max)"
            :agreement="room.result.agreement"
            :winner-label="winnerLabel"
            :votes="resultVotes"
          />
        </div>

        <div class="surface-card surface-card-lg px-[30px] py-[26px]">
          <div class="mb-6 flex items-center justify-between gap-3">
            <h2
              class="text-muted flex items-center gap-2 text-sm font-bold tracking-[0.03em] uppercase"
            >
              <UIcon name="i-lucide-users" class="size-4" />
              {{ t('room.participantsTitle') }}
            </h2>
            <UButton
              icon="i-lucide-user-plus"
              color="neutral"
              variant="outline"
              class="rounded-[10px] px-4 py-[9px] text-[13.5px] font-bold"
              @click="copyInviteLink"
            >
              {{ t('room.invite') }}
            </UButton>
          </div>

          <p v-if="!room.round" class="text-muted mb-3 text-sm">{{ t('room.noRoundYet') }}</p>

          <!-- pt-5 резервирует место под аватар-бейдж участника, который своим -top-5
               выходит за пределы карточки — без отступа он наезжает на текст/контент выше -->
          <div class="flex flex-wrap gap-[22px] pt-5">
            <ParticipantCard
              v-for="p in room.participants"
              :key="p.participantId"
              :participant="p"
              :is-self="p.participantId === room.participantId"
              :round-status="roundPhase"
              :value-label="revealedValueLabel(p.participantId)"
              :is-winner="isWinnerParticipant(p.participantId)"
            />
          </div>
        </div>

        <DeckBar
          v-if="room.round && room.round.status === 'voting' && !isArchived"
          :title="t('room.votingTitle')"
          :voted-count-text="t('room.votedCount', { voted: votedCount, total: totalCount })"
          :cards="deckCards"
          :card-label="cardLabel"
          :selected-value="myVote"
          :is-scrum-master="room.isScrumMaster"
          :revealing="revealing"
          :reveal-label="revealing ? t('room.revealing') : t('room.reveal')"
          :waiting-for-text="waitingForText"
          @vote="onVote"
          @reveal="onRevealClick"
        />
      </template>
    </template>

    <UModal
      v-model:open="archiveOpen"
      :title="t('room.archiveConfirmTitle')"
      :description="t('room.archiveConfirmText')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="archiving" @click="onArchive">
          {{ t('room.archiveConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="cancelConfirmOpen"
      :title="t('room.cancelRoundConfirmTitle')"
      :description="t('room.cancelRoundConfirmText')"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="error" :loading="starting" @click="onStartRound()">
          {{ t('room.cancelRoundConfirm') }}
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="revealConfirmOpen"
      :title="t('room.revealConfirmTitle')"
      :description="t('room.revealConfirmText', { voted: votedCount, total: totalCount })"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">{{ t('teams.cancel') }}</UButton>
        <UButton color="primary" :loading="revealing" @click="onReveal">
          {{ t('room.revealConfirmButton') }}
        </UButton>
      </template>
    </UModal>
  </section>
</template>
