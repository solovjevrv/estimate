/**
 * Голосование точками на холсте (15.2). Состояние — в сторе сессии доски
 * (персональная рассылка `board:voting`), здесь — всё, что из него следует
 * для холста: кто в скоупе, что делает клик по элементу во время голосования,
 * какие узлы приглушить, строки итогов и команды с общим флагом `pending`.
 * Composable не знает про Vue Flow: узлы приходят и уходят как простые объекты
 * с `id`/`class`.
 */
import {
  effectiveMaxPerItem,
  isVotableContent,
  type BoardItem,
  type BoardVoteAuthor,
  type BoardVotingState,
  type BoardVotingSummary,
  type StartBoardVotingPayload,
} from '@estimate/shared';
import { useToast } from '@nuxt/ui/composables';
import { computed, ref, watch, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';

import { useAsyncAction } from '../../../composables/use-async-action';

export interface BoardVotingCommands {
  start: (payload: StartBoardVotingPayload) => Promise<void>;
  vote: (itemId: string, delta: 1 | -1) => Promise<void>;
  close: () => Promise<void>;
  cancel: () => Promise<void>;
  fetchHistory: () => Promise<BoardVotingSummary[]>;
  fetchResults: (votingId: string) => Promise<BoardVotingState>;
}

/** Где голосуем: вся доска, выделенные элементы или фрейм (по его id) */
export type BoardVotingScopeChoice = 'board' | 'selected' | `frame:${string}`;

export interface BoardVotingSetup {
  /** null — без ограничения (не оба сразу) */
  votesPerParticipant: number | null;
  maxPerItem: number | null;
  scope: BoardVotingScopeChoice;
  startTimer: boolean;
}

export interface BoardVotingResultRow {
  itemId: string;
  rank: number;
  text: string;
  color: string;
  total: number;
  authors: BoardVoteAuthor[];
}

export interface BoardVotingScopeOption {
  value: BoardVotingScopeChoice;
  label: string;
}

/** Узел холста, достаточный для приглушения — `class` дописывается, остальное не трогаем */
export interface VotingDecoratableNode {
  id: string;
  class?: unknown;
  selectable?: boolean;
}

const MUTED_CLASS = 'board-node-voting-muted';
/** Элемент в голосовании — курсор-рука на всём узле */
const TARGET_CLASS = 'board-node-voting-target';

export interface UseBoardVotingOptions {
  state: () => BoardVotingState | null;
  items: () => readonly BoardItem[];
  /** Id выделенных элементов на момент открытия настройки — для скоупа «Выделенные» */
  selectedIds: () => readonly string[];
  /** Сколько участников на доске — для предупреждения «не все проголосовали» */
  participantCount: () => number;
  commands: BoardVotingCommands;
}

/** «2 окт., 14:05» — дата голосования в истории и в заголовке итогов */
export function formatVotingDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function useBoardVoting(options: UseBoardVotingOptions) {
  const { t } = useI18n();
  const toast = useToast();

  const state = computed(() => options.state());
  const isActive = computed(() => state.value?.status === 'active');
  /** На доске уже было голосование — кнопка открывает меню с историей */
  const hasHistory = computed(() => state.value?.status === 'closed');

  /**
   * Открытые итоги: голосование из истории или только что завершённое.
   * Панель и бейджи итогов на элементах — личное: закрыл у себя, у других открыто.
   */
  const viewedResults = ref<BoardVotingState | null>(null);
  const resultsOpen = ref(false);
  const shownResults = computed<BoardVotingState | null>(() => {
    if (viewedResults.value) return viewedResults.value;
    return state.value?.status === 'closed' ? state.value : null;
  });
  const hasResults = computed(() => resultsOpen.value && !!shownResults.value?.results);

  // Голосование завершилось на глазах — итоги открываются у всех сами
  watch(
    () => [state.value?.id, state.value?.status] as const,
    ([id, status], [prevId, prevStatus]) => {
      if (status === 'closed' && id === prevId && prevStatus === 'active') {
        viewedResults.value = null;
        resultsOpen.value = true;
      }
      if (status === 'active') resultsOpen.value = false;
    },
  );

  const history = ref<BoardVotingSummary[]>([]);
  const historyLoading = ref(false);

  async function loadHistory(): Promise<void> {
    historyLoading.value = true;
    try {
      history.value = await options.commands.fetchHistory();
    } catch {
      toast.add({ title: t('board.voting.error'), color: 'error' });
    } finally {
      historyLoading.value = false;
    }
  }

  /** Итоги голосования из истории — с бейджами на элементах */
  async function openResults(votingId: string): Promise<void> {
    if (state.value?.status === 'closed' && state.value.id === votingId) {
      viewedResults.value = null;
      resultsOpen.value = true;
      return;
    }
    await execute(async () => {
      viewedResults.value = await options.commands.fetchResults(votingId);
      resultsOpen.value = true;
    });
  }

  function closeResults(): void {
    resultsOpen.value = false;
    viewedResults.value = null;
  }

  /** «Новое голосование» из панели итогов — кнопка в верхнем ряду открывает настройку */
  const setupRequests = ref(0);
  function requestNewVoting(): void {
    setupRequests.value += 1;
  }

  const itemsById = computed(() => new Map(options.items().map((item) => [item.id, item])));
  const scopeSet = computed(() => {
    const ids = state.value?.itemIds;
    return ids ? new Set(ids) : null;
  });

  function isInScope(item: BoardItem): boolean {
    if (!isVotableContent(item.content)) return false;
    return scopeSet.value === null || scopeSet.value.has(item.id);
  }

  const { pending, execute } = useAsyncAction<[() => Promise<void>], void>({
    run: (operation) => operation(),
    error: () => {
      toast.add({ title: t('board.voting.error'), color: 'error' });
    },
  });

  /** Голос — отдельный канал без `pending`: частые клики не должны ждать друг друга в UI */
  async function vote(itemId: string, delta: 1 | -1): Promise<void> {
    try {
      await options.commands.vote(itemId, delta);
    } catch {
      toast.add({ title: t('board.voting.error'), color: 'error' });
    }
  }

  /** Можно ли сейчас поставить точку на элемент — от этого зависит подсветка при наведении */
  function canVoteOn(item: BoardItem): boolean {
    const current = state.value;
    if (!current || current.status !== 'active' || !isInScope(item)) return false;
    if (current.myRemaining !== null && current.myRemaining <= 0) return false;
    return (current.myVotes[item.id] ?? 0) < effectiveMaxPerItem(current);
  }

  /**
   * Клик по узлу во время голосования — точка, а не выделение. true — клик
   * поглощён (элемент вне скоупа тоже: во время голосования он не выделяется).
   * Почему точку поставить нельзя, объясняет тост, а не состояние на стикере.
   */
  function onNodeClick(itemId: string): boolean {
    const current = state.value;
    if (!current || current.status !== 'active') return false;
    const item = itemsById.value.get(itemId);
    if (!item || !isInScope(item)) return true;
    if (current.myRemaining !== null && current.myRemaining <= 0) {
      toast.add({ title: t('board.voting.noVotesLeft'), color: 'neutral' });
      return true;
    }
    if ((current.myVotes[itemId] ?? 0) >= effectiveMaxPerItem(current)) {
      toast.add({ title: t('board.voting.itemLimit'), color: 'neutral' });
      return true;
    }
    void vote(itemId, 1);
    return true;
  }

  function removeVote(itemId: string): void {
    if (!isActive.value || !(state.value?.myVotes[itemId] ?? 0)) return;
    void vote(itemId, -1);
  }

  /** Элементы скоупа на момент старта; null — вся доска */
  function resolveScope(scope: BoardVotingScopeChoice): string[] | null {
    if (scope === 'board') return null;
    const items = options.items();
    if (scope === 'selected') {
      // Выделенная группа голосует своими участниками; сервер отбросит нетекстовое сам
      const selected = new Set(options.selectedIds());
      return items
        .filter((item) => selected.has(item.id) || (item.parentId && selected.has(item.parentId)))
        .map((item) => item.id);
    }
    const frameId = scope.slice('frame:'.length);
    const parentOf = new Map(items.map((item) => [item.id, item.parentId]));
    return items
      .filter(
        (item) =>
          item.parentId === frameId ||
          (item.parentId !== null && parentOf.get(item.parentId) === frameId),
      )
      .map((item) => item.id);
  }

  const scopeOptions = computed<BoardVotingScopeOption[]>(() => {
    const result: BoardVotingScopeOption[] = [
      { value: 'board', label: t('board.voting.scopeBoard') },
    ];
    // Доступно всегда: выбрать можно и до выделения — настройка остаётся открытой,
    // пока выделяешь элементы на холсте, а число обновляется на лету
    const selected = options.selectedIds().length;
    result.push({
      value: 'selected',
      label:
        selected > 0
          ? t('board.voting.scopeSelected', { count: selected })
          : t('board.voting.scopeSelectedEmpty'),
    });
    for (const item of options.items()) {
      if (item.content.type !== 'frame') continue;
      result.push({
        value: `frame:${item.id}`,
        label: item.content.title || t('board.voting.untitledFrame'),
      });
    }
    return result;
  });

  const selectedCount = computed(() => options.selectedIds().length);

  /** Скоуп по умолчанию: есть выделение — «Выделенные», иначе вся доска */
  const defaultScope = computed<BoardVotingScopeChoice>(() =>
    options.selectedIds().length > 0 ? 'selected' : 'board',
  );

  async function start(setup: BoardVotingSetup): Promise<boolean> {
    let started = false;
    await execute(async () => {
      await options.commands.start({
        votesPerParticipant: setup.votesPerParticipant,
        maxPerItem: setup.maxPerItem,
        itemIds: resolveScope(setup.scope),
        startTimer: setup.startTimer,
      });
      started = true;
    });
    return started;
  }

  /** Предупреждение «не все проголосовали» перед завершением */
  const confirmFinishOpen = ref(false);
  /** Сколько участников на доске потратили все точки — для текста предупреждения */
  const finishStats = computed(() => ({
    completed: state.value?.completedCount ?? 0,
    total: Math.max(options.participantCount(), state.value?.completedCount ?? 0),
  }));

  async function finish(): Promise<void> {
    // Без лимита на человека «потратить все точки» нельзя — подтверждение не нужно
    const limited = state.value?.votesPerParticipant != null;
    if (limited && finishStats.value.completed < finishStats.value.total) {
      confirmFinishOpen.value = true;
      return;
    }
    await close();
  }

  function setConfirmFinishOpen(open: boolean): void {
    confirmFinishOpen.value = open;
  }

  async function confirmFinish(): Promise<void> {
    confirmFinishOpen.value = false;
    await close();
  }

  const close = () => execute(options.commands.close);
  const cancel = () => execute(options.commands.cancel);

  const resultRows = computed<BoardVotingResultRow[]>(() =>
    (shownResults.value?.results ?? []).map((result, index) => {
      const item = itemsById.value.get(result.itemId);
      const text = item && 'text' in item.content ? item.content.text.trim() : '';
      return {
        itemId: result.itemId,
        rank: index + 1,
        text: text || t('board.voting.untitledItem'),
        color: item?.style.color ?? 'transparent',
        total: result.total,
        authors: result.authors,
      };
    }),
  );

  const summary = computed(() => {
    const voters = new Set<string>();
    let votes = 0;
    for (const row of shownResults.value?.results ?? []) {
      votes += row.total;
      for (const author of row.authors) voters.add(author.participantId);
    }
    return { voters: voters.size, votes };
  });

  /**
   * Во время голосования узлы не выделяются (явный `selectable` узла перебивает
   * общий запрет холста), а всё, за что голосовать нельзя, приглушено. Кэш по
   * исходному узлу: при неизменном узле отдаём тот же декорированный объект,
   * иначе холст пересобирал бы узлы на каждый пересчёт. Кэш живёт одно
   * голосование: у следующего может быть другой скоуп.
   */
  let decorated = new WeakMap<object, VotingDecoratableNode>();
  let decoratedFor: string | null = null;
  function decorateNodes<T extends VotingDecoratableNode>(nodes: T[]): T[] {
    if (!isActive.value) return nodes;
    const votingId = state.value?.id ?? null;
    if (votingId !== decoratedFor) {
      decorated = new WeakMap();
      decoratedFor = votingId;
    }
    return nodes.map((node) => {
      const cached = decorated.get(node);
      if (cached) return cached as T;
      const item = itemsById.value.get(node.id);
      const muted = !item || !isInScope(item);
      const next = {
        ...node,
        selectable: false,
        class: [node.class, muted ? MUTED_CLASS : TARGET_CLASS],
      } as T;
      decorated.set(node, next);
      return next;
    });
  }

  return {
    state,
    isActive,
    hasHistory,
    hasResults,
    shownResults,
    resultsOpen,
    closeResults,
    openResults,
    history,
    historyLoading,
    loadHistory,
    setupRequests,
    requestNewVoting,
    pending,
    isInScope,
    canVoteOn,
    onNodeClick,
    removeVote,
    scopeOptions,
    defaultScope,
    selectedCount,
    start,
    finish,
    confirmFinish,
    confirmFinishOpen,
    setConfirmFinishOpen,
    finishStats,
    cancel,
    resultRows,
    summary,
    decorateNodes,
  };
}

export type BoardVoting = ReturnType<typeof useBoardVoting>;

/** То, что нужно бейджу голосов внутри узла — через provide/inject, мимо `data` узла */
export interface BoardVotingNodeContext {
  state: ComputedRef<BoardVotingState | null>;
  isInScope: (item: BoardItem) => boolean;
  canVoteOn: (item: BoardItem) => boolean;
  removeVote: (itemId: string) => void;
  resultRows: ComputedRef<BoardVotingResultRow[]>;
  hasResults: ComputedRef<boolean>;
  isActive: ComputedRef<boolean>;
}
