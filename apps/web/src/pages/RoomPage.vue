<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';
import { useToast } from '@nuxt/ui/composables';
import {
  DECK_CARDS,
  GUEST_NAME_MAX_LENGTH,
  isHttpUrl,
  ROOM_NAME_MAX_LENGTH,
  trimText,
  type DeckType,
  type Participant,
  type Reaction,
  type ReactionEmoji,
  type Room,
  type Round,
  type RoundHistoryEntry,
  tshirtLabel,
} from '@poker/shared';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ConfirmModal from '../components/ConfirmModal.vue';
import DeckBar from '../components/room/DeckBar.vue';
import ParticipantCard from '../components/room/ParticipantCard.vue';
import type { FlyingReaction, ReceivedReaction } from '../components/room/ParticipantCardBody.vue';
import RoomTimerCard from '../components/room/RoomTimerCard.vue';
import RoomTopBar from '../components/room/RoomTopBar.vue';
import RoundResultPanel from '../components/room/RoundResultPanel.vue';
import { ApiError } from '../lib/api';
import { MODAL_BUTTON_UI, MODAL_INPUT_UI, MODAL_UI } from '../lib/modal-ui';
import { useAsyncAction } from '../composables/use-async-action';
import { archiveRoom, getRoom, getRoundHistory, renameRoom } from '../features/rooms/api/rooms-api';
import { useRoomStore } from '../stores/room';
import { useSessionStore } from '../stores/session';

const props = defineProps<{ id: string }>();

const { t } = useI18n();
const toast = useToast();
const session = useSessionStore();
const room = useRoomStore();

const isArchived = computed(() => room.room?.archivedAt != null);
const archiveOpen = ref(false);

async function copyInviteLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast.add({ title: t('room.linkCopied'), color: 'success', icon: 'i-lucide-check' });
  } catch {
    toast.add({ title: t('room.linkCopyError'), color: 'error' });
  }
}

const { pending: archiving, execute: archive } = useAsyncAction({
  run: () => archiveRoom(props.id),
  success: (archivedRoom) => {
    const current = room.state;
    if (current) {
      room.applyState({ ...current, room: archivedRoom });
    }
    archiveOpen.value = false;
    toast.add({ title: t('room.archivedToast'), color: 'success', icon: 'i-lucide-check' });
  },
  error: () => {
    toast.add({ title: t('room.archiveError'), color: 'error' });
  },
});

async function onArchive(): Promise<void> {
  await archive();
}

// --- Переименование комнаты (7.20) ---
const renameOpen = ref(false);
const renameState = reactive({ name: '' });

// Открыли — подставляем текущее имя; закрыли — очищаем, чтобы не мигало старое
watch(renameOpen, (open) => {
  renameState.name = open ? (roomInfo.value?.name ?? '') : '';
});

function validateRoomName(s: { name: string }): FormError[] {
  const errors: FormError[] = [];
  const name = trimText(s.name);
  if (!name) {
    errors.push({ name: 'name', message: t('room.renameNameRequired') });
  } else if (name.length > ROOM_NAME_MAX_LENGTH) {
    errors.push({
      name: 'name',
      message: t('room.renameNameTooLong', { max: ROOM_NAME_MAX_LENGTH }),
    });
  }
  return errors;
}

const { pending: renaming, execute: rename } = useAsyncAction({
  run: (name: string) => renameRoom(props.id, name),
  success: (renamed) => {
    roomInfo.value = renamed;
    const current = room.state;
    if (current) {
      room.applyState({ ...current, room: renamed });
    }
    renameOpen.value = false;
    toast.add({ title: t('room.renamed'), color: 'success', icon: 'i-lucide-check' });
  },
  error: () => {
    toast.add({ title: t('room.renameError'), color: 'error' });
  },
});

async function onRename(event: FormSubmitEvent<{ name: string }>): Promise<void> {
  await rename(trimText(event.data.name));
}

// --- Исключение участника скрам-мастером (5.8) ---
const kickTarget = ref<Participant | null>(null);
const kickConfirmOpen = ref(false);

function onKickClick(participant: Participant): void {
  kickTarget.value = participant;
  kickConfirmOpen.value = true;
}

const { pending: kicking, execute: kick } = useAsyncAction<[Participant], void>({
  run: (target) => room.kickParticipant(target.participantId),
  success: (_, target) => {
    kickConfirmOpen.value = false;
    toast.add({
      title: t('room.kickedParticipantToast', { name: target.name }),
      color: 'success',
      icon: 'i-lucide-check',
    });
  },
  error: () => {
    toast.add({ title: t('room.kickError'), color: 'error' });
  },
});

async function onKickConfirm(): Promise<void> {
  const target = kickTarget.value;
  if (!target) return;
  await kick(target);
}

// --- Реакции-эмодзи на карточке участника (10.10) ---
/**
 * Одинаковые реакции разных участников схлопываются в одну со счётчиком (как
 * реакции на сообщение в Telegram) — иначе при десятке участников бейджи не
 * поместились бы под карточкой шириной 130px. Набор эмодзи фиксирован
 * (`REACTION_EMOJIS`), поэтому уникальных групп на карточке не больше его длины.
 */
function receivedReactionsFor(participantId: string): ReceivedReaction[] {
  const forParticipant = room.reactions.filter((r) => r.toParticipantId === participantId);
  const byEmoji = new Map<
    ReceivedReaction['emoji'],
    { fromNames: string[]; reactedByMe: boolean }
  >();
  for (const r of forParticipant) {
    const fromName =
      room.participants.find((p) => p.participantId === r.fromParticipantId)?.name ?? '';
    const group = byEmoji.get(r.emoji) ?? { fromNames: [], reactedByMe: false };
    group.fromNames.push(fromName);
    if (r.fromParticipantId === room.participantId) {
      group.reactedByMe = true;
    }
    byEmoji.set(r.emoji, group);
  }
  return Array.from(byEmoji.entries()).map(([emoji, { fromNames, reactedByMe }]) => ({
    emoji,
    count: fromNames.length,
    fromNames,
    reactedByMe,
  }));
}

async function onReactClick(participant: Participant, emoji: ReactionEmoji): Promise<void> {
  try {
    await room.sendReaction(participant.participantId, emoji);
  } catch {
    toast.add({ title: t('room.reactionError'), color: 'error' });
  }
}

/**
 * Одноразовая «вылетающая» анимация эмодзи над карточкой адресата (10.12, Meet-style) —
 * отдельно от постоянного бейджа-счётчика (10.10). `room.reactions` приходит только целиком
 * с рассылкой `room_state` (нет отдельного дискретного события), поэтому свежедобавленные
 * реакции ловим сравнением с предыдущим снимком списка.
 */
const flyingReactionsByParticipant = reactive<Record<string, FlyingReaction[]>>({});
let flyingReactionSeq = 0;

function flyingReactionsFor(participantId: string): FlyingReaction[] {
  return flyingReactionsByParticipant[participantId] ?? [];
}

// Первый вызов колбэка — это гидратация ответа на join_room (переход состояния из
// «ещё не подключились» в реальный снимок стола), а не новая реакция; её пропускаем,
// иначе при входе/перезагрузке страницы уже стоящие на карточках реакции «вылетали» бы
// все разом. Реконнект под этот случай не попадает — applyState() не сбрасывает state
// в null между обрывом и восстановлением связи, так что здесь останется настоящий diff.
let reactionsHydrated = false;

watch(
  () => room.reactions,
  (current, previous) => {
    if (!reactionsHydrated) {
      reactionsHydrated = true;
      return;
    }
    const prev = previous ?? [];
    const isSame = (a: Reaction, b: Reaction): boolean =>
      a.fromParticipantId === b.fromParticipantId &&
      a.toParticipantId === b.toParticipantId &&
      a.emoji === b.emoji;
    const added = current.filter((r) => !prev.some((p) => isSame(p, r)));
    for (const r of added) {
      const id = `${Date.now()}-${flyingReactionSeq++}`;
      const list = flyingReactionsByParticipant[r.toParticipantId] ?? [];
      flyingReactionsByParticipant[r.toParticipantId] = [...list, { id, emoji: r.emoji }];
      setTimeout(() => {
        flyingReactionsByParticipant[r.toParticipantId] = (
          flyingReactionsByParticipant[r.toParticipantId] ?? []
        ).filter((f) => f.id !== id);
      }, 1900);
    }
  },
);

/**
 * Таймером управляет любой участник (решение 27.07.2026) — прав здесь не
 * проверяем, сервер тоже их не проверяет. Актуальное состояние приходит
 * рассылкой `room_state`, поэтому здесь только флаг «идёт запрос».
 */
/**
 * Таймером управляет любой участник (решение 27.07.2026) — прав здесь не
 * проверяем, сервер тоже их не проверяет. Три команды (start/pause/reset)
 * разделяют один флаг «идёт запрос»: пока одна в полёте, остальные не уходят
 * на сервер (single-flight в useAsyncAction). Актуальное состояние приходит
 * рассылкой `room_state`, поэтому здесь только флаг «идёт запрос».
 */
const { pending: timerPending, execute: runTimerOperation } = useAsyncAction<
  [() => Promise<void>],
  void
>({
  run: (operation) => operation(),
  error: () => {
    toast.add({ title: t('room.timerError'), color: 'error' });
  },
});

async function onTimerStart(): Promise<void> {
  await runTimerOperation(() => room.startTimer());
}

async function onTimerPause(): Promise<void> {
  await runTimerOperation(() => room.pauseTimer());
}

async function onTimerReset(durationSec: number): Promise<void> {
  await runTimerOperation(() => room.resetTimer(durationSec));
}

const deckOptions = computed<Array<{ label: string; value: DeckType }>>(() => [
  { label: t('room.deckFibonacci'), value: 'fibonacci' },
  { label: t('room.deckScale05'), value: 'scale_0_5' },
  { label: t('room.deckTshirt'), value: 'tshirt' },
]);
const selectedDeck = ref<DeckType>('fibonacci');

/**
 * Пока раунд идёт (или уже вскрыт), «Шкала оценки» выбирает не заготовку для
 * следующего раунда, а фактическую колоду текущего — держим выбор в синхроне
 * с раундом, а не только с последним кликом, иначе после переподключения или
 * запуска раунда другим скрам-мастером подсветка показывала бы не ту колоду.
 */
watch(
  () => room.round?.deckType,
  (deckType) => {
    if (deckType) selectedDeck.value = deckType;
  },
  { immediate: true },
);

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

/**
 * Карточки участников показывают голос только тех, кто ещё в комнате — тот, кто
 * успел проголосовать и вышел до вскрытия, иначе пропал бы из результата совсем.
 */
const departedVotes = computed(() => {
  const presentIds = new Set(room.participants.map((p) => p.participantId));
  return (room.result?.votes ?? [])
    .filter((v) => !presentIds.has(v.participantId))
    .map((v) => ({ participantId: v.participantId, name: v.name, valueLabel: cardLabel(v.value) }));
});

// --- История раундов: открыта так же, как и сама комната, отдельным REST-запросом (5.7) ---
const historyEntries = ref<RoundHistoryEntry[]>([]);
const historyLoading = ref(false);
const historyFailed = ref(false);

/** Для футболочных размеров у голоса своя буквенная подпись — раунды истории могли идти разными колодами */
function historyCardLabel(value: number, deckType: DeckType): string {
  return deckType === 'tshirt' ? tshirtLabel(value) : String(value);
}

function historyVotesText(entry: RoundHistoryEntry): string {
  return [...entry.result.votes]
    .sort((a, b) => a.value - b.value)
    .map((vote) => historyCardLabel(vote.value, entry.round.deckType))
    .join(', ');
}

/** Среднее — для футболочных размеров его не считают, показываем самое частое значение */
function historyResultLabel(entry: RoundHistoryEntry): string {
  if (entry.round.average !== null) {
    return String(entry.round.average);
  }
  const counts = new Map<number, number>();
  for (const vote of entry.result.votes) {
    counts.set(vote.value, (counts.get(vote.value) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best === null ? '—' : historyCardLabel(best, entry.round.deckType);
}

async function loadHistory(): Promise<void> {
  const token = currentToken;
  const roomId = props.id;
  historyLoading.value = true;
  historyFailed.value = false;
  try {
    const rounds = await getRoundHistory(roomId);
    // Пока запрос летел, могли перейти в другую комнату — её историю не подменяем
    if (token !== currentToken) return;
    historyEntries.value = rounds;
  } catch {
    if (token !== currentToken) return;
    historyFailed.value = true;
  } finally {
    if (token === currentToken) historyLoading.value = false;
  }
}

// Раунд стал вскрытым — рассылка room_state доходит до всех за столом, поэтому
// историю обновляет каждый участник, а не только тот, кто нажал «Вскрыть карты»
watch(
  () => room.round?.status,
  (status) => {
    if (status === 'revealed') void loadHistory();
  },
);

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
/** Колода, выбранная кликом по «Шкале оценки» во время активного раунда — ждёт
 * подтверждения в cancelConfirmOpen, поэтому не пишем её сразу в selectedDeck
 * (иначе при отказе от подтверждения подсветка осталась бы на новой колоде,
 * хотя раунд по факту не поменялся). */
const pendingDeckChange = ref<DeckType | null>(null);

// Модалка отмены раунда переиспользуется и для смены шкалы — при любом её закрытии
// (подтвердили или отказались) отложенный выбор больше не нужен
watch(cancelConfirmOpen, (open) => {
  if (!open) pendingDeckChange.value = null;
});

/** Смена раунда переиспользует один и тот же WS-запрос — сервер и отменяет текущий, и начинает следующий */
const { pending: starting, execute: startRound } = useAsyncAction<
  [{ silentRestart?: boolean; deckType?: DeckType }],
  Round
>({
  run: (options) => room.startNewRound(options?.deckType ?? selectedDeck.value),
  success: (_, options) => {
    cancelConfirmOpen.value = false;
    // Без голосов раунд перезапускается без вопроса (см. onDeckActionClick) — новый раунд
    // визуально неотличим от старого, поэтому без тоста клик выглядит так, будто ничего не произошло
    if (options?.silentRestart) {
      toast.add({ title: t('room.roundRestarted'), color: 'success', icon: 'i-lucide-refresh-cw' });
    }
  },
  error: () => {
    toast.add({ title: t('room.startRoundError'), color: 'error' });
  },
});

async function onStartRound(options?: {
  silentRestart?: boolean;
  deckType?: DeckType;
}): Promise<void> {
  await startRound(options ?? {});
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

/**
 * Раньше клик по «Шкале оценки» во время раунда только менял локальный выбор
 * без следа на самом раунде — участник видел прежнюю колоду и не понимал,
 * что клик вообще что-то сделал. Теперь смена колоды при активном раунде
 * реально его перезапускает (тот же WS-запрос, что и «Отменить раунд»/«Новый
 * раунд»), с тем же правилом — спрашивать подтверждение только если есть,
 * что терять.
 */
function onDeckOptionClick(value: DeckType): void {
  if (roundPhase.value === 'none' || room.round?.deckType === value) {
    selectedDeck.value = value;
    return;
  }
  if (roundPhase.value === 'voting' && votedCount.value > 0) {
    pendingDeckChange.value = value;
    cancelConfirmOpen.value = true;
    return;
  }
  void onStartRound({ deckType: value, silentRestart: roundPhase.value === 'voting' });
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

const { pending: revealing, execute: reveal } = useAsyncAction({
  run: () => room.revealCards(),
  success: () => {
    revealConfirmOpen.value = false;
  },
  error: () => {
    toast.add({ title: t('room.revealError'), color: 'error' });
  },
});

async function onReveal(): Promise<void> {
  await reveal();
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

watch(
  () => room.room,
  (current, previous) => {
    // Переход в другую комнату без перезагрузки страницы (тот же компонент) не должен
    // протащить несохранённый черновик ссылок прежней комнаты в новую
    if (current?.id !== previous?.id) {
      linksDirty.value = false;
    }
    if (!current || linksDirty.value) return;
    linksForm.jiraUrl = current.jiraUrl ?? '';
    linksForm.confluenceUrl = current.confluenceUrl ?? '';
    linksBaseVersion.value = current.linksVersion;
  },
  { immediate: true },
);

function validateLinks(state: { jiraUrl: string; confluenceUrl: string }): FormError[] {
  const errors: FormError[] = [];
  if (trimText(state.jiraUrl) && !isHttpUrl(trimText(state.jiraUrl))) {
    errors.push({ name: 'jiraUrl', message: t('room.linksInvalid') });
  }
  if (trimText(state.confluenceUrl) && !isHttpUrl(trimText(state.confluenceUrl))) {
    errors.push({ name: 'confluenceUrl', message: t('room.linksInvalid') });
  }
  return errors;
}

const { pending: savingLinks, execute: saveLinks } = useAsyncAction({
  run: () =>
    room.updateLinks({
      jiraUrl: trimText(linksForm.jiraUrl),
      confluenceUrl: trimText(linksForm.confluenceUrl),
      version: linksBaseVersion.value,
    }),
  success: () => {
    linksDirty.value = false;
  },
  error: () => {
    toast.add({ title: t('room.linksError'), color: 'error' });
  },
});

async function onSaveLinks(): Promise<void> {
  await saveLinks();
}

type Phase =
  'loading' | 'notFound' | 'loadError' | 'naming' | 'joining' | 'joined' | 'joinError' | 'kicked';

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
    loadedRoom = await getRoom(props.id);
  } catch (err) {
    if (token !== currentToken) return; // уже перешли дальше — этот ответ не наш
    phase.value = err instanceof ApiError && err.status === 404 ? 'notFound' : 'loadError';
    return;
  }
  if (token !== currentToken) return;
  roomInfo.value = loadedRoom;
  historyEntries.value = [];
  void loadHistory();

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
      <div class="surface-card surface-card-lg space-y-4 px-4 py-5 sm:px-[30px] sm:py-[26px]">
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
        class="surface-card surface-card-lg max-w-sm px-4 py-5 sm:px-[30px] sm:py-[26px]"
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
        <UAlert color="warning" variant="subtle" :description="t('room.kickedMessage')" />
        <UButton
          color="neutral"
          variant="outline"
          class="mt-3 rounded-[10px] px-4 py-[9px] text-[13.5px] font-bold"
          @click="retry"
        >
          {{ t('room.rejoin') }}
        </UButton>
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
          @rename="renameOpen = true"
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
            class="surface-card surface-card-lg min-w-0 flex-[1.4] px-4 py-5 sm:px-[30px] sm:py-[26px]"
          >
            <div class="text-muted mb-[18px] text-sm font-bold tracking-[0.03em] uppercase">
              {{ t('room.deckTitle') }}
            </div>
            <div
              class="mb-[22px] grid grid-cols-1 gap-1 rounded-[12px] p-1 sm:inline-flex sm:flex-wrap"
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
                @click="onDeckOptionClick(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <div>
              <UButton
                color="neutral"
                variant="outline"
                class="w-full justify-center rounded-[11px] px-[22px] py-3 text-[14.5px] font-bold sm:w-auto"
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

        <div
          v-if="!isArchived"
          class="surface-card surface-card-lg px-4 py-5 sm:px-[30px] sm:py-[26px]"
        >
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
              class="justify-center rounded-[11px] px-6 py-[13px] text-[14.5px] font-bold"
              :loading="savingLinks"
            >
              {{ savingLinks ? t('room.linksSaving') : t('room.linksSave') }}
            </UButton>
          </UForm>
        </div>

        <div
          v-if="room.result"
          class="surface-card surface-card-lg px-4 py-5 sm:px-[30px] sm:py-[26px]"
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

        <div class="surface-card surface-card-lg px-4 py-5 sm:px-[30px] sm:py-[26px]">
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

        <div class="surface-card surface-card-lg px-4 py-5 sm:px-[30px] sm:py-[26px]">
          <h2 class="text-muted mb-[18px] text-sm font-bold tracking-[0.03em] uppercase">
            {{ t('room.historyTitle') }}
          </h2>

          <UAlert
            v-if="historyFailed"
            color="error"
            variant="subtle"
            :description="t('room.historyLoadError')"
          />
          <div v-else-if="historyLoading && historyEntries.length === 0" class="space-y-3">
            <USkeleton class="h-12 w-full bg-[var(--brand-border)]" />
            <USkeleton class="h-12 w-full bg-[var(--brand-border)]" />
          </div>
          <p v-else-if="historyEntries.length === 0" class="text-muted text-sm">
            {{ t('room.historyEmpty') }}
          </p>
          <div v-else class="-mx-4 sm:-mx-[30px]">
            <div
              v-for="entry in historyEntries"
              :key="entry.round.id"
              class="border-default flex flex-wrap items-center justify-between gap-3 border-t px-4 py-[18px] first:border-t-0 sm:px-[30px]"
            >
              <div class="min-w-0">
                <div class="text-[15px] font-bold">
                  {{ t('room.historyRound', { seq: entry.round.seq }) }}
                </div>
                <div class="text-muted text-sm">
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

    <UModal v-model:open="renameOpen" :title="t('room.renameTitle')" :ui="MODAL_UI">
      <template #body>
        <UForm
          :state="renameState"
          :validate="validateRoomName"
          class="space-y-4"
          @submit="onRename"
        >
          <UFormField :label="t('room.roomNameLabel')" name="name">
            <UInput
              v-model="renameState.name"
              :maxlength="ROOM_NAME_MAX_LENGTH"
              autofocus
              class="w-full"
              :ui="MODAL_INPUT_UI"
            />
          </UFormField>
          <div class="flex justify-end gap-2.5">
            <UButton
              color="neutral"
              variant="outline"
              :ui="MODAL_BUTTON_UI"
              @click="renameOpen = false"
            >
              {{ t('teams.cancel') }}
            </UButton>
            <UButton type="submit" :ui="MODAL_BUTTON_UI" :loading="renaming">
              {{ t('room.rename') }}
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>

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
      :description="t('room.revealConfirmText', { voted: votedCount, total: totalCount })"
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
