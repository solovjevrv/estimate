import type { BoardItem, BoardOp, BoardVotingState } from '@estimate/shared';
import { isVotableContent } from '@estimate/shared';
import { useToast } from '@nuxt/ui/composables';
import { computed, nextTick, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { STICKY_DEFAULT_COLOR, minZIndex } from '../config/board-item-defaults';
import {
  ARRANGE_OUTSIDE_OFFSET,
  boundsOf,
  clusterPlan,
  groupByAuthor,
  groupByColor,
  orderByVotes,
  sortPlan,
  type ArrangePlan,
  type ArrangeRect,
  type BoardArrangeMode,
} from '../domain/board-arrange';

/** Названия цветов палитры — в порядке `BOARD_COLOR_PALETTE`, ключи i18n `board.arrange.colors.*` */
const PALETTE_COLOR_KEYS = [
  'white',
  'paleYellow',
  'yellow',
  'peach',
  'lime',
  'green',
  'emerald',
  'mint',
  'pink',
  'magenta',
  'lavender',
  'coral',
  'blue',
  'sky',
  'indigo',
  'ink',
] as const;

const DONE_ICONS: Record<BoardArrangeMode, string> = {
  votes: 'i-lucide-arrow-down-wide-narrow',
  color: 'i-lucide-palette',
  author: 'i-lucide-users',
};

export interface UseBoardArrangeOptions {
  items: () => readonly BoardItem[];
  selectedItems: () => readonly BoardItem[];
  voting: {
    isActive: Ref<boolean>;
    hasResults: Ref<boolean>;
    shownResults: Ref<BoardVotingState | null>;
  };
  authorNames: () => ReadonlyMap<string, string>;
  canEdit: () => boolean;
  /** Лимит батча `board:apply` — при превышении сам показывает тост */
  canApplyOpsCount: (count: number) => boolean;
  history: {
    applyOps: (ops: BoardOp[]) => Promise<number>;
    peekUndo: () => unknown;
    undo: () => Promise<void>;
  };
  selectItems: (ids: string[]) => void;
  clearSelection: () => void;
  /** Камера к результату раскладки */
  reveal: (rect: ArrangeRect) => void;
}

/**
 * Раскладка (15.4): «Разложить ▾» в тулбаре выделения и «Выстроить по
 * голосам» в итогах голосования. Одна операция — одна запись undo; тост
 * «Отменить» откатывает её, только если после раскладки ничего больше не
 * сделано (иначе отменил бы чужое действие).
 */
export function useBoardArrange(options: UseBoardArrangeOptions) {
  const { t } = useI18n();
  const toast = useToast();

  const totals = computed(
    () =>
      new Map(
        (options.voting.shownResults.value?.results ?? []).map((row) => [row.itemId, row.total]),
      ),
  );

  function inGroup(item: BoardItem, byId: ReadonlyMap<string, BoardItem>): boolean {
    return item.parentId !== null && byId.get(item.parentId)?.content.type === 'group';
  }

  /**
   * Раскладываются только текстовые элементы — те же, за которые голосуют.
   * Участник группы — нет: группа жёсткий пучок, вынимать из неё по одному
   * нельзя (как и при перетаскивании).
   */
  const canArrangeSelection = computed(() => {
    if (!options.canEdit() || options.voting.isActive.value) return false;
    const selected = options.selectedItems();
    if (selected.length < 2) return false;
    const byId = new Map(options.items().map((item) => [item.id, item]));
    return selected.every((item) => isVotableContent(item.content) && !inGroup(item, byId));
  });

  /** «По голосам» в меню — только когда открыты итоги и в выделении есть элементы с точками */
  const canArrangeSelectionByVotes = computed(
    () =>
      options.voting.hasResults.value &&
      options.selectedItems().some((item) => (totals.value.get(item.id) ?? 0) > 0),
  );

  /**
   * Что выстраивать из итогов: голосование по выделенным/фрейму — весь его
   * скоуп (без точек — в конце); по всей доске — только элементы с точками.
   */
  function resultItems(): { items: BoardItem[]; wholeBoard: boolean } {
    const state = options.voting.shownResults.value;
    const byId = new Map(options.items().map((item) => [item.id, item]));
    const ids = state?.itemIds ?? (state?.results ?? []).map((row) => row.itemId);
    const items = ids
      .map((id) => byId.get(id))
      .filter(
        (item): item is BoardItem =>
          !!item && isVotableContent(item.content) && !inGroup(item, byId),
      );
    return { items, wholeBoard: !state?.itemIds };
  }

  const canArrangeResults = computed(
    () =>
      options.canEdit() &&
      !options.voting.isActive.value &&
      options.voting.hasResults.value &&
      resultItems().items.length > 0,
  );

  function run(plan: ArrangePlan, mode: BoardArrangeMode): void {
    if (!plan.ops.length || !options.canApplyOpsCount(plan.ops.length)) return;
    // Отказ сервера откатывает раскладку и показывается общим тостом страницы (applyError)
    options.history.applyOps(plan.ops).catch(() => undefined);
    const marker = options.history.peekUndo();
    if (plan.frameIds.length) {
      void nextTick(() => options.selectItems(plan.frameIds));
    } else {
      options.clearSelection();
    }
    options.reveal(plan.bounds);
    toast.add({
      title: t(`board.arrange.done.${mode}`),
      icon: DONE_ICONS[mode],
      close: false,
      orientation: 'horizontal',
      actions: [
        {
          label: t('board.arrange.undo'),
          color: 'primary',
          variant: 'ghost',
          size: 'sm',
          onClick: () => {
            if (options.history.peekUndo() === marker) void options.history.undo();
          },
        },
      ],
    });
  }

  function arrangeResults(): void {
    if (!canArrangeResults.value) return;
    const { items, wholeBoard } = resultItems();
    const board = boundsOf(options.items());
    const origin = wholeBoard
      ? { x: board.x + board.width + ARRANGE_OUTSIDE_OFFSET, y: board.y }
      : boundsOf(items);
    run(
      sortPlan({
        ordered: orderByVotes(items, totals.value),
        origin: { x: origin.x, y: origin.y },
        boardItems: options.items(),
      }),
      'votes',
    );
  }

  function arrangeSelection(mode: BoardArrangeMode): void {
    if (!canArrangeSelection.value) return;
    if (mode === 'votes' && !canArrangeSelectionByVotes.value) return;
    const selected = [...options.selectedItems()];
    const bounds = boundsOf(selected);
    const origin = { x: bounds.x, y: bounds.y };
    if (mode === 'votes') {
      run(
        sortPlan({
          ordered: orderByVotes(selected, totals.value),
          origin,
          boardItems: options.items(),
        }),
        mode,
      );
      return;
    }
    const groups =
      mode === 'color'
        ? groupByColor(selected, (index) =>
            t(`board.arrange.colors.${PALETTE_COLOR_KEYS[index] ?? 'white'}`),
          )
        : groupByAuthor(selected, options.authorNames(), {
            guests: t('board.arrange.guests'),
            unknownName: t('board.arrange.unknownAuthor'),
          });
    run(
      clusterPlan({
        groups,
        origin,
        frameZIndex: minZIndex(options.items()) - 1,
        // По цвету — фрейм в тон своей кучки (заливка фрейма — 14% от цвета)
        frameColor: (group) =>
          mode === 'color'
            ? (group.items[0]?.style.color ?? STICKY_DEFAULT_COLOR)
            : STICKY_DEFAULT_COLOR,
      }),
      mode,
    );
  }

  return {
    canArrangeSelection,
    canArrangeSelectionByVotes,
    canArrangeResults,
    arrangeSelection,
    arrangeResults,
  };
}

export type BoardArrange = ReturnType<typeof useBoardArrange>;
