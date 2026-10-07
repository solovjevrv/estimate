import { ValidationError } from '../errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Куда переносить комнату или доску (10.24): id команды или null — сделать личной */
export function parseTargetTeamId(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw === 'string' && UUID_RE.test(raw)) return raw;
  throw new ValidationError('Укажите команду или null — сделать личной');
}
