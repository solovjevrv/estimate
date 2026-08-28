/** Колода, раунд, голосование, вскрытие карт и подсветка результата — ядро стола */
import { useToast } from '@nuxt/ui/composables';
import { DECK_CARDS, tshirtLabel, type DeckType, type Round } from '@estimate/shared';
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAsyncAction } from '../../../composables/use-async-action';
import type { useRoomStore } from '../../../stores/room';

export type RoundPhase = 'none' | 'voting' | 'revealed';

export interface DepartedVote {
  participantId: string;
  name: string;
  valueLabel: string;
}

export interface UseRoomVotingOptions {
  room: ReturnType<typeof useRoomStore>;
}

export function useRoomVoting(options: UseRoomVotingOptions): {
  deckOptions: ComputedRef<Array<{ label: string; value: DeckType }>>;
  selectedDeck: Ref<DeckType>;
  deckCards: ComputedRef<readonly number[]>;
  cardLabel: (value: number) => string;
  myVote: Ref<number | null>;
  roundPhase: ComputedRef<RoundPhase>;
  votedCount: ComputedRef<number>;
  totalCount: ComputedRef<number>;
  allVoted: ComputedRef<boolean>;
  waitingForText: ComputedRef<string | null>;
  winnerLabel: ComputedRef<string | null>;
  departedVotes: ComputedRef<DepartedVote[]>;
  deckCardButtonLabel: ComputedRef<string>;
  cancelConfirmOpen: Ref<boolean>;
  revealConfirmOpen: Ref<boolean>;
  pendingDeckChange: Ref<DeckType | null>;
  starting: Readonly<Ref<boolean>>;
  revealing: Readonly<Ref<boolean>>;
  onStartRound: (options?: { silentRestart?: boolean; deckType?: DeckType }) => Promise<void>;
  onDeckActionClick: () => void;
  onDeckOptionClick: (value: DeckType) => void;
  onVote: (value: number) => Promise<void>;
  onRevealClick: () => void;
  onReveal: () => Promise<void>;
  revealedValueLabel: (participantId: string) => string | null;
  isWinnerParticipant: (participantId: string) => boolean;
} {
  const { t } = useI18n();
  const toast = useToast();
  const { room } = options;

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
  const departedVotes = computed<DepartedVote[]>(() => {
    const presentIds = new Set(room.participants.map((p) => p.participantId));
    return (room.result?.votes ?? [])
      .filter((v) => !presentIds.has(v.participantId))
      .map((v) => ({
        participantId: v.participantId,
        name: v.name,
        valueLabel: cardLabel(v.value),
      }));
  });

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
    run: (roundOptions) => room.startNewRound(roundOptions?.deckType ?? selectedDeck.value),
    success: (_, roundOptions) => {
      cancelConfirmOpen.value = false;
      // Без голосов раунд перезапускается без вопроса (см. onDeckActionClick) — новый раунд
      // визуально неотличим от старого, поэтому без тоста клик выглядит так, будто ничего не произошло
      if (roundOptions?.silentRestart) {
        toast.add({
          title: t('room.roundRestarted'),
          color: 'success',
          icon: 'i-lucide-refresh-cw',
        });
      }
    },
    error: () => {
      toast.add({ title: t('room.startRoundError'), color: 'error' });
    },
  });

  async function onStartRound(roundOptions?: {
    silentRestart?: boolean;
    deckType?: DeckType;
  }): Promise<void> {
    await startRound(roundOptions ?? {});
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

  return {
    deckOptions,
    selectedDeck,
    deckCards,
    cardLabel,
    myVote,
    roundPhase,
    votedCount,
    totalCount,
    allVoted,
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
  };
}
