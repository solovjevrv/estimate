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
export type BoardItemType = 'sticky' | 'shape' | 'text' | 'image' | 'emoji';
export const BOARD_ITEM_TYPES: readonly BoardItemType[] = [
  'sticky',
  'shape',
  'text',
  'image',
  'emoji',
];

export type BoardShapeKind = 'rectangle' | 'rounded' | 'ellipse' | 'diamond';
export const BOARD_SHAPE_KINDS: readonly BoardShapeKind[] = [
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
];

/**
 * Цвет стикера/фигуры/связи (12.7) — hex-строка `#RRGGBB`, а не токен из
 * белого списка: пользователь может выбрать произвольный цвет, не только
 * из предложенной палитры. Сервер валидирует не членство в списке, а сам
 * формат строгим regex'ом (`boards/board-ops.ts`) — `#RRGGBB` физически не
 * может нести ничего, кроме шести hex-цифр, так что инъекции через это поле
 * не более возможны, чем при белом списке токенов.
 */
export const BOARD_COLOR_HEX_PATTERN = /^#[0-9a-f]{6}$/i;
export type BoardColorHex = string;

/** Предложенные свотчи в UI (палитра выбора) — не белый список для валидации */
export const BOARD_COLOR_PALETTE: readonly BoardColorHex[] = [
  '#FFFFFF',
  '#FCEB96',
  '#FCE269',
  '#FCB97D',
  '#D4E98C',
  '#B6E565',
  '#60D878',
  '#69DFCD',
  '#FFB8E8',
  '#FFA3E8',
  '#B4A7FA',
  '#FF9595',
  '#A8CAFF',
  '#8FE3FF',
  '#7DA9F6',
  '#1A1A1A',
];

export const BOARD_TITLE_MIN_LENGTH = 1;
export const BOARD_TITLE_MAX_LENGTH = 120;
export const BOARD_ITEM_TEXT_MAX_LENGTH = 2000;
/** Подпись связи (12.8) — короткая аннотация на стрелке, не текст целого стикера */
export const BOARD_EDGE_LABEL_MAX_LENGTH = 200;
/** Потолок элементов на доску — защита от неограниченно растущего снимка (12.1) */
export const BOARD_MAX_ITEMS = 2000;
/** Верхняя граница модуля координаты (x/y) элемента доски — защита от переполнения при рендере */
export const BOARD_ITEM_MAX_COORDINATE = 1_000_000;
/** Верхняя граница ширины/высоты элемента доски */
export const BOARD_ITEM_MAX_SIZE = 10_000;
/** Картинки на доске (13.2) — максимальный размер исходного файла перед пережатием (8 МБ) */
export const BOARD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Допустимые MIME-типы для загрузки картинок на доску (JPEG, PNG, WebP, GIF) */
export const BOARD_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
/** Имя файла картинки доски — только случайный hex (см. BoardImagesService), никогда не из пользовательского ввода */
const BOARD_IMAGE_FILENAME_RE = /^[a-f0-9]{32}\.webp$/;

/** Строит относительный URL для отдачи через GET /api/boards/:id/assets/:filename (13.2) */
export function boardImageUrl(boardId: string, filename: string): string {
  return `/api/boards/${boardId}/assets/${filename}`;
}

/**
 * Проверяет, что url — это путь ИМЕННО к картинке этой доски, а не произвольная
 * строка под /api/boards/ (защита от SSRF/XSS через content.url и от подмены
 * картинки чужой доски).
 */
export function isBoardImageUrl(boardId: string, url: string): boolean {
  const prefix = boardImageUrl(boardId, '');
  return url.startsWith(prefix) && BOARD_IMAGE_FILENAME_RE.test(url.slice(prefix.length));
}

/**
 * Маркер-цвет выделения текста (12.13) — токен из фиксированной небольшой
 * палитры, не свободный hex (в отличие от заливки/цвета текста): попроще
 * UI-выбор для частого действия, и валидация — членство в списке, а не regex.
 */
export type BoardHighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
export const BOARD_HIGHLIGHT_COLORS: readonly BoardHighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
];

/**
 * Ссылка внутри текста (12.13) — только http(s), тот же принцип, что и у
 * ссылок Jira/Confluence комнаты (5.6, `rooms.service.ts#normalizeLink`), но
 * это НЕ общий источник правды — там независимый regex-литерал с тем же
 * смыслом, не импорт отсюда (разные домены: комната и доска не делят код).
 */
export const BOARD_TEXT_LINK_MAX_LENGTH = 500;
export const BOARD_TEXT_LINK_PATTERN = /^https?:\/\//i;

/**
 * Начертание фрагмента текста (12.13) — применяется не ко всему блоку текста
 * стикера/фигуры (это `BoardItemStyle`), а к диапазону символов внутри него
 * (`BoardTextRun.marks`), поэтому в одном стикере можно выделить жирным одно
 * слово. Каждое поле — самостоятельный булев/значимый тумблер, не CSS.
 */
export interface BoardTextMark {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: BoardHighlightColor;
  /** `http(s)://...`, см. `BOARD_TEXT_LINK_PATTERN` */
  link?: string;
}

/**
 * Один непрерывный фрагмент текста с одинаковым форматированием — стандартный
 * способ описать «rich text» без хранения сырого HTML (которое пришлось бы
 * рендерить через `v-html` и санитизировать на каждый чих). Конкатенация
 * `text` всех runs обязана совпадать с `BoardStickyContent.text`/
 * `BoardShapeContent.text` — сервер это проверяет (`board-ops.ts`).
 */
export interface BoardTextRun {
  text: string;
  marks?: BoardTextMark;
}

export interface BoardStickyContent {
  type: 'sticky';
  text: string;
  /** Не задано — обычный текст без форматирования (в т.ч. все элементы до 12.13) */
  runs?: BoardTextRun[];
}

export interface BoardShapeContent {
  type: 'shape';
  shape: BoardShapeKind;
  text: string;
  runs?: BoardTextRun[];
}

export interface BoardTextContent {
  type: 'text';
  text: string;
  runs?: BoardTextRun[];
}

export interface BoardImageContent {
  type: 'image';
  url: string;
  width: number;
  height: number;
}

export interface BoardEmojiContent {
  type: 'emoji';
  emoji: ReactionEmoji;
}

/** Дискриминированный union по `type` — новый тип элемента не требует миграции схемы */
export type BoardItemContent =
  BoardStickyContent | BoardShapeContent | BoardTextContent | BoardImageContent | BoardEmojiContent;

/**
 * Начертание текста стикера/фигуры (12.9) — не произвольный CSS font-family,
 * а токен из двух шрифтов, уже загруженных на фронте (`main.css`):
 * `sans` — Manrope (тело, дефолт), `heading` — Sora (акцентный, жирный).
 * Так расширение не требует подгрузки новых веб-шрифтов.
 */
export type BoardFontFamily = 'sans' | 'heading';
export const BOARD_FONT_FAMILIES: readonly BoardFontFamily[] = ['sans', 'heading'];

export type BoardTextAlign = 'left' | 'center' | 'right';
export const BOARD_TEXT_ALIGNS: readonly BoardTextAlign[] = ['left', 'center', 'right'];

/**
 * Границы ручного размера шрифта (12.9). Шире дефолтного диапазона авто-fit
 * (`FIT_FONT_MIN/MAX` = 10–20 в `use-fit-font-size.ts`) — заданное здесь
 * значение служит ВЕРХНЕЙ границей для авто-fit, а не заменяет его: если
 * текста больше, чем помещается при выбранном размере, авто-fit всё равно
 * ужимает шрифт вплоть до `BOARD_ITEM_FONT_SIZE_MIN`.
 */
export const BOARD_ITEM_FONT_SIZE_MIN = 10;
export const BOARD_ITEM_FONT_SIZE_MAX = 48;

export interface BoardItemStyle {
  color: BoardColorHex;
  /** Верхняя граница авто-fit; не задано — используется дефолт авто-fit (20px) */
  fontSize?: number;
  /** Не задано — `sans` (Manrope, как было до 12.9) */
  fontFamily?: BoardFontFamily;
  /** Цвет текста отдельно от заливки; не задано — автоконтраст от `color` (`readableTextColor`) */
  textColor?: BoardColorHex;
  /** Не задано — `center` (как было до 12.9) */
  textAlign?: BoardTextAlign;
}

/**
 * Реакция-эмодзи на стикере (12.12) — персистентная, в отличие от эфемерных
 * комнатных (`Reaction`, живут только в памяти процесса на раунд). Имя
 * денормализовано прямо в запись: у доски нет постоянного ростера всех, кто
 * когда-либо был на ней (только live-присутствие, `BoardPresence`), так что
 * подтянуть имя отключившегося автора позже неоткуда без отдельного запроса.
 */
export interface ItemReaction {
  userId: string;
  name: string;
  emoji: ReactionEmoji;
}

/**
 * Один пользователь — одна реакция на элемент; повторная присылка того же
 * эмодзи снимает её. Чистая функция без побочных эффектов — используется и
 * сервером (авторитетно, под блокировкой строки доски), и клиентом
 * (оптимистичное предсказание результата до ответа сервера), чтобы не
 * дублировать логику и не разойтись в двух местах.
 */
export function toggleItemReaction(
  reactions: ItemReaction[],
  userId: string,
  name: string,
  emoji: ReactionEmoji,
): ItemReaction[] {
  const existing = reactions.find((r) => r.userId === userId);
  const withoutExisting = reactions.filter((r) => r.userId !== userId);
  return existing?.emoji === emoji
    ? withoutExisting
    : [...withoutExisting, { userId, name, emoji }];
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
  /** Реакции-эмодзи (12.12) — только на стикерах (`content.type === 'sticky'`), не на фигурах */
  reactions: ItemReaction[];
  createdBy: string | null;
  updatedAt: string;
}

export type BoardEdgeLineKind = 'straight' | 'orthogonal' | 'curved';
export const BOARD_EDGE_LINE_KINDS: readonly BoardEdgeLineKind[] = [
  'straight',
  'orthogonal',
  'curved',
];

export type BoardEdgeMarker = 'none' | 'arrow' | 'dot';
export const BOARD_EDGE_MARKER_KINDS: readonly BoardEdgeMarker[] = ['none', 'arrow', 'dot'];

export interface BoardEdgeStyle {
  /**
   * Не задан — цвет вычисляется у каждого зрителя от ЕГО ТЕКУЩЕЙ темы (12.9,
   * см. `resolveEdgeColor` в `lib/board/board-item-defaults.ts` на фронте):
   * до этой правки цвет по умолчанию фиксировался на теме АВТОРА в момент
   * создания и хранился как обычный hex — стрелка, созданная в тёмной теме,
   * оставалась белой (и невидимой) и для тех, кто смотрит доску в светлой.
   * Как только пользователь явно выбирает цвет в тулбаре (палитра/кастомный
   * пикер) — сюда пишется конкретный hex и с этого момента он не зависит от
   * темы ни у кого, включая автора.
   */
  color?: BoardColorHex;
  line: BoardEdgeLineKind;
  markerStart: BoardEdgeMarker;
  markerEnd: BoardEdgeMarker;
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

interface BoardOpBase {
  /** id операции с клиента — по нему клиент отличает подтверждение своей же операции от чужой */
  clientOpId: string;
}

/** Id элемента генерирует клиент (UUID) — сервер просто сохраняет его как есть */
export interface BoardItemCreateOp extends BoardOpBase {
  type: 'item.create';
  item: Omit<BoardItem, 'boardId' | 'createdBy' | 'updatedAt'>;
}

export interface BoardItemPatchOp extends BoardOpBase {
  type: 'item.patch';
  id: string;
  patch: Partial<
    Omit<BoardItem, 'id' | 'boardId' | 'createdBy' | 'updatedAt' | 'style' | 'reactions'>
  > & {
    /** Партиал, не целиком (12.9) — мержится поверх текущего style, а не заменяет его */
    style?: Partial<BoardItemStyle>;
  };
}

export interface BoardItemDeleteOp extends BoardOpBase {
  type: 'item.delete';
  id: string;
}

/**
 * Реакция-тоггл (12.12) — отдельный op, не поле `item.patch`: `emoji` сам по
 * себе не говорит, добавить реакцию или снять — решает СЕРВЕР, авторитетно
 * сравнивая с уже стоящей реакцией автора на этот элемент (под той же
 * блокировкой строки доски, что и остальные операции батча). Если бы это было
 * полем в `patch`, клиент мог бы прислать произвольный итоговый список и
 * обойти toggle-логику.
 */
export interface BoardItemReactOp extends BoardOpBase {
  type: 'item.react';
  id: string;
  emoji: ReactionEmoji;
}

export interface BoardEdgeCreateOp extends BoardOpBase {
  type: 'edge.create';
  edge: Omit<BoardEdge, 'boardId'>;
}

/** Переподключить связь к другим элементам — не нужно: проще удалить и создать заново */
export interface BoardEdgePatchOp extends BoardOpBase {
  type: 'edge.patch';
  id: string;
  patch: Partial<Pick<BoardEdge, 'sourceHandle' | 'targetHandle' | 'label'>> & {
    style?: Partial<BoardEdgeStyle>;
  };
}

export interface BoardEdgeDeleteOp extends BoardOpBase {
  type: 'edge.delete';
  id: string;
}

/** Дискриминированный union по `type` — та же идея, что у `BoardItemContent` */
export type BoardOp =
  | BoardItemCreateOp
  | BoardItemPatchOp
  | BoardItemDeleteOp
  | BoardItemReactOp
  | BoardEdgeCreateOp
  | BoardEdgePatchOp
  | BoardEdgeDeleteOp;

/** Верхняя граница числа операций в одном вызове `board:apply` — защита от гигантского батча */
export const BOARD_OPS_BATCH_MAX = 50;
/** Сколько последних батчей операций держим в памяти на доску — догон дальше не работает */
export const BOARD_RING_BUFFER_SIZE = 200;

export interface JoinBoardPayload {
  boardId: string;
  /** Ревизия, которую клиент уже применил — если укладывается в буфер, придёт только «хвост» */
  sinceRevision?: number;
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
}

export interface ApplyBoardOpsPayload {
  ops: BoardOp[];
}

export interface ApplyBoardOpsResult {
  revision: number;
}

export type BoardAwarenessKind = 'cursor' | 'drag' | 'idle';

/** Сервер не заглядывает внутрь `data` — только ретранслирует остальным участникам доски */
export interface BoardAwarenessPayload {
  kind: BoardAwarenessKind;
  data: Record<string, unknown>;
}

export interface BoardAwarenessBroadcast {
  userId: string;
  name: string;
  kind: BoardAwarenessKind;
  data: Record<string, unknown>;
}

/** Кто сейчас смотрит доску — доски не поддерживают гостей, участник всегда авторизован */
export interface BoardPresenceEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
}
