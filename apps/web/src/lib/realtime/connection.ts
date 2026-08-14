import { ref, type Ref } from 'vue';

import { createSocket, type PokerSocket } from '../socket';

/**
 * Что домен знает о собственном входе, а ядро — нет.
 */
export interface JoinContext {
  /**
   * Повторный вход после обрыва, а не первый. Домены пользуются этим по-разному:
   * доска просит догон с последней известной ревизии вместо полного снимка.
   */
  reconnect: boolean;
  /**
   * Ложь, если пока ждали ответ сервера, успели выйти или запросить другой вход.
   * Проверять сразу после `await`: иначе висящий вход подменит участника и стол
   * уже после того, как пользователь ушёл со страницы.
   */
  isCurrent(): boolean;
}

export interface RealtimeConnectionOptions {
  /** Доменные события: вешаются один раз на каждый созданный сокет */
  attach(socket: PokerSocket): void;
  /** Вход в сущность: и первый, и автоматический после переподключения */
  join(socket: PokerSocket, ctx: JoinContext): Promise<void>;
  /**
   * Переподключаться ли, когда соединение разорвал сам сервер. По умолчанию да:
   * это деплой, рестарт или протухший токен — новый хендшейк всё это чинит.
   * Комнаты добавляют исключение: исключённого скрам-мастером возвращать не надо.
   */
  shouldReconnect?(): boolean;
}

export interface RealtimeConnection {
  /** Живо ли соединение прямо сейчас — для индикатора в интерфейсе */
  readonly connected: Ref<boolean>;
  /** Подключает сокет (если надо) и входит. `onReconnectFailure` — только про автоматический вход */
  open(onReconnectFailure?: () => void): Promise<void>;
  /** Полный выход: сокет закрывается, висящие входы обесцениваются */
  close(): void;
  /**
   * Разрывает сокет, не обесценивая состояние домена: нужен новый хендшейк
   * (сервер узнаёт личность по куке заново), а не выход. Следом обязателен
   * `open()` — иначе соединения не останется.
   */
  reset(): void;
  /** Сокет для отправки события; бросает, если соединения ещё нет */
  require(errorMessage: string): PokerSocket;
  /**
   * Сокет или `null` — для эфемерных событий (курсоры), которые без соединения
   * просто не нужны: их некому доставить, и терять нечего.
   */
  current(): PokerSocket | null;
}

/**
 * Общее ядро реалтайм-сессии для комнат и досок.
 *
 * До 19.11 весь этот протокол — ленивое создание сокета, однократная подписка,
 * повторный вход после реконнекта, принудительное переподключение при
 * серверном разрыве и счётчик поколений против гонок — был скопирован в
 * `stores/room.ts` и `stores/board-session.ts` и уже начал расходиться. Правки
 * вроде обработки провала автоматического входа (7.16) приходилось находить и
 * повторять во второй копии вручную.
 */
export function createRealtimeConnection(options: RealtimeConnectionOptions): RealtimeConnection {
  const connected = ref(false);

  let socket: PokerSocket | null = null;
  /** Подписаны ли доменные события на текущий сокет */
  let attached = false;
  /** Прошёл ли первый успешный вход — по нему отличаем реконнект от начального подключения */
  let established = false;
  /** Растёт на каждый `open()`/`close()`: по нему висящий вход понимает, что он уже не актуален */
  let generation = 0;

  function contextFor(reconnect: boolean): JoinContext {
    const issued = generation;
    return { reconnect, isCurrent: () => issued === generation };
  }

  async function open(onReconnectFailure?: () => void): Promise<void> {
    generation++;

    socket ??= createSocket();
    const active = socket;

    if (!attached) {
      attached = true;
      options.attach(active);

      active.on('connect', () => {
        connected.value = true;
        // Место в комнате/на доске на сервере привязано к соединению: после
        // обрыва входим заново. Первый connect не трогаем — вход по нему
        // сделает `open()` ниже.
        //
        // Автоматический вход может и не удаться (протух токен, отозвали
        // доступ, сервер ещё не поднялся). Без `.catch()` это был бы
        // необработанный отказ промиса, а страница молча осталась бы в
        // подвисшем виде — без единого сигнала пользователю (7.16).
        if (established) {
          void options.join(active, contextFor(true)).catch(() => onReconnectFailure?.());
        }
      });

      active.on('disconnect', (reason: string) => {
        connected.value = false;
        // 'io server disconnect' — единственная причина, по которой socket.io не
        // переподключается сам: сервер разорвал соединение намеренно (деплой,
        // рестарт, истёкший access-токен, 7.7). Новый хендшейк принесёт свежую
        // куку, а дальше сработает `connect` выше. В остальных случаях (сеть,
        // таймаут) клиент вытянет себя сам, и вмешиваться не нужно.
        if (reason === 'io server disconnect' && established && shouldReconnect()) {
          active.connect();
        }
      });
    }

    if (!active.connected) {
      active.connect();
    }

    await options.join(active, contextFor(false));
    established = true;
  }

  function shouldReconnect(): boolean {
    return options.shouldReconnect?.() ?? true;
  }

  function close(): void {
    generation++;
    socket?.disconnect();
    socket = null;
    attached = false;
    established = false;
    connected.value = false;
  }

  /**
   * Поколение здесь намеренно не растёт: домен продолжает показывать то же
   * состояние, и висящий вход остаётся его входом. `established` сбрасываем —
   * иначе следующий `open()` повесил бы обработчик `connect`, который при
   * `established === true` сам дёрнул бы вход, и после реального подключения
   * выполнились бы два входа сразу (7.7).
   */
  function reset(): void {
    socket?.disconnect();
    socket = null;
    attached = false;
    established = false;
    connected.value = false;
  }

  function require(errorMessage: string): PokerSocket {
    if (!socket) {
      throw new Error(errorMessage);
    }
    return socket;
  }

  return { connected, open, close, reset, require, current: () => socket };
}
