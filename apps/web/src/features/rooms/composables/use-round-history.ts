/** История раундов: открыта так же, как и сама комната, отдельным REST-запросом (5.7) */
import type { DeckType, RoundHistoryEntry } from '@estimate/shared';
import { tshirtLabel } from '@estimate/shared';
import { ref, watch, onBeforeUnmount, type Ref } from 'vue';

import { getRoundHistory } from '../api/rooms-api';
import type { useRoomStore } from '../../../stores/room';

export interface UseRoundHistoryOptions {
  roomId: () => string;
  room: ReturnType<typeof useRoomStore>;
}

export function useRoundHistory(options: UseRoundHistoryOptions): {
  historyEntries: Ref<RoundHistoryEntry[]>;
  historyLoading: Ref<boolean>;
  historyFailed: Ref<boolean>;
  historyVotesText: (entry: RoundHistoryEntry) => string;
  historyResultLabel: (entry: RoundHistoryEntry) => string;
  reset: () => void;
} {
  const historyEntries = ref<RoundHistoryEntry[]>([]);
  const historyLoading = ref(false);
  const historyFailed = ref(false);
  /** Бампается при смене комнаты/размонтировании — устаревший ответ не перезаписывает свежее состояние */
  let token = 0;

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
    const myToken = token;
    const roomId = options.roomId();
    historyLoading.value = true;
    historyFailed.value = false;
    try {
      const rounds = await getRoundHistory(roomId);
      // Пока запрос летел, могли перейти в другую комнату — её историю не подменяем
      if (myToken !== token) return;
      historyEntries.value = rounds;
    } catch {
      if (myToken !== token) return;
      historyFailed.value = true;
    } finally {
      if (myToken === token) historyLoading.value = false;
    }
  }

  /** Вызывается при (пере)загрузке комнаты — сбрасывает прежнюю историю и запрашивает новую */
  function reset(): void {
    token++;
    historyEntries.value = [];
    void loadHistory();
  }

  // Раунд стал вскрытым — рассылка room_state доходит до всех за столом, поэтому
  // историю обновляет каждый участник, а не только тот, кто нажал «Вскрыть карты»
  watch(
    () => options.room.round?.status,
    (status) => {
      if (status === 'revealed') void loadHistory();
    },
  );

  onBeforeUnmount(() => {
    token++;
  });

  return {
    historyEntries,
    historyLoading,
    historyFailed,
    historyVotesText,
    historyResultLabel,
    reset,
  };
}
