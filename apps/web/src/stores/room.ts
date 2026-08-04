/**
 * Стол комнаты: соединение по вебсокету, снимок состояния и действия участника.
 * Сервер рассылает состояние целиком, поэтому стор ничего не досчитывает —
 * он лишь отбрасывает снимки, которые пришли позже свежих.
 */
import type {
  DeckType,
  JoinRoomResult,
  Participant,
  Reaction,
  ReactionEmoji,
  RoomState,
  RoomTimerState,
  Round,
  RoundResult,
} from '@poker/shared';
import { TIMER_DEFAULT_DURATION_SEC, WS_EVENTS, WS_SERVER_EVENTS } from '@poker/shared';
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
  /** Скрам-мастер исключил из комнаты именно этого участника — ставит UI на паузу для редиректа */
  const kickedOut = ref(false);

  let socket: PokerSocket | null = null;
  /** Куда входим: держим отдельно, чтобы восстановить место за столом после реконнекта */
  let target: { roomId: string; guestName?: string } | null = null;
  /** Прошёл ли первый успешный вход — по нему отличаем реконнект от начального подключения */
  let established = false;
  /**
   * Растёт при каждом `join()`/`leave()`: `performJoin` сверяет его после ожидания
   * ответа сервера и не применяет результат, если за это время успели выйти или
   * запросить другой вход — иначе висящий вход мог бы подменить участника и стол
   * уже после того, как пользователь ушёл из комнаты.
   */
  let joinToken = 0;

  const room = computed(() => state.value?.room ?? null);
  const round = computed<Round | null>(() => state.value?.round ?? null);
  const participants = computed<Participant[]>(() => state.value?.participants ?? []);
  const result = computed<RoundResult | null>(() => state.value?.result ?? null);
  const reactions = computed<Reaction[]>(() => state.value?.reactions ?? []);
  const timer = computed<RoomTimerState>(
    () =>
      state.value?.timer ?? {
        durationSec: TIMER_DEFAULT_DURATION_SEC,
        running: false,
        endsAt: null,
        remainingSec: TIMER_DEFAULT_DURATION_SEC,
      },
  );
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
    const token = joinToken;

    const joined = await emitWithAck<typeof WS_EVENTS.JOIN_ROOM, JoinRoomResult>(
      active,
      WS_EVENTS.JOIN_ROOM,
      {
        roomId: params.roomId,
        guestName: params.guestName,
        guestToken: readGuestToken(params.roomId),
      },
    );

    // Пока ждали ответ, вызвали leave() или новый join() — это уже не наш вход
    if (token !== joinToken) return;

    writeGuestToken(params.roomId, joined.guestToken);
    participantId.value = joined.participantId;
    // Снимок из ответа — такой же, как в рассылке, и проходит ту же проверку
    applyState(joined.state);
  }

  /**
   * Вход в комнату: авторизованного сервер узнает по куке, гость называет имя.
   * `onReconnectFailure` зовётся, если провалился именно автоматический вход
   * после переподключения сокета (а не самый первый) — например, за время,
   * пока вкладка простаивала, протух access-токен: хэндшейк увидит гостя без
   * имени, и без этого коллбэка страница молча осталась бы в подвисшем виде (7.16).
   */
  async function join(
    roomId: string,
    guestName?: string,
    onReconnectFailure?: () => void,
  ): Promise<void> {
    // Смена комнаты на живом сокете: сбрасываем прошлый стол, иначе отставшая
    // рассылка старой комнаты (id другой — проверку revision не проходит) осталась бы на экране
    if (state.value && state.value.room.id !== roomId) {
      state.value = null;
      participantId.value = null;
    }
    kickedOut.value = false;
    target = { roomId, guestName };
    joinToken++;

    socket ??= createSocket();
    const active = socket;

    if (!active.hasListeners(WS_SERVER_EVENTS.ROOM_STATE)) {
      active.on(WS_SERVER_EVENTS.ROOM_STATE, applyState);
      active.on(WS_SERVER_EVENTS.KICKED, () => {
        // Приходит непосредственно перед disconnect — обработчик ниже должен
        // успеть увидеть флаг и не принять кик за протухший токен (7.7)
        kickedOut.value = true;
      });
      active.on('connect', () => {
        connected.value = true;
        // Место за столом на сервере привязано к соединению: после обрыва входим заново.
        // Первый connect не трогаем — вход по нему сделает сам join ниже
        if (established) {
          void performJoin().catch(() => {
            onReconnectFailure?.();
          });
        }
      });
      active.on('disconnect', (reason) => {
        connected.value = false;
        // Сервер рвёт соединение сам, когда access-токен участника истёк (7.7) —
        // единственная причина, на которую socket.io не переподключается сам.
        // Новый хендшейк принесёт свежую куку, а дальше сработает connect выше.
        // Кик скрам-мастером — та же самая причина отказа, но здесь реконнект
        // не нужен: участника исключили осознанно, а не токен истёк сам собой.
        if (reason === 'io server disconnect' && established && !kickedOut.value) {
          active.connect();
        }
      });
    }

    if (!active.connected) {
      active.connect();
    }

    await performJoin();
    established = true;
  }

  function leave(): void {
    joinToken++;
    socket?.disconnect();
    socket = null;
    target = null;
    established = false;
    state.value = null;
    participantId.value = null;
    connected.value = false;
    kickedOut.value = false;
  }

  /**
   * Разрывает сокет, не трогая показанный стол: нужен новый хендшейк (сервер
   * узнаёт личность по куке заново), а не полный выход — тот сбросил бы
   * `state`, и стол на экране на миг пропадал бы, хотя всё это время
   * оставался актуальным. Используется при восстановлении входа после
   * протухшего access-токена (7.7), когда следом сразу вызовут `join()`.
   *
   * `established` тоже сбрасываем: `join()` создаст новый сокет и повесит на
   * него свой обработчик `connect`, который при `established === true` сам
   * дёрнул бы `performJoin()` — тогда после реального подключения выполнились
   * бы два параллельных входа (и от обработчика, и из `join()` явно). Флаг
   * `join()` выставит обратно в `true` сам, как при самом первом входе.
   */
  function resetConnection(): void {
    socket?.disconnect();
    socket = null;
    established = false;
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

  /**
   * Версию по умолчанию берём из живой комнаты, но вызывающий код может прислать
   * снимок версии, на котором основан его черновик: пока черновик редактировался,
   * рассылка могла уже подвинуть версию в сторе вперёд, и живая версия перестаёт
   * отличать «никто не менял» от «кто-то уже сохранил, пока мы печатали» — тогда
   * проверка версии на сервере молча перестаёт защищать от гонки.
   */
  async function updateLinks(links: {
    jiraUrl?: string | null;
    confluenceUrl?: string | null;
    version?: number | null;
  }): Promise<void> {
    const { version, ...fields } = links;
    await emitWithAck<typeof WS_EVENTS.UPDATE_LINKS, null>(
      requireSocket(),
      WS_EVENTS.UPDATE_LINKS,
      {
        ...fields,
        version: version !== undefined ? version : (room.value?.linksVersion ?? null),
      },
    );
  }

  /**
   * Таймер обсуждения: управлять может любой участник (решение 27.07.2026),
   * поэтому прав не проверяем — сервер тоже их не проверяет. Актуальное
   * состояние приходит рассылкой `room_state`, как и у остальных действий стола.
   */
  async function startTimer(): Promise<void> {
    await emitWithAck<typeof WS_EVENTS.START_TIMER, RoomTimerState>(
      requireSocket(),
      WS_EVENTS.START_TIMER,
      {},
    );
  }

  async function pauseTimer(): Promise<void> {
    await emitWithAck<typeof WS_EVENTS.PAUSE_TIMER, RoomTimerState>(
      requireSocket(),
      WS_EVENTS.PAUSE_TIMER,
      {},
    );
  }

  /** Исключить участника из комнаты — доступно только скрам-мастеру, сервер это перепроверяет */
  async function kickParticipant(targetParticipantId: string): Promise<void> {
    await emitWithAck<typeof WS_EVENTS.KICK_PARTICIPANT, null>(
      requireSocket(),
      WS_EVENTS.KICK_PARTICIPANT,
      { participantId: targetParticipantId },
    );
  }

  async function resetTimer(durationSec?: number): Promise<void> {
    await emitWithAck<typeof WS_EVENTS.RESET_TIMER, RoomTimerState>(
      requireSocket(),
      WS_EVENTS.RESET_TIMER,
      { durationSec },
    );
  }

  /**
   * Реакция-эмодзи на карточку другого участника (10.10) — доступна в любой
   * момент раунда, любому участнику на карточку любого другого. Повторная
   * реакция тому же адресату заменяет предыдущую — сервер решает это сам.
   */
  async function sendReaction(targetParticipantId: string, emoji: ReactionEmoji): Promise<void> {
    await emitWithAck<typeof WS_EVENTS.SEND_REACTION, null>(
      requireSocket(),
      WS_EVENTS.SEND_REACTION,
      { targetParticipantId, emoji },
    );
  }

  return {
    state,
    participantId,
    connected,
    kickedOut,
    room,
    round,
    participants,
    result,
    timer,
    reactions,
    isScrumMaster,
    applyState,
    join,
    leave,
    resetConnection,
    submitVote,
    revealCards,
    startNewRound,
    updateLinks,
    startTimer,
    pauseTimer,
    resetTimer,
    kickParticipant,
    sendReaction,
  };
});
