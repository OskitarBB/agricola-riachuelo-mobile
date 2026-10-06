// tools/verificacion/mocks/expo-sqlite.ts — expo-sqlite sobre node:sqlite (Node 22.5+) para correr la app en Node.
// Misma API asíncrona que usa la app (runAsync, getFirstAsync, getAllAsync, execAsync, withExclusiveTransactionAsync,
// prepareAsync). SOLO para las pruebas de verificación: la app real usa expo-sqlite.
import { DatabaseSync } from 'node:sqlite';

type Param = string | number | null | bigint | Uint8Array;
const norm = (params: unknown[] = []): Param[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as Param)));

export class SQLiteDatabase {
  private depth = 0;
  constructor(public readonly db: DatabaseSync) {}
  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }
  async runAsync(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowId: number }> {
    const r = this.db.prepare(sql).run(...norm(params));
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }
  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const r = this.db.prepare(sql).get(...norm(params));
    return (r ? { ...r } : null) as T | null;
  }
  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...norm(params)).map((r) => ({ ...r })) as T[];
  }
  async withExclusiveTransactionAsync(task: (txn: SQLiteDatabase) => Promise<void>): Promise<void> {
    // Una transacción a la vez (como expo-sqlite): las demás esperan su turno.
    while (this.depth > 0) await new Promise((r) => setTimeout(r, 1));
    this.depth++;
    this.db.exec('BEGIN EXCLUSIVE');
    try {
      await task(this);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }
  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    return this.withExclusiveTransactionAsync(async () => task());
  }
  async prepareAsync(sql: string) {
    const st = this.db.prepare(sql);
    return {
      executeAsync: async (params: unknown[] = []) => {
        const r = st.run(...norm(params));
        return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
      },
      finalizeAsync: async () => undefined,
    };
  }
  async closeAsync(): Promise<void> {
    this.db.close();
  }
}

const opened = new Map<string, SQLiteDatabase>();
export async function openDatabaseAsync(name: string): Promise<SQLiteDatabase> {
  const path = process.env.RIACHUELO_SQLITE ?? ':memory:';
  const key = `${name}:${path}`;
  if (!opened.has(key)) opened.set(key, new SQLiteDatabase(new DatabaseSync(path)));
  return opened.get(key) as SQLiteDatabase;
}
