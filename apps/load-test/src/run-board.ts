import { randomUUID } from 'node:crypto';

import { UsersRepository } from '@poker/server/auth/testkit';
import { createDb, schema } from '@poker/server/db';
import type { BoardItemContent, BoardItemStyle } from '@poker/shared';
import { like } from 'drizzle-orm';

import { createAuthMinter } from './auth';
import { loadBoardConfig } from './config';
import { LatencyRecorder } from './metrics';
import { ResourceSampler } from './resource-sampler';
import { runBoardScenario } from './board-scenario';

/** Метка в названии доски и почте — по ней прогон чистит за собой данные (как в run.ts) */
const BOARD_PREFIX = 'LOADTEST ';
const EMAIL_DOMAIN = 'loadtest.local';
const DEFAULT_STYLE: BoardItemStyle = { color: '#fef08a' };

/**
 * Наполняет доску элементами напрямую в БД, минуя WS/API — сам импорт/расстановка
 * элементов не то, что здесь измеряется (это делает 21.8's e2e-перф-тест для
 * анимированных стикеров конкретно), здесь важно только получить доску с реалистичным
 * объёмом и составом контента ДО того, как на неё придут 50 одновременных участников.
 * У `format: 'animated'`/`'video'` пары pack/id не ссылаются на реально существующий
 * личный пак — контент доски не типизирован внешним ключом (jsonb), а для сервера
 * важен только объём/состав payload'а, не разрешимость стикера в MinIO.
 */
async function seedBoardItems(
  db: ReturnType<typeof createDb>['db'],
  boardId: string,
  totalCount: number,
  animatedStickerCount: number,
): Promise<void> {
  const staticStickerCount = Math.min(
    Math.floor(totalCount * 0.2),
    totalCount - animatedStickerCount,
  );
  const stickyCount = Math.max(0, totalCount - animatedStickerCount - staticStickerCount);

  const items: Array<{
    id: string;
    boardId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    content: BoardItemContent;
    style: BoardItemStyle;
  }> = [];

  const cols = 40;
  const spacing = 160;
  let index = 0;
  const nextPosition = (): { x: number; y: number } => {
    const pos = { x: (index % cols) * spacing, y: Math.floor(index / cols) * spacing };
    index += 1;
    return pos;
  };

  for (let i = 0; i < animatedStickerCount; i += 1) {
    const { x, y } = nextPosition();
    items.push({
      id: randomUUID(),
      boardId,
      x,
      y,
      width: 120,
      height: 120,
      content: { type: 'sticker', pack: 'loadtest-pack', id: `animated-${i}`, format: 'animated' },
      style: DEFAULT_STYLE,
    });
  }
  for (let i = 0; i < staticStickerCount; i += 1) {
    const { x, y } = nextPosition();
    items.push({
      id: randomUUID(),
      boardId,
      x,
      y,
      width: 120,
      height: 120,
      content: { type: 'sticker', pack: 'loadtest-pack', id: `static-${i}`, format: 'static' },
      style: DEFAULT_STYLE,
    });
  }
  for (let i = 0; i < stickyCount; i += 1) {
    const { x, y } = nextPosition();
    items.push({
      id: randomUUID(),
      boardId,
      x,
      y,
      width: 200,
      height: 200,
      content: { type: 'sticky', text: `Заметка нагрузочного теста ${i + 1}` },
      style: DEFAULT_STYLE,
    });
  }

  const BATCH = 500;
  for (let offset = 0; offset < items.length; offset += BATCH) {
    await db.insert(schema.boardItems).values(items.slice(offset, offset + BATCH));
  }
}

async function main(): Promise<void> {
  const config = loadBoardConfig();
  const { db, pool } = createDb(config.databaseUrl);
  const users = new UsersRepository(db);
  const minter = await createAuthMinter(config.jwtSecret);
  const sampler = new ResourceSampler({
    databaseUrl: config.databaseUrl,
    containerName: config.containerName,
    intervalMs: config.sampleIntervalMs,
  });

  const joinLatency = new LatencyRecorder();
  const applyLatency = new LatencyRecorder();
  const broadcastLatency = new LatencyRecorder();

  console.log(
    `Нагрузка (доски, 21.10): 1 доска × ${config.boardParticipants} участников, ` +
      `${config.boardItemCount} элементов на доске (в т.ч. ${config.boardAnimatedStickerCount} ` +
      `анимированных стикеров), ${config.boardWaves} волн правок (сервер: ${config.serverOrigin})`,
  );

  sampler.start();
  const startedAt = performance.now();
  let errors: string[] = [];
  let boardId: string | undefined;

  try {
    const owner = await users.upsertFromOAuth('google', {
      providerId: `loadtest-board-owner-${randomUUID()}`,
      email: `loadtest-board-owner-${randomUUID()}@${EMAIL_DOMAIN}`,
      name: 'Нагрузка владелец доски',
      avatarUrl: null,
    });
    const cookie = minter.mint(owner.id);

    const createRes = await fetch(`${config.serverOrigin}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ title: `${BOARD_PREFIX}Board ${randomUUID().slice(0, 8)}` }),
    });
    if (!createRes.ok) {
      throw new Error(`не удалось создать доску: HTTP ${createRes.status}`);
    }
    const { board } = (await createRes.json()) as { board: { id: string } };
    boardId = board.id;

    // Ссылка с правом правки — так же, как в реальном сценарии совместной работы по ссылке;
    // без этого гости (без аккаунта) не получили бы доступа к чужой личной доске
    const shareRes = await fetch(`${config.serverOrigin}/api/boards/${boardId}/share`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ role: 'edit' }),
    });
    if (!shareRes.ok) {
      throw new Error(`не удалось включить ссылку доступа: HTTP ${shareRes.status}`);
    }

    await seedBoardItems(db, boardId, config.boardItemCount, config.boardAnimatedStickerCount);

    const result = await runBoardScenario({
      serverOrigin: config.serverOrigin,
      boardId,
      ownerCookie: cookie,
      guestCount: config.boardParticipants - 1,
      waves: config.boardWaves,
      jitterMs: config.editJitterMs,
      joinLatency,
      applyLatency,
      broadcastLatency,
    });
    errors = result.errors;
  } finally {
    await sampler.stop();
    await minter.close();

    const durationSec = (performance.now() - startedAt) / 1000;
    console.log('\n--- Результаты ---');
    console.log(`Длительность: ${durationSec.toFixed(1)}с`);
    console.log(`Ошибок: ${errors.length}`);
    if (errors.length > 0) {
      console.log(errors.slice(0, 20).join('\n'));
    }
    console.log('Вход на доску (JOIN → снимок дошёл):', joinLatency.summary());
    console.log('Правка → ack:', applyLatency.summary());
    console.log('Правка → рассылка дошла до всех участников:', broadcastLatency.summary());
    console.log('Ресурсы сервера/БД:', sampler.summary());

    if (boardId) {
      await db.delete(schema.boards).where(like(schema.boards.title, `${BOARD_PREFIX}%`));
    }
    await db.delete(schema.users).where(like(schema.users.email, `%@${EMAIL_DOMAIN}`));
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
