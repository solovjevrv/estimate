/** Общие типы и контракты, используемые фронтендом и бэкендом. */

/** События, которые клиент отправляет серверу */
export const WS_EVENTS = {
  JOIN_ROOM: 'join_room',
  SUBMIT_VOTE: 'submit_vote',
  REVEAL_CARDS: 'reveal_cards',
  START_NEW_ROUND: 'start_new_round',
  UPDATE_LINKS: 'update_links',
  START_TIMER: 'start_timer',
  PAUSE_TIMER: 'pause_timer',
  RESET_TIMER: 'reset_timer',
  KICK_PARTICIPANT: 'kick_participant',
  SEND_REACTION: 'send_reaction',
} as const;

export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/**
 * События сервера. Состояние комнаты рассылается целиком: комнаты небольшие,
 * а один снимок исключает расхождения между участниками.
 */
export const WS_SERVER_EVENTS = {
  ROOM_STATE: 'room_state',
  /**
   * Адресное событие только исключённому — перед `disconnect`. Без него клиент
   * не отличил бы кик от разрыва из-за протухшего токена (7.7) и тихо
   * переподключился бы обратно тем же обработчиком.
   */
  KICKED: 'kicked',
} as const;

export type WsServerEvent = (typeof WS_SERVER_EVENTS)[keyof typeof WS_SERVER_EVENTS];

/** OAuth-провайдеры, через которых можно войти */
export type AuthProvider = 'google' | 'yandex';

export const AUTH_PROVIDERS: readonly AuthProvider[] = ['google', 'yandex'];

/** Публичный профиль авторизованного пользователя (отдаётся фронту) */
export interface AuthUser {
  id: string;
  provider: AuthProvider;
  email: string;
  name: string;
  jobTitle: string | null;
  avatarUrl: string | null;
}

/** Ограничения полей профиля, редактируемых пользователем (задача 9.2) */
export const USER_NAME_MAX_LENGTH = 60;
export const USER_JOB_TITLE_MAX_LENGTH = 100;

/** Роли участника внутри команды. Администраторов может быть несколько — все равны в правах. */
export type TeamRole = 'admin' | 'member' | 'guest';

/** Роли от старшей к младшей: право старшей роли включает права всех младших */
export const TEAM_ROLES: readonly TeamRole[] = ['admin', 'member', 'guest'];

/** Чем меньше вес, тем больше прав */
const TEAM_ROLE_WEIGHT: Record<TeamRole, number> = { admin: 0, member: 1, guest: 2 };

/** Хватает ли роли `role` там, где требуется не ниже `required` */
export function hasTeamRole(role: TeamRole, required: TeamRole): boolean {
  return TEAM_ROLE_WEIGHT[role] <= TEAM_ROLE_WEIGHT[required];
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
}

/** Команда в списке пользователя — вместе с его ролью в ней */
export interface TeamWithRole extends Team {
  role: TeamRole;
  /** Сколько всего участников в команде (не только видимых текущему пользователю) */
  memberCount: number;
}

/** Участник команды: профиль пользователя + роль */
export interface TeamMember {
  userId: string;
  name: string;
  /** Гостям команды адреса участников не показываются */
  email?: string;
  avatarUrl: string | null;
  role: TeamRole;
  joinedAt: string;
}

/** Данные участника для его собственной страницы (10.14) — то же, что видно на «Мой профиль» */
export interface TeamMemberProfile extends TeamMember {
  provider: AuthProvider;
  jobTitle: string | null;
}

/** Загрузка аватарки (10.15) — верхняя граница исходника до пережатия и допустимые типы файла */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Ограничения на название команды */
export const TEAM_NAME_MIN_LENGTH = 1;
export const TEAM_NAME_MAX_LENGTH = 80;

/** Роли участника внутри комнаты */
export type RoomRole = 'scrum_master' | 'voter';

/** Типы колод для оценки */
export type DeckType = 'fibonacci' | 'scale_0_5' | 'tshirt';

export const DECK_TYPES: readonly DeckType[] = ['fibonacci', 'scale_0_5', 'tshirt'];

export const FIBONACCI_DECK: readonly number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

export const SCALE_0_5_DECK: readonly number[] = [0, 1, 2, 3, 4, 5];

/**
 * Футболочные размеры хранятся и голосуются как числа (вес по шкале Фибоначчи) —
 * так среднее/подсчёты остаются числовыми, а размер лишь подпись поверх числа.
 */
export const TSHIRT_LABELS: readonly string[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const TSHIRT_DECK: readonly number[] = [1, 2, 3, 5, 8, 13];

/** Подпись размера для числа из TSHIRT_DECK; для прочих чисел — само число */
export function tshirtLabel(value: number): string {
  const index = TSHIRT_DECK.indexOf(value);
  return index === -1 ? String(value) : (TSHIRT_LABELS[index] ?? String(value));
}

/** Допустимые числа по каждой колоде — по нему проверяется голос и строится стол */
export const DECK_CARDS: Record<DeckType, readonly number[]> = {
  fibonacci: FIBONACCI_DECK,
  scale_0_5: SCALE_0_5_DECK,
  tshirt: TSHIRT_DECK,
};

/** Статусы комнаты и раунда */
export type RoomStatus = 'active' | 'closed';
export type RoundStatus = 'voting' | 'revealed';

export interface Room {
  id: string;
  /** Комната может существовать без команды — тогда null */
  teamId: string | null;
  creatorId: string | null;
  name: string;
  status: RoomStatus;
  /**
   * Номер изменения стола: растёт при каждом действии. Рассылки идут
   * параллельно и могут обогнать друг друга — по нему клиент отличает
   * свежий снимок от отставшего.
   */
  revision: number;
  createdAt: string;
  /** Заполнено — комната в архиве: доступна только для чтения, не в основных списках */
  archivedAt: string | null;
  /** Комната заводится под одну задачу — ссылки принадлежат ей, не отдельному раунду (7.25) */
  jiraUrl: string | null;
  confluenceUrl: string | null;
  /** Версия ссылок: растёт с каждой правкой, по ней ловятся одновременные правки */
  linksVersion: number;
}

export interface Round {
  id: string;
  roomId: string;
  /** Порядковый номер раунда внутри комнаты, начиная с 1 */
  seq: number;
  deckType: DeckType;
  status: RoundStatus;
  /** Средний балл, зафиксированный при вскрытии карт */
  average: number | null;
  createdAt: string;
  revealedAt: string | null;
}

/**
 * Публичная личность участника за столом — общий костяк для клиентского
 * `Participant` и серверного `ParticipantIdentity` (7.33): поля выносятся сюда,
 * а не дублируются в обоих местах, чтобы не разойтись при будущих правках.
 */
export interface ParticipantProfile {
  /** id пользователя либо сессионный id гостя */
  participantId: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  role: RoomRole;
}

/** Участник за столом: авторизованный пользователь или гость на один сеанс */
export interface Participant extends ParticipantProfile {
  /** Проголосовал ли в текущем раунде; сама оценка до вскрытия не видна */
  hasVoted: boolean;
}

/** Оценка, видимая всем после вскрытия карт */
export interface RevealedVote {
  participantId: string;
  name: string;
  value: number;
}

/** Итоги раунда: считаются при вскрытии карт */
export interface RoundResult {
  /** Для колоды футболочных размеров среднее не считается — null */
  average: number | null;
  min: number;
  max: number;
  /** Доля проголосовавших за самое частое значение, 0–100 */
  agreement: number;
  votes: RevealedVote[];
}

/** Один прошлый раунд комнаты (вскрытый) вместе со своими итогами — для истории на странице комнаты */
export interface RoundHistoryEntry {
  round: Round;
  result: RoundResult;
}

/**
 * Агрегированная статистика по всем комнатам пользователя (архивным и активным
 * вместе — тем же набором, что отдаёт `GET /api/rooms`) — для «Мои комнаты».
 */
export interface RoomStats {
  /** Вскрытых раундов по всем комнатам */
  roundsPlayed: number;
  /** Комнат (задач) хотя бы с одним вскрытым раундом — комната заводится под одну задачу (7.25) */
  tasksEstimated: number;
  /** Среднее время от старта раунда до вскрытия карт, секунды; null — вскрытых раундов ещё не было */
  avgRoundDurationSec: number | null;
}

/**
 * Общий таймер обсуждения раунда. Живёт в памяти процесса на комнату (как
 * присутствие участников), а не в базе — это сиюминутное состояние стола.
 * Пока идёт отсчёт, `endsAt` — абсолютный момент истечения: клиент считает
 * оставшееся время сам, сверяясь с ним, а не ждёт тиков от сервера каждую секунду.
 */
export interface RoomTimerState {
  durationSec: number;
  running: boolean;
  /** ISO-момент, когда таймер дойдёт до нуля; null — когда на паузе или сброшен */
  endsAt: string | null;
  /** Остаток в секундах на момент паузы/сброса; во время отсчёта не обновляется — считается от endsAt */
  remainingSec: number;
}

/** Пресеты длительности на выбор — свободный ввод не делаем, чтобы не проверять диапазон */
export const TIMER_DURATION_PRESETS_SEC: readonly number[] = [300, 600, 900];
export const TIMER_DEFAULT_DURATION_SEC = 300;

export interface ResetTimerPayload {
  /** Новая длительность из пресетов; без поля — сброс на текущую длительность */
  durationSec?: number;
}

/** Фиксированный набор эмодзи-реакций (10.10) — свободный выбор эмодзи не делаем */
export const REACTION_EMOJIS = [
  '👍',
  '👎',
  '😲',
  '😐',
  '😂',
  '😢',
  '🤔',
  '🔥',
  '😱',
  '🙄',
  '🎉',
  '💯',
  '🤯',
  '🙌',
  '😅',
  '🚀',
  '👀',
  '🧐',
  '☕',
  '🐢',
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/**
 * Реакция одного участника на карточку другого. Живёт в памяти процесса на
 * комнату (как таймер/присутствие), а не в базе — сбрасывается с новым раундом.
 * Одна пара (from, to) может держать только одну активную реакцию — новая
 * реакцию от того же автора тому же адресату заменяет предыдущую.
 */
export interface Reaction {
  fromParticipantId: string;
  toParticipantId: string;
  emoji: ReactionEmoji;
}

export interface SendReactionPayload {
  targetParticipantId: string;
  emoji: ReactionEmoji;
}

/** Полный снимок комнаты — то, что видит участник */
export interface RoomState {
  room: Room;
  round: Round | null;
  participants: Participant[];
  /** Заполняется только после вскрытия карт */
  result: RoundResult | null;
  timer: RoomTimerState;
  reactions: Reaction[];
}

export interface JoinRoomPayload {
  roomId: string;
  /** Имя гостя на один сеанс; авторизованным не нужно */
  guestName?: string;
  /**
   * Подписанный токен гостя из прошлого захода — чтобы не потерять свой голос
   * при переподключении. Хранить как секрет: идентификатор участника публичен,
   * а токен подтверждает личность.
   */
  guestToken?: string;
}

export interface JoinRoomResult {
  state: RoomState;
  /** Возвращается гостю: сохранить и прислать при переподключении */
  guestToken: string | null;
  participantId: string;
}

export interface SubmitVotePayload {
  value: number;
  /**
   * Раунд, за который голосуют. Если стол успел уйти вперёд, оценка не попадёт
   * в чужую задачу — участник получит отказ. Без поля проверки нет.
   */
  roundId?: string | null;
}

export interface RevealCardsPayload {
  /**
   * Раунд, карты которого вскрывают. Пока команда ждала очереди, скрам-мастер
   * мог начать следующую задачу — её карты вскрывать рано. Без поля проверки нет.
   */
  roundId?: string | null;
}

export interface StartRoundPayload {
  deckType: DeckType;
  /**
   * Раунд, который клиент видел текущим (null — если раунда ещё не было).
   * Если стол уже ушёл вперёд, сервер вернёт текущий раунд вместо нового:
   * так двойной клик и два скрам-мастера не создадут лишних раундов.
   */
  fromRoundId?: string | null;
}

export interface KickParticipantPayload {
  participantId: string;
}

export interface UpdateLinksPayload {
  jiraUrl?: string | null;
  confluenceUrl?: string | null;
  /**
   * Версия ссылок, которую видел клиент. Если за это время их поменял кто-то
   * другой, правка отклоняется — иначе чужой текст молча затрётся.
   * Без поля (или с null) версия не проверяется: побеждает последний.
   */
  version?: number | null;
}

/** Ответ на событие: либо данные, либо ошибка с тем же кодом, что и в REST */
export type WsAck<T> = { ok: true; data: T } | { ok: false; error: string; message: string };

/** Максимальная длина имени гостя и названия комнаты */
export const ROOM_NAME_MAX_LENGTH = 120;
export const GUEST_NAME_MAX_LENGTH = 60;

/**
 * Доски (Epic 12+) — простой холст для брейншторма/планирования/ретро, по
 * образцу Miro. Командные (`teamId` заполнен) и личные (`teamId: null`),
 * аналогично комнатам (7.25). Набор типов элементов растёт по мере эпиков
 * (12.6 стикеры, 12.7 фигуры, 13.х текст/картинки/эмодзи) — новый тип не
 * требует миграции схемы благодаря дискриминированному union по `type`.
 */
export type BoardItemType = 'sticky' | 'shape';
export const BOARD_ITEM_TYPES: readonly BoardItemType[] = ['sticky', 'shape'];

export type BoardShapeKind = 'rectangle' | 'rounded' | 'ellipse' | 'diamond';
export const BOARD_SHAPE_KINDS: readonly BoardShapeKind[] = [
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
];

/**
 * Белый список цветов для стикеров/фигур/стрелок: `style`, присланный клиентом,
 * никогда не льётся в CSS напрямую — сервер принимает только токен из этого списка.
 */
export const BOARD_COLOR_TOKENS = [
  'yellow',
  'green',
  'blue',
  'pink',
  'purple',
  'orange',
  'gray',
] as const;
export type BoardColorToken = (typeof BOARD_COLOR_TOKENS)[number];

export const BOARD_TITLE_MIN_LENGTH = 1;
export const BOARD_TITLE_MAX_LENGTH = 120;
export const BOARD_ITEM_TEXT_MAX_LENGTH = 2000;
/** Потолок элементов на доску — защита от неограниченно растущего снимка (12.1) */
export const BOARD_MAX_ITEMS = 2000;

export interface BoardStickyContent {
  type: 'sticky';
  text: string;
}

export interface BoardShapeContent {
  type: 'shape';
  shape: BoardShapeKind;
  text: string;
}

/** Дискриминированный union по `type` — новый тип элемента не требует миграции схемы */
export type BoardItemContent = BoardStickyContent | BoardShapeContent;

export interface BoardItemStyle {
  color: BoardColorToken;
}

export interface BoardItem {
  id: string;
  boardId: string;
  /** Родитель во фрейме/группе (14.3) — пока всегда null */
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Поворот в градусах — заложено заранее, UI появится позже */
  rotation: number;
  /** Порядок наложения: больше — выше */
  zIndex: number;
  content: BoardItemContent;
  style: BoardItemStyle;
  createdBy: string | null;
  updatedAt: string;
}

export type BoardEdgeLineKind = 'straight' | 'curved';

export interface BoardEdgeStyle {
  color: BoardColorToken;
  line: BoardEdgeLineKind;
}

export interface BoardEdge {
  id: string;
  boardId: string;
  sourceItemId: string;
  targetItemId: string;
  /** null — floating edge: конец цепляется к ближайшей стороне карточки (12.8) */
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string | null;
  style: BoardEdgeStyle;
}

export type BoardStatus = 'active' | 'archived';

export interface Board {
  id: string;
  /** Личная доска — null, командная — id команды (аналогично rooms.teamId, 7.25) */
  teamId: string | null;
  ownerId: string | null;
  title: string;
  status: BoardStatus;
  /** Номер изменения доски: растёт при каждой операции (12.4), по нему клиент отбрасывает отставшие рассылки */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** Доска в списке — без содержимого, для «Мои доски»/страницы команды */
export interface BoardSummary extends Board {
  itemCount: number;
}

/** Полный снимок доски — элементы и связи разом, для открытия страницы доски */
export interface BoardSnapshot {
  board: Board;
  items: BoardItem[];
  edges: BoardEdge[];
}
