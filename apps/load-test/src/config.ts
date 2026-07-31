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
