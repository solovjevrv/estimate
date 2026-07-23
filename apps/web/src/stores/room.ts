/**
 * Стол комнаты: соединение по вебсокету, снимок состояния и действия участника.
 * Сервер рассылает состояние целиком, поэтому стор ничего не досчитывает —
 * он лишь отбрасывает снимки, которые пришли позже свежих.
 */
import type {
  DeckType,
  JoinRoomResult,
  Participant,
  RoomState,
  Round,
  RoundResult,
} from '@poker/shared';
import { WS_EVENTS, WS_SERVER_EVENTS } from '@poker/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { createSocket, emitWithAck, type PokerSocket } from '../lib/socket';

/**
 * Токен гостя переживает перезагрузку страницы: без него участник вернётся в
 * комнату новым человеком и потеряет свой голос. Держим по комнате отдельно.
 */
function guestTokenKey(roomId: string): string {
  return `poker:guest:${roomId}`;
}

function readGuestToken(roomId: string): string | undefined {
  try {
    return localStorage.getItem(guestTokenKey(roomId)) ?? undefined;
  } catch {
    // Приватный режим браузера может запрещать хранилище — тогда просто входим заново
    return undefined;
  }
}

function writeGuestToken(roomId: string, token: string | null): void {
  try {
    if (token === null) return;
    localStorage.setItem(guestTokenKey(roomId), token);
  } catch {
    // Не смогли сохранить — переподключение потребует ввести имя ещё раз
  }
}

export const useRoomStore = defineStore('room', () => {
  const state = ref<RoomState | null>(null);
  const participantId = ref<string | null>(null);
  const connected = ref(false);

  let socket: PokerSocket | null = null;
  /** Куда входим: держим отдельно, чтобы восстановить место за столом после реконнекта */
  let target: { roomId: string; guestName?: string } | null = null;
  /** Прошёл ли первый успешный вход — по нему отличаем реконнект от начального подключения */
  let established = false;

  const room = computed(() => state.value?.room ?? null);
  const round = computed<Round | null>(() => state.value?.round ?? null);
  const participants = computed<Participant[]>(() => state.value?.participants ?? []);
  const result = computed<RoundResult | null>(() => state.value?.result ?? null);
  const isScrumMaster = computed(
    () =>
      participants.value.find((p) => p.participantId === participantId.value)?.role ===
      'scrum_master',
  );

  /**
   * Рассылки идут параллельно и могут обогнать друг друга, поэтому снимок с
   * номером меньше уже показанного игнорируем — иначе стол «прыгал» бы назад.
   */
  function applyState(next: RoomState): void {
    const current = state.value;
    if (current && current.room.id === next.room.id && next.room.revision < current.room.revision) {
      return;
    }
    state.value = next;
  }

  /** Отправляет вход и применяет ответ. Используется и при первом входе, и при переподключении */
  async function performJoin(): Promise<void> {
    const active = socket;
    const params = target;
    if (!active || !params) return;

    const joined = await emitWithAck<typeof WS_EVENTS.JOIN_ROOM, JoinRoomResult>(
      active,
      WS_EVENTS.JOIN_ROOM,
      {
        roomId: params.roomId,
        guestName: params.guestName,
        guestToken: readGuestToken(params.roomId),
      },
    );

    writeGuestToken(params.roomId, joined.guestToken);
    participantId.value = joined.participantId;
    // Снимок из ответа — такой же, как в рассылке, и проходит ту же проверку
    applyState(joined.state);
  }

  /** Вход в комнату: авторизованного сервер узнает по куке, гость называет имя */
  async function join(roomId: string, guestName?: string): Promise<void> {
    // Смена комнаты на живом сокете: сбрасываем прошлый стол, иначе отставшая
    // рассылка старой комнаты (id другой — проверку revision не проходит) осталась бы на экране
    if (state.value && state.value.room.id !== roomId) {
      state.value = null;
      participantId.value = null;
    }
    target = { roomId, guestName };

    socket ??= createSocket();
    const active = socket;

    if (!active.hasListeners(WS_SERVER_EVENTS.ROOM_STATE)) {
      active.on(WS_SERVER_EVENTS.ROOM_STATE, applyState);
      active.on('connect', () => {
        connected.value = true;
        // Место за столом на сервере привязано к соединению: после обрыва входим заново.
        // Первый connect не трогаем — вход по нему сделает сам join ниже
        if (established) {
          void performJoin().catch(() => {
            // Не вышло восстановиться — попробуем на следующем переподключении
          });
        }
      });
      active.on('disconnect', () => {
        connected.value = false;
      });
    }

    if (!active.connected) {
      active.connect();
    }

    await performJoin();
    established = true;
  }

  function leave(): void {
    socket?.disconnect();
    socket = null;
    target = null;
    established = false;
    state.value = null;
    participantId.value = null;
    connected.value = false;
  }

  function requireSocket(): PokerSocket {
    if (!socket) throw new Error('Комната не подключена');
    return socket;
  }

  /**
   * Ниже — действия стола. Вместе с каждым уходит то, что участник видел (см. 2.6).
   * Новое состояние приходит рассылкой `room_state`, поэтому здесь его не применяем:
   * в ответе на голос и правку ссылок его и нет, а у вскрытия — только итоги раунда.
   */

  async function submitVote(value: number): Promise<void> {
    await emitWithAck<typeof WS_EVENTS.SUBMIT_VOTE, null>(requireSocket(), WS_EVENTS.SUBMIT_VOTE, {
      value,
      roundId: round.value?.id ?? null,
    });
  }

  async function revealCards(): Promise<RoundResult> {
    return emitWithAck<typeof WS_EVENTS.REVEAL_CARDS, RoundResult>(
      requireSocket(),
      WS_EVENTS.REVEAL_CARDS,
      { roundId: round.value?.id ?? null },
    );
  }

  async function startNewRound(deckType: DeckType): Promise<Round> {
    return emitWithAck<typeof WS_EVENTS.START_NEW_ROUND, Round>(
      requireSocket(),
      WS_EVENTS.START_NEW_ROUND,
      { deckType, fromRoundId: round.value?.id ?? null },
    );
  }

  async function updateLinks(links: {
    jiraUrl?: string | null;
    confluenceUrl?: string | null;
  }): Promise<void> {
    const current = round.value;
    await emitWithAck<typeof WS_EVENTS.UPDATE_LINKS, null>(
      requireSocket(),
      WS_EVENTS.UPDATE_LINKS,
      { ...links, roundId: current?.id ?? null, version: current?.linksVersion ?? null },
    );
  }

  return {
    state,
    participantId,
    connected,
    room,
    round,
    participants,
    result,
    isScrumMaster,
    applyState,
    join,
    leave,
    submitVote,
    revealCards,
    startNewRound,
    updateLinks,
  };
});
