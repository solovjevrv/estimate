export interface LoadTestConfig {
  serverOrigin: string;
  databaseUrl: string;
  jwtSecret: string;
  containerName: string;
  rooms: number;
  participantsPerRoom: number;
  roundsPerRoom: number;
  voteJitterMs: number;
  sampleIntervalMs: number;
}

export interface BoardLoadTestConfig {
  serverOrigin: string;
  databaseUrl: string;
  jwtSecret: string;
  containerName: string;
  /** Участников одной доски, включая владельца (14.8, 21.10) */
  boardParticipants: number;
  /** Элементов на доске до старта прогона — стикеры/анимированные варианты входят в это число */
  boardItemCount: number;
  /** Из boardItemCount — доля стикеров с format: 'animated' (21.10, по мотивам 21.7/21.8) */
  boardAnimatedStickerCount: number;
  boardWaves: number;
  editJitterMs: number;
  sampleIntervalMs: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} должен быть положительным числом`);
  }
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} не задан — см. apps/load-test/README.md`);
  }
  return value;
}

export function loadConfig(): LoadTestConfig {
  return {
    serverOrigin: process.env.LOADTEST_SERVER_ORIGIN ?? 'http://localhost:3001',
    databaseUrl: requireEnv('DATABASE_URL'),
    jwtSecret: requireEnv('JWT_SECRET'),
    containerName: process.env.LOADTEST_SERVER_CONTAINER ?? 'poker-server-loadtest',
    rooms: envInt('LOADTEST_ROOMS', 10),
    participantsPerRoom: envInt('LOADTEST_PARTICIPANTS_PER_ROOM', 15),
    roundsPerRoom: envInt('LOADTEST_ROUNDS_PER_ROOM', 5),
    voteJitterMs: envInt('LOADTEST_VOTE_JITTER_MS', 300),
    sampleIntervalMs: envInt('LOADTEST_SAMPLE_INTERVAL_MS', 500),
  };
}

export function loadBoardConfig(): BoardLoadTestConfig {
  return {
    serverOrigin: process.env.LOADTEST_SERVER_ORIGIN ?? 'http://localhost:3001',
    databaseUrl: requireEnv('DATABASE_URL'),
    jwtSecret: requireEnv('JWT_SECRET'),
    containerName: process.env.LOADTEST_SERVER_CONTAINER ?? 'poker-server-loadtest',
    boardParticipants: envInt('LOADTEST_BOARD_PARTICIPANTS', 50),
    boardItemCount: envInt('LOADTEST_BOARD_ITEM_COUNT', 1000),
    boardAnimatedStickerCount: envInt('LOADTEST_BOARD_ANIMATED_STICKER_COUNT', 100),
    boardWaves: envInt('LOADTEST_BOARD_WAVES', 5),
    editJitterMs: envInt('LOADTEST_EDIT_JITTER_MS', 300),
    sampleIntervalMs: envInt('LOADTEST_SAMPLE_INTERVAL_MS', 500),
  };
}
