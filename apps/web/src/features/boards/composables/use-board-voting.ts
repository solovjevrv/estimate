/**
 * Голосование точками на холсте (15.2). Состояние — в сторе сессии доски
 * (персональная рассылка `board:voting`), здесь — всё, что из него следует
 * для холста: кто в скоупе, что делает клик по элементу во время голосования,
 * какие узлы приглушить, строки итогов и команды с общим флагом `pending`.
 * Composable не знает про Vue Flow: узлы приходят и уходят как простые объекты
 * с `id`/`class`.
 */
import {
  isVotableContent,
  type BoardItem,
  type BoardVoteAuthor,
  type BoardVotingState,
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
  hide: () => Promise<void>;
  /** Запуск таймера доски — галочка в настройке голосования */
  startTimer: () => Promise<void>;
}

/** Где голосуем: вся доска, выделенные элементы или фрейм (по его id) */
export type BoardVotingScopeChoice = 'board' | 'selected' | `frame:${string}`;

export interface BoardVotingSetup {
  votesPerParticipant: number;
  maxPerItem: number;
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

export interface UseBoardVotingOptions {
  state: () => BoardVotingState | null;
  items: () => readonly BoardItem[];
  /** Id выделенных элементов на момент открытия настройки — для скоупа «Выделенные» */
  selectedIds: () => readonly string[];
  commands: BoardVotingCommands;
}

export function useBoardVoting(options: UseBoardVotingOptions) {
  const { t } = useI18n();
  const toast = useToast();

  const state = computed(() => options.state());
  const isActive = computed(() => state.value?.status === 'active');
  const hasResults = computed(() => state.value?.status === 'closed' && !!state.value.results);
  /** Панель итогов: раскрывается сама, когда голосование завершилось */
  const resultsOpen = ref(false);
  watch(
    () => (hasResults.value ? state.value?.id : null),
    (id) => {
      resultsOpen.value = id != null;
    },
    { immediate: true },
  );

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

  /**
   * Клик по узлу во время голосования — точка, а не выделение. true — клик
   * поглощён (элемент вне скоупа тоже: во время голосования он не выделяется).
   */
  function onNodeClick(itemId: string): boolean {
    if (!isActive.value) return false;
    const item = itemsById.value.get(itemId);
    if (!item || !isInScope(item)) return true;
    if ((state.value?.myRemaining ?? 0) <= 0) {
      toast.add({ title: t('board.voting.noVotesLeft'), color: 'neutral' });
      return true;
    }
    const mine = state.value?.myVotes[itemId] ?? 0;
    if (mine >= (state.value?.maxPerItem ?? 0)) return true;
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
    const selected = options.selectedIds().length;
    if (selected > 0) {
      result.push({
        value: 'selected',
        label: t('board.voting.scopeSelected', { count: selected }),
      });
    }
    for (const item of options.items()) {
      if (item.content.type !== 'frame') continue;
      result.push({
        value: `frame:${item.id}`,
        label: item.content.title || t('board.voting.untitledFrame'),
      });
    }
    return result;
  });

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
      });
      started = true;
      if (setup.startTimer) await options.commands.startTimer();
    });
    return started;
  }

  function toggleResults(): void {
    resultsOpen.value = !resultsOpen.value;
  }

  function closeResults(): void {
    resultsOpen.value = false;
  }

  const close = () => execute(options.commands.close);
  const cancel = () => execute(options.commands.cancel);
  const hide = () => execute(options.commands.hide);

  const resultRows = computed<BoardVotingResultRow[]>(() =>
    (state.value?.results ?? []).map((result, index) => {
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
    for (const row of state.value?.results ?? []) {
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
        ...(muted ? { class: [node.class, MUTED_CLASS] } : {}),
      } as T;
      decorated.set(node, next);
      return next;
    });
  }

  return {
    state,
    isActive,
    hasResults,
    resultsOpen,
    toggleResults,
    closeResults,
    pending,
    isInScope,
    onNodeClick,
    removeVote,
    scopeOptions,
    defaultScope,
    start,
    close,
    cancel,
    hide,
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
  removeVote: (itemId: string) => void;
  resultRows: ComputedRef<BoardVotingResultRow[]>;
  hasResults: ComputedRef<boolean>;
  isActive: ComputedRef<boolean>;
}
