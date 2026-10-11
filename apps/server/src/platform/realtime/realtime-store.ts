/**
 * Общее сиюминутное состояние realtime (10.18): таймеры, реакции, буфер
 * операций досок, номера снимков. Без Redis — в памяти процесса (один
 * экземпляр сервера, как раньше), с Redis — общее для всех экземпляров.
 *
 * Состояние сиюминутное, не история: у каждой записи срок жизни
 * `REALTIME_TTL_SEC` с последней записи — после падения экземпляра, не
 * успевшего прибрать за опустевшей комнатой, мусор уходит сам.
 */
export interface RealtimeStore {
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown): Promise<void>;
  delete(...keys: string[]): Promise<void>;

  /** Поля хэша в порядке добавления (у Redis — для небольших хэшей) */
  hashGetAll(key: string): Promise<Array<[field: string, value: string]>>;
  hashGet(key: string, field: string): Promise<string | null>;
  hashSet(key: string, field: string, value: string): Promise<void>;
  hashDelete(key: string, field: string): Promise<void>;

  /**
   * Монотонный номер на ключ: max(прошлый + 1, текущее время в мс). Время —
   * нижняя граница, чтобы номер не откатился, даже если хранилище потеряло
   * счётчик (перезапуск Redis, истёк срок жизни).
   */
  nextSeq(key: string): Promise<number>;

  /** Добавляет в упорядоченный по `score` набор и оставляет только `cap` последних */
  sortedAdd(key: string, score: number, member: string, cap: number): Promise<void>;
  /** Записи со `score` строго больше `minExclusive`, по возрастанию */
  sortedAbove(key: string, minExclusive: number): Promise<Array<{ score: number; member: string }>>;

  /** Бросает, если хранилище недоступно — для `/health` */
  ping(): Promise<void>;
}

/** Сутки: комната или доска, где никого не было сутки, начинает с чистого листа */
export const REALTIME_TTL_SEC = 24 * 60 * 60;

type Entry =
  | { kind: 'json'; value: string }
  | { kind: 'hash'; value: Map<string, string> }
  | { kind: 'seq'; value: number }
  | { kind: 'sorted'; value: Array<{ score: number; member: string }> };

/** Один экземпляр сервера: всё в памяти процесса */
export class MemoryRealtimeStore implements RealtimeStore {
  private readonly entries = new Map<string, { entry: Entry; expiresAt: number }>();
  private writesSinceSweep = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  async getJson<T>(key: string): Promise<T | null> {
    const entry = this.read(key, 'json');
    return entry ? (JSON.parse(entry.value) as T) : null;
  }

  async setJson(key: string, value: unknown): Promise<void> {
    this.write(key, { kind: 'json', value: JSON.stringify(value) });
  }

  async delete(...keys: string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
  }

  async hashGetAll(key: string): Promise<Array<[string, string]>> {
    return [...(this.read(key, 'hash')?.value ?? [])];
  }

  async hashGet(key: string, field: string): Promise<string | null> {
    return this.read(key, 'hash')?.value.get(field) ?? null;
  }

  async hashSet(key: string, field: string, value: string): Promise<void> {
    const hash = this.read(key, 'hash')?.value ?? new Map<string, string>();
    hash.set(field, value);
    this.write(key, { kind: 'hash', value: hash });
  }

  async hashDelete(key: string, field: string): Promise<void> {
    const hash = this.read(key, 'hash')?.value;
    if (!hash) return;
    hash.delete(field);
    if (hash.size === 0) this.entries.delete(key);
  }

  async nextSeq(key: string): Promise<number> {
    const previous = this.read(key, 'seq')?.value ?? 0;
    const next = Math.max(previous + 1, this.now());
    this.write(key, { kind: 'seq', value: next });
    return next;
  }

  async sortedAdd(key: string, score: number, member: string, cap: number): Promise<void> {
    const list = (this.read(key, 'sorted')?.value ?? []).filter((item) => item.score !== score);
    list.push({ score, member });
    list.sort((a, b) => a.score - b.score);
    this.write(key, { kind: 'sorted', value: list.slice(-cap) });
  }

  async sortedAbove(
    key: string,
    minExclusive: number,
  ): Promise<Array<{ score: number; member: string }>> {
    return (this.read(key, 'sorted')?.value ?? []).filter((item) => item.score > minExclusive);
  }

  async ping(): Promise<void> {}

  /** Сколько ключей живо — чтобы утечка была наблюдаемой в тестах */
  get size(): number {
    return this.entries.size;
  }

  private read<K extends Entry['kind']>(key: string, kind: K): Extract<Entry, { kind: K }> | null {
    const stored = this.entries.get(key);
    if (!stored) return null;
    if (stored.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return stored.entry.kind === kind ? (stored.entry as Extract<Entry, { kind: K }>) : null;
  }

  private write(key: string, entry: Entry): void {
    this.entries.set(key, { entry, expiresAt: this.now() + REALTIME_TTL_SEC * 1000 });
    // Истёкшие ключи вычищаются и без чтения — иначе брошенные комнаты копились бы
    this.writesSinceSweep += 1;
    if (this.writesSinceSweep >= 1000) {
      this.writesSinceSweep = 0;
      const now = this.now();
      for (const [storedKey, stored] of this.entries) {
        if (stored.expiresAt <= now) this.entries.delete(storedKey);
      }
    }
  }
}
