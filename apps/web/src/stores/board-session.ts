/**
 * Реалтайм-сессия доски: соединение по вебсокету и join/leave-оркестрация
 * (12.4). По образцу `stores/room.ts`: сервер — источник истины, применённые
 * операции просто upsert/delete по id, отставшие рассылки (по `revision`)
 * отбрасываются.
 *
 * Оптимистичное применение операций (предикт, откат, undo/redo, 12.6/12.10) —
 * в `useBoardOptimisticApply`; presence/курсоры/блокировка редактирования/
 * камера follow-mode (14.1/14.2/14.5) — в `useBoardAwareness`. Здесь только
 * WS-подключение и склейка обеих частей через события сокета (16.5).
 */
import type {
  Board,
  BoardAccessLevel,
  BoardAwarenessKind,
  BoardShareRole,
  JoinBoardResult,
} from '@estimate/shared';
import { BOARD_WS_EVENTS, BOARD_WS_SERVER_EVENTS } from '@estimate/shared';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';

import { setBoardShare } from '../features/boards/api/boards-api';
import type { BoardLocalState } from '../features/boards/domain/apply-local-op';
import { useBoardAwareness } from '../features/boards/composables/use-board-awareness';
import { useBoardOptimisticApply } from '../features/boards/composables/use-board-optimistic-apply';
import { createRealtimeConnection, GuestTokenStore, type JoinContext } from '../lib/realtime';
import { emitWithAck, type PokerSocket } from '../lib/socket';
import { useSessionStore } from './session';

const guestTokens = new GuestTokenStore('estimate:board-guest:');

export const useBoardSessionStore = defineStore('boardSession', () => {
  const session = useSessionStore();
  const local: BoardLocalState = reactive({ items: new Map(), edges: new Map() });
  /** Идентификатор участника на доске — для presence/cursors; null до первого входа */
  const participantId = ref<string | null>(null);
  /** Итоговый уровень доступа текущего участника к доске (14.4) */
  const access = ref<BoardAccessLevel>('view');
  const joined = ref(false);

  let boardId: string | null = null;
  /** Имя гостя этого сеанса — self().name ниже, пока для него нет session.user */
  let ownGuestName: string | null = null;

  const items = computed(() => [...local.items.values()]);
  const edges = computed(() => [...local.edges.values()]);

  const awareness = useBoardAwareness();

  function requireSocket(): PokerSocket {
    return connection.require('Доска не подключена');
  }

  /** session.user пуст у гостя (14.4) — тогда участника и имя берём из своего же входа */
  function self(): { id: string; name: string } {
    return { id: participantId.value ?? '', name: session.user?.name ?? ownGuestName ?? '' };
  }

  const optimistic = useBoardOptimisticApply({ local, requireSocket, self });

  /**
   * Доска берётся из `boardId`, а не из замыкания: при переходе на другую доску
   * на живом сокете вход после обрыва должен вернуть на текущую доску, а не на
   * ту, с которой сессию когда-то начали.
   */
  async function performJoin(active: PokerSocket, ctx: JoinContext): Promise<void> {
    const id = boardId;
    if (!id) return;
    // Гостю сервер требует имя на каждый join, включая реконнект — то же имя,
    // что и при первом входе
    const guestName = ownGuestName ?? undefined;

     const result: JoinBoardResult = await emitWithAck(active, BOARD_WS_EVENTS.JOIN, {
      boardId: id,
      guestName,
      guestToken: guestTokens.read(id),
      // Клиент поддерживает элементы диаграмм (23.2) — это разрешает серверу
      // принимать и рассылать diagram-операции и в догоне, и в снимке
      supportsDiagrams: true,
      // При первом входе на доску (ещя не видели ни одной ревизии) полный
      // снимок дешевле, чем прогонять пустой догон — присылаем только на реконнекте
      sinceRevision: ctx.reconnect ? optimistic.revision.value : undefined,
    });

    // Пока ждали ответ, вызвали leave() или новый join() — это уже не наш вход
    if (!ctx.isCurrent()) return;

    guestTokens.write(id, result.guestToken);
    participantId.value = result.participantId;
    access.value = result.access;

    if (result.snapshot) {
      optimistic.applySnapshot(result.snapshot, result.revision);
    } else if (result.catchup) {
      for (const batch of result.catchup) optimistic.applyBatch(batch);
      optimistic.revision.value = result.revision;
    }
    joined.value = true;
  }

  /** Доменные события доски — вешаются один раз на каждый созданный сокет */
  function attachBoardListeners(active: PokerSocket): void {
    active.on(BOARD_WS_SERVER_EVENTS.OPS, optimistic.applyBatch);
    active.on(BOARD_WS_SERVER_EVENTS.PRESENCE, awareness.handlePresence);
    active.on(BOARD_WS_SERVER_EVENTS.AWARENESS, awareness.handleAwareness);
  }

  const connection = createRealtimeConnection({
    attach: attachBoardListeners,
    join: performJoin,
  });

  async function join(
    id: string,
    guestName?: string,
    onReconnectFailure?: () => void,
  ): Promise<void> {
    // Смена доски на живом сокете — сбрасываем прошлое состояние, иначе
    // отставшая рассылка старой доски осталась бы на экране
    if (boardId && boardId !== id) {
      local.items.clear();
      local.edges.clear();
      participantId.value = null;
      access.value = 'view';
      ownGuestName = null;
      optimistic.resetForNewSession();
      // Presence/курсоры/блокировка редактирования намеренно НЕ сбрасываются
      // здесь — свежий PRESENCE новой доски перепишет их сам; камера
      // follow-mode так не работает (копится, а не перезаписывается целиком)
      awareness.cameraByParticipant.clear();
      awareness.followedParticipantId.value = null;
    }
    boardId = id;
    // Имя гостя нужно и на автоматическом входе после обрыва — сервер требует
    // его на каждый join, а второй раз спрашивать пользователя негде
    if (guestName !== undefined) ownGuestName = guestName;
    joined.value = false;

    await connection.open(onReconnectFailure);
  }

  function leave(): void {
    connection.close();
    boardId = null;
    ownGuestName = null;
    joined.value = false;
    participantId.value = null;
    access.value = 'view';
    local.items.clear();
    local.edges.clear();
    optimistic.resetForNewSession();
    awareness.reset();
  }

  /**
   * Курсоры участников — не персистится, throttle на стороне вызывающего кода.
   * Перетаскивание элементов синхронизируется не этим, а обычными throttled
   * `item.patch` через `applyOps` (12.6) — курсоры участников появятся в 14.1.
   */
  function sendAwareness(kind: BoardAwarenessKind, data: Record<string, unknown>): void {
    connection.current()?.emit(BOARD_WS_EVENTS.AWARENESS, { kind, data });
  }

  async function setShare(role: BoardShareRole | null): Promise<Board> {
    if (!boardId) throw new Error('Нельзя изменить доступ к доске вне активной сессии');
    return setBoardShare(boardId, role);
  }

  return {
    items,
    edges,
    revision: optimistic.revision,
    presence: awareness.presence,
    awareness: awareness.awareness,
    editingByItem: awareness.editingByItem,
    cameraByParticipant: awareness.cameraByParticipant,
    followedParticipantId: awareness.followedParticipantId,
    cameraOfFollowed: awareness.cameraOfFollowed,
    followParticipant: awareness.followParticipant,
    stopFollowing: awareness.stopFollowing,
    connected: connection.connected,
    joined,
    participantId,
    access,
    applyError: optimistic.applyError,
    join,
    leave,
    applyOps: optimistic.applyOps,
    sendAwareness,
    canUndo: optimistic.canUndo,
    canRedo: optimistic.canRedo,
    undo: optimistic.undo,
    redo: optimistic.redo,
    setShare,
  };
});
