import { randomUUID } from 'node:crypto';

import { UsersRepository } from '@poker/server/auth/testkit';
import { createDb, schema } from '@poker/server/db';
import { like } from 'drizzle-orm';

import { createAuthMinter } from './auth';
import { loadConfig } from './config';
import { LatencyRecorder } from './metrics';
import { ResourceSampler } from './resource-sampler';
import { runRoomScenario } from './scenario';

/** Метка в имени комнаты и почте — по ней прогон чистит за собой данные */
const ROOM_PREFIX = 'LOADTEST ';
const EMAIL_DOMAIN = 'loadtest.local';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, pool } = createDb(config.databaseUrl);
  const users = new UsersRepository(db);
  const minter = await createAuthMinter(config.jwtSecret);
  const sampler = new ResourceSampler({
    databaseUrl: config.databaseUrl,
    containerName: config.containerName,
    intervalMs: config.sampleIntervalMs,
  });

  const voteLatency = new LatencyRecorder();
  const revealLatency = new LatencyRecorder();

  console.log(
    `Нагрузка: ${config.rooms} комнат × ${config.participantsPerRoom} участников × ` +
      `${config.roundsPerRoom} раундов (сервер: ${config.serverOrigin})`,
  );

  sampler.start();
  const startedAt = performance.now();
  let errors: string[] = [];

  try {
    const rooms = await Promise.all(
      Array.from({ length: config.rooms }, async (_, i) => {
        const owner = await users.upsertFromOAuth('google', {
          providerId: `loadtest-owner-${i}-${randomUUID()}`,
          email: `loadtest-owner-${i}-${randomUUID()}@${EMAIL_DOMAIN}`,
          name: `Нагрузка владелец ${i + 1}`,
          avatarUrl: null,
        });
        const cookie = minter.mint(owner.id);
        const res = await fetch(`${config.serverOrigin}/api/rooms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ name: `${ROOM_PREFIX}${i + 1} ${randomUUID().slice(0, 8)}` }),
        });
        if (!res.ok) {
          throw new Error(`не удалось создать комнату ${i}: HTTP ${res.status}`);
        }
        const { room } = (await res.json()) as { room: { id: string } };
        return { roomId: room.id, cookie };
      }),
    );

    const results = await Promise.all(
      rooms.map((room) =>
        runRoomScenario({
          serverOrigin: config.serverOrigin,
          roomId: room.roomId,
          ownerCookie: room.cookie,
          guestCount: config.participantsPerRoom - 1,
          rounds: config.roundsPerRoom,
          jitterMs: config.voteJitterMs,
          voteLatency,
          revealLatency,
        }),
      ),
    );
    errors = results.flatMap((r) => r.errors);
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
    console.log('Голос → ack:', voteLatency.summary());
    console.log('Вскрытие → все получили снимок:', revealLatency.summary());
    console.log('Ресурсы сервера/БД:', sampler.summary());

    await db.delete(schema.rooms).where(like(schema.rooms.name, `${ROOM_PREFIX}%`));
    await db.delete(schema.users).where(like(schema.users.email, `%@${EMAIL_DOMAIN}`));
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
