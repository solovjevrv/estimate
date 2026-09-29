import type { Db } from '../db';

/** Транзакция Drizzle: тот же интерфейс запросов, что и у соединения */
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | Transaction;
