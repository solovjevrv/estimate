import type {
  BoardEdgeStyle,
  BoardItemContent,
  BoardItemStyle,
  BoardTemplateItem,
  ItemReaction,
} from '@poker/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const authProviderEnum = pgEnum('auth_provider', ['google', 'yandex']);
export const teamRoleEnum = pgEnum('team_role', ['admin', 'member', 'guest']);
export const roomStatusEnum = pgEnum('room_status', ['active', 'closed']);
export const deckTypeEnum = pgEnum('deck_type', ['fibonacci', 'scale_0_5', 'tshirt']);
export const roundStatusEnum = pgEnum('round_status', ['voting', 'revealed']);
export const boardStatusEnum = pgEnum('board_status', ['active', 'archived']);
export const boardShareRoleEnum = pgEnum('board_share_role', ['view', 'edit']);
export const boardTemplateScopeEnum = pgEnum('board_template_scope', [
  'builtin',
  'personal',
  'team',
]);

/**
 * Авторизованные пользователи (OAuth Google/Яндекс).
 * Гости в этой таблице не хранятся — они идентифицируются
 * сессионным id прямо в голосах (votes.guest_session_id).
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: authProviderEnum('provider').notNull(),
    providerId: text('provider_id').notNull(),
    email: text('email').notNull(),
    /** Имя от провайдера — перезаписывается при каждом входе, поэтому правка живёт в display_name */
    name: text('name').notNull(),
    /** Пользовательское переопределение имени; NULL — показываем name от провайдера */
    displayName: text('display_name'),
    /** Должность, вводится свободным текстом — провайдер её не даёт */
    jobTitle: text('job_title'),
    /** Аватар от провайдера — перезаписывается при каждом входе, как и name */
    avatarUrl: text('avatar_url'),
    /** Своя загруженная аватарка (10.15) — override по аналогии с displayName (9.2); NULL — показываем avatarUrl от провайдера */
    avatarOverrideUrl: text('avatar_override_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Правится и входом через провайдера, и правкой профиля (9.2) (7.9) */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Последний успешный вход через провайдера — задел под дашборд команды (3.5) (7.9) */
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_provider_provider_id_idx').on(t.provider, t.providerId)],
);

/**
 * Выданные refresh-токены: одна строка = одна активная сессия. Id строки —
 * это jti внутри refresh-JWT, поэтому обмен токена (или выход) может отозвать
 * ровно эту сессию, не трогая остальные устройства пользователя (7.6).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Совпадает с TTL refresh-токена — по нему можно чистить протухшие строки (7.29) */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

/**
 * team_id nullable: комната может существовать и без команды (личная/публичная).
 * creator_id nullable: при удалении аккаунта создателя комната сохраняется.
 */
export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    creatorId: uuid('creator_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    status: roomStatusEnum('status').notNull().default('active'),
    /** Номер изменения стола: растёт при каждом действии, по нему клиент отбрасывает отставшие рассылки */
    revision: integer('revision').notNull().default(0),
    /** Заполнено — комната в архиве: доступна только для чтения, не в основных списках */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Комната заводится под одну задачу — ссылки принадлежат ей, не отдельному раунду (7.25) */
    jiraUrl: text('jira_url'),
    confluenceUrl: text('confluence_url'),
    /** Версия ссылок для оптимистичной блокировки: растёт с каждой правкой */
    linksVersion: integer('links_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rooms_team_id_idx').on(t.teamId)],
);

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** Порядковый номер раунда внутри комнаты, начиная с 1 */
    seq: integer('seq').notNull(),
    deckType: deckTypeEnum('deck_type').notNull(),
    status: roundStatusEnum('status').notNull().default('voting'),
    /** Средний балл, вычисляется при вскрытии карт */
    average: numeric('average', { precision: 8, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revealedAt: timestamp('revealed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('rounds_room_id_seq_idx').on(t.roomId, t.seq)],
);

/**
 * Голос в раунде. Либо от пользователя (user_id), либо от гостя
 * (guest_session_id + guest_name) — ровно одно из двух, что гарантирует
 * CHECK-констрейнт. Повторное голосование в раунде запрещено частичными
 * уникальными индексами и для пользователей, и для гостей.
 */
export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestSessionId: text('guest_session_id'),
    guestName: text('guest_name'),
    value: integer('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('votes_round_id_idx').on(t.roundId),
    uniqueIndex('votes_round_user_idx')
      .on(t.roundId, t.userId)
      .where(sql`user_id is not null`),
    uniqueIndex('votes_round_guest_idx')
      .on(t.roundId, t.guestSessionId)
      .where(sql`guest_session_id is not null`),
    check('votes_identity_check', sql`(user_id is not null) <> (guest_session_id is not null)`),
    check('votes_guest_name_check', sql`guest_session_id is null or guest_name is not null`),
    check('votes_value_check', sql`value >= 0`),
  ],
);

/**
 * Доска (Epic 12+) — холст для брейншторма/планирования/ретро, по образцу
 * Miro. team_id nullable: доска может быть личной, как и комната (7.25);
 * при удалении команды доска не пропадает, а становится личной владельца
 * (тот же приём, что у rooms.team_id). owner_id nullable по аналогии с
 * rooms.creator_id — удаление аккаунта не должно унести доску команды.
 */
export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    status: boardStatusEnum('status').notNull().default('active'),
    /** Номер изменения доски: растёт с каждой операцией (12.4), по нему клиент отбрасывает отставшие рассылки */
    revision: integer('revision').notNull().default(0),
    /** Ссылка на просмотр/правку (14.4) — null, шаринг выключен по умолчанию */
    shareRole: boardShareRoleEnum('share_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('boards_team_id_idx').on(t.teamId)],
);

/**
 * Элемент на доске (стикер, фигура, ...). `content`/`style` — jsonb с
 * дискриминированным union по `content.type` (см. `@poker/shared`): новый тип
 * элемента не требует миграции схемы, только нового случая в union и валидации
 * на сервере. Именно поэтому `type` не вынесен в отдельный enum-столбец —
 * это сделало бы каждый новый тип элемента миграцией (`ALTER TYPE ... ADD VALUE`),
 * ровно то, чего дискриминированный union должен избежать.
 */
export const boardItems = pgTable(
  'board_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** Родитель во фрейме/группе (14.3) — self-referencing FK. Валидация на уровне
     *  приложения (board-ops.ts): только frame/group могут быть родителями, вложенность
     *  запрещена. DB-level FK опущен (TS25707 циркулярная типизация); ON DELETE SET NULL
     *  эмулируется в item.delete через осираение детей (parentId → null) */
    parentId: uuid('parent_id'),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
    rotation: doublePrecision('rotation').notNull().default(0),
    zIndex: integer('z_index').notNull().default(0),
    content: jsonb('content').notNull().$type<BoardItemContent>(),
    style: jsonb('style').notNull().$type<BoardItemStyle>(),
    /** Реакции-эмодзи (12.12) — только на стикерах, персистентные, не эфемерные как у комнат */
    reactions: jsonb('reactions').notNull().$type<ItemReaction[]>().default([]),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('board_items_board_id_idx').on(t.boardId)],
);

/**
 * Связь-стрелка между двумя элементами доски. Отдельная таблица, не поле
 * внутри элемента: удаление элемента каскадом уносит его стрелки бесплатно,
 * а доска читается двумя независимыми запросами вместо разбора вложенности.
 */
export const boardEdges = pgTable(
  'board_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    sourceItemId: uuid('source_item_id')
      .notNull()
      .references(() => boardItems.id, { onDelete: 'cascade' }),
    targetItemId: uuid('target_item_id')
      .notNull()
      .references(() => boardItems.id, { onDelete: 'cascade' }),
    /** null — floating edge: конец цепляется к ближайшей стороне карточки (12.8) */
    sourceHandle: text('source_handle'),
    targetHandle: text('target_handle'),
    label: text('label'),
    style: jsonb('style').notNull().$type<BoardEdgeStyle>(),
  },
  (t) => [index('board_edges_board_id_idx').on(t.boardId)],
);

/**
 * Шаблоны досок (15.1). builtin — 4 встроенных, сидируются кодом при старте
 * сервера (см. `seedBuiltins` в `board-templates.repository.ts`), не миграцией.
 * personal/team зарезервированы под будущее «сохранить доску как шаблон» —
 * ownerId/teamId для builtin всегда null, заполняются только этими сценариями.
 */
export const boardTemplates = pgTable(
  'board_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: boardTemplateScopeEnum('scope').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    /** Литеральное имя — единственный источник для personal/team; для builtin — фолбэк на случай отсутствия nameKey */
    name: text('name').notNull(),
    /** i18n-ключ для галереи — задан только у 4 сидированных builtin-строк */
    nameKey: text('name_key'),
    description: text('description'),
    descriptionKey: text('description_key'),
    items: jsonb('items').notNull().$type<BoardTemplateItem[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('board_templates_owner_id_idx').on(t.ownerId),
    index('board_templates_team_id_idx').on(t.teamId),
  ],
);
