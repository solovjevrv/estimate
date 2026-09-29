/** Общие типы и контракты, используемые фронтендом и бэкендом. */

import type { BoardAccessLevel } from './permissions';
import type { BoardEdge, BoardItem, BoardSnapshot } from './entities';
import type { BoardOp } from './operations';

/**
 * Реалтайм-канал доски (12.4). Клиент отправляет операции — сервер их
 * применяет транзакционно, инкрементирует `revision` и рассылает всем
 * участникам целиком, включая отправителя (эхо своей же операции клиент
 * отбрасывает по `clientOpId`). В отличие от комнат, где рассылается целиком
 * `RoomState`, здесь протокол — дискретные операции: доска может расти до
 * `BOARD_MAX_ITEMS` элементов, и пересылать её целиком на каждый чих
 * неэкономно. Id новых элементов/связей генерирует клиент (UUID) — так ack
 * не нужен для подстановки «настоящего» id вместо временного.
 */
export const BOARD_WS_EVENTS = {
  JOIN: 'board:join',
  APPLY: 'board:apply',
  AWARENESS: 'board:awareness',
} as const;

export type BoardWsEvent = (typeof BOARD_WS_EVENTS)[keyof typeof BOARD_WS_EVENTS];

export const BOARD_WS_SERVER_EVENTS = {
  /** Подтверждённые операции — рассылается всем в комнате доски, включая отправителя */
  OPS: 'board:ops',
  /** Курсоры/перетаскивание — не персистится, ретранслируется всем, кроме отправителя */
  AWARENESS: 'board:awareness',
  /** Кто сейчас смотрит доску — на вход/выход участника */
  PRESENCE: 'board:presence',
} as const;

export type BoardWsServerEvent =
  (typeof BOARD_WS_SERVER_EVENTS)[keyof typeof BOARD_WS_SERVER_EVENTS];

export interface JoinBoardPayload {
  boardId: string;
  sinceRevision?: number;
  /** Имя гостя на один сеанс; авторизованным не нужно */
  guestName?: string;
  /** Токен гостя из прошлого захода — переподключение в ту же доску без потери участника */
  guestToken?: string;
}

/**
 * Закоммиченная операция — то, что уходит в рассылку/буфер/догон. В отличие
 * от `BoardOp`, который присылает клиент, здесь create/patch несут уже
 * целиком собранную запись (`item`/`edge`) с серверными полями
 * (`boardId`/`createdBy`/`updatedAt`), а не патч, который клиенту пришлось бы
 * мержить самому — так применение на стороне других участников сводится
 * к простому upsert/delete по id, без реконструкции состояния.
 */
export type BoardCommittedOp =
  | { type: 'item.create'; clientOpId: string; item: BoardItem }
  | { type: 'item.patch'; clientOpId: string; item: BoardItem }
  | { type: 'item.delete'; clientOpId: string; id: string }
  | { type: 'edge.create'; clientOpId: string; edge: BoardEdge }
  | { type: 'edge.patch'; clientOpId: string; edge: BoardEdge }
  | { type: 'edge.delete'; clientOpId: string; id: string };

/** Один закоммиченный батч операций — то же, что уходит и в рассылку, и в кольцевой буфер */
export interface BoardOpsBatch {
  revision: number;
  ops: BoardCommittedOp[];
}

export interface JoinBoardResult {
  revision: number;
  /** Полный снимок — при первом входе или если `sinceRevision` вышла за пределы буфера */
  snapshot: BoardSnapshot | null;
  /** Догон операциями — заполнено вместо `snapshot`, если буфер покрывает разрыв */
  catchup: BoardOpsBatch[] | null;
  /** Доступ ЭТОГО вызывающего к доске — источник для canManage/canEdit на клиенте */
  access: BoardAccessLevel;
  participantId: string;
  /** Возвращается гостю: сохранить и прислать при переподключении */
  guestToken: string | null;
}

export interface ApplyBoardOpsPayload {
  ops: BoardOp[];
}

export interface ApplyBoardOpsResult {
  revision: number;
}

export type BoardAwarenessKind = 'cursor' | 'drag' | 'idle' | 'editing' | 'camera';

/** Данные kind:'camera' в BoardAwarenessPayload.data / BoardAwarenessBroadcast.data */
export interface BoardCameraAwarenessData {
  x: number;
  y: number;
  zoom: number;
}

/** Сервер не заглядывает внутрь `data` — только ретранслирует остальным участникам доски */
export interface BoardAwarenessPayload {
  kind: BoardAwarenessKind;
  data: Record<string, unknown>;
}

export interface BoardAwarenessBroadcast {
  participantId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  kind: BoardAwarenessKind;
  data: Record<string, unknown>;
}

/**
 * Кто сейчас смотрит доску. userId — участник вебсокета: реальный id пользователя
 * или сессионный id гостя (14.4), не обязательно строка из таблицы users.
 * participantId — стабильный ключ участника (14.5): id пользователя либо сессионный
 * id гостя, по нему выводятся курсоры/presence и сквозит через awareness/presence.
 */
export interface BoardPresenceEntry {
  participantId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
}
