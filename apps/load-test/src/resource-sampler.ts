import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createDb } from '@poker/server/db';
import { sql } from 'drizzle-orm';

const execFileAsync = promisify(execFile);

interface Sample {
  cpuPercent: number;
  memMb: number;
  pgConnections: number;
}

interface Aggregate {
  avg: number;
  max: number;
}

export interface ResourceSummary {
  samples: number;
  cpuPercent: Aggregate;
  memMb: Aggregate;
  pgConnections: Aggregate;
}

/** Периодически снимает CPU/память контейнера сервера и число подключений к БД во время прогона */
export class ResourceSampler {
  private readonly samples: Sample[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly db: ReturnType<typeof createDb>['db'];
  private readonly pool: ReturnType<typeof createDb>['pool'];
  private readonly containerName: string;
  private readonly intervalMs: number;

  constructor(opts: { databaseUrl: string; containerName: string; intervalMs?: number }) {
    const created = createDb(opts.databaseUrl);
    this.db = created.db;
    this.pool = created.pool;
    this.containerName = opts.containerName;
    this.intervalMs = opts.intervalMs ?? 2000;
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.sampleOnce();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool.end();
  }

  summary(): ResourceSummary {
    return {
      samples: this.samples.length,
      cpuPercent: aggregate(this.samples.map((s) => s.cpuPercent)),
      memMb: aggregate(this.samples.map((s) => s.memMb)),
      pgConnections: aggregate(this.samples.map((s) => s.pgConnections)),
    };
  }

  private async sampleOnce(): Promise<void> {
    const [docker, pgConnections] = await Promise.all([this.sampleDocker(), this.samplePg()]);
    this.samples.push({
      cpuPercent: docker?.cpuPercent ?? 0,
      memMb: docker?.memMb ?? 0,
      pgConnections,
    });
  }

  private async sampleDocker(): Promise<{ cpuPercent: number; memMb: number } | null> {
    try {
      const { stdout } = await execFileAsync('docker', [
        'stats',
        this.containerName,
        '--no-stream',
        '--format',
        '{{.CPUPerc}}\t{{.MemUsage}}',
      ]);
      const [cpuRaw, memRaw] = stdout.trim().split('\t');
      const cpuPercent = Number.parseFloat((cpuRaw ?? '0').replace('%', ''));
      // MemUsage выглядит как "123.4MiB / 2GiB" — берём только использованную часть
      const usedRaw = (memRaw ?? '0MiB').split('/')[0]?.trim() ?? '0MiB';
      return { cpuPercent, memMb: parseMebibytes(usedRaw) };
    } catch {
      return null;
    }
  }

  private async samplePg(): Promise<number> {
    try {
      const result = await this.db.execute<{ count: number }>(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database()`,
      );
      return result.rows[0]?.count ?? 0;
    } catch {
      return 0;
    }
  }
}

function aggregate(values: number[]): Aggregate {
  if (values.length === 0) return { avg: 0, max: 0 };
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return { avg: Math.round(avg * 10) / 10, max: Math.round(Math.max(...values) * 10) / 10 };
}

function parseMebibytes(raw: string): number {
  const match = /^([\d.]+)\s*(KiB|MiB|GiB|B)$/i.exec(raw.trim());
  if (!match) return 0;
  const value = Number.parseFloat(match[1] ?? '0');
  const unit = (match[2] ?? 'MiB').toLowerCase();
  if (unit === 'gib') return value * 1024;
  if (unit === 'kib') return value / 1024;
  if (unit === 'b') return value / (1024 * 1024);
  return value;
}
