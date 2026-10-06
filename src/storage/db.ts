// src/storage/db.ts — Apertura de SQLite y migraciones (maestro §12.2).
//
// QUÉ HACE:
//  - openAppDb(): abre riachuelo.db, activa WAL y claves foráneas y ejecuta las migraciones pendientes
//    (cada una en una transacción exclusiva; al terminar fija PRAGMA user_version).
//  - getDb(): devuelve la conexión abierta para los repositorios. Las pantallas NUNCA llaman a getDb()
//    (regla R-05): usan servicios.
// DECISIÓN: se abre la base con openDatabaseAsync en el arranque (PANT-01) en vez de <SQLiteProvider>,
// porque los servicios (controlador, cámara, red) la usan fuera del árbol de React. El comportamiento
// de migración es el mismo que el descrito en el maestro.

import * as SQLite from 'expo-sqlite';

import { MIGRATION_001 } from './migrations/001_initial';
// 002: migración de la entrega v0.3.0 (ciclos de monitoreo, CFG-3; maestro v2.0 §12.2). Solo agrega tablas y una columna.
import { MIGRATION_002 } from './migrations/002_cobertura';
import { MIGRATION_003 } from './migrations/003_remote_uploads'; // v2.0: subida directa a Cloudinary (12.1.1)
import { MIGRATION_004 } from './migrations/004_catalog_codes'; // Fase 4: códigos de catálogo no únicos (ADR 0007)

/** Índice + 1 = versión del esquema. Nunca modificar una migración publicada: agregar 005, 006… */
export const MIGRATIONS: readonly string[] = [MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004];

export const DB_NAME = 'riachuelo.db';

let dbRef: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

export async function migrateDbIfNeeded(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(MIGRATIONS[v]);
      await txn.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Abre (una sola vez) y migra la base de datos. Se llama desde el arranque (src/app-boot.ts). */
export function openAppDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbRef) return Promise.resolve(dbRef);
  if (!opening) {
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrateDbIfNeeded(db);
      dbRef = db;
      return db;
    })().catch((err: unknown) => {
      opening = null;
      throw err;
    });
  }
  return opening;
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!dbRef) throw new Error('La base de datos aún no está abierta');
  return dbRef;
}

export function isDbOpen(): boolean {
  return dbRef !== null;
}

/** Ejecuta una escritura de varias tablas en una transacción exclusiva (regla R-14). */
export async function inTransaction(task: (txn: SQLite.SQLiteDatabase) => Promise<void>): Promise<void> {
  await getDb().withExclusiveTransactionAsync(async (txn) => task(txn));
}

/** Tipo común para funciones de repositorio que pueden recibir la transacción en curso. */
export type Db = SQLite.SQLiteDatabase;

/** Conteo de filas por tabla (diagnóstico). */
export async function tableCounts(): Promise<Record<string, number>> {
  const db = getDb();
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    [],
  );
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t.name}`, []);
    out[t.name] = r?.n ?? 0;
  }
  return out;
}
