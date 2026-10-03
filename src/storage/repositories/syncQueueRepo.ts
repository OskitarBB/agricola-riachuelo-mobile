// src/storage/repositories/syncQueueRepo.ts — Cola del CONTROLADOR hacia Spring Boot (sync_queue).
//
// QUÉ HACE: al cerrar una sesión se crean, en la MISMA transacción, sus elementos en orden
// (10 sesión, 20 pasada, 30 secuencias, 40 capturas, 50 incidencias, 60 cierre; maestro §15.5).
// INTEGRACIÓN FUTURA (Fase 4): src/sync/syncService.ts procesará esta cola contra la API real.

import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

export type SyncEntityType = 'SESSION' | 'PASS' | 'SEQUENCE_BATCH' | 'CAPTURE' | 'INCIDENT_BATCH' | 'SESSION_CLOSE';
export type SyncItemStatus = 'PENDIENTE' | 'EN_CURSO' | 'HECHO' | 'ERROR_DEFINITIVO';

export const ORDER_KEY: Record<SyncEntityType, number> = {
  SESSION: 10,
  PASS: 20,
  SEQUENCE_BATCH: 30,
  CAPTURE: 40,
  INCIDENT_BATCH: 50,
  SESSION_CLOSE: 60,
};

/** Inserta o reactiva (upsert por entity_type + entity_id) un elemento de la cola. */
export async function upsertSyncItem(type: SyncEntityType, entityId: string, sessionId: string, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO sync_queue (entity_type, entity_id, session_id, order_key, status, attempts, next_attempt_at, last_error_code, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PENDIENTE', 0, ?, NULL, NULL, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET status = 'PENDIENTE', attempts = 0, next_attempt_at = excluded.next_attempt_at,
       updated_at = excluded.updated_at`,
    [type, entityId, sessionId, ORDER_KEY[type], now, now, now],
  );
}

export interface SyncSessionSummary {
  sessionId: string;
  total: number;
  done: number;
  pending: number;
  errors: number;
  lastAttemptAt: string | null;
}

export async function summarizeBySession(db: Db = getDb()): Promise<SyncSessionSummary[]> {
  const rows = await db.getAllAsync<{
    session_id: string;
    total: number;
    done: number;
    pending: number;
    errors: number;
    last: string | null;
  }>(
    `SELECT session_id, COUNT(*) AS total,
       SUM(CASE WHEN status = 'HECHO' THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN status IN ('PENDIENTE','EN_CURSO') THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'ERROR_DEFINITIVO' THEN 1 ELSE 0 END) AS errors,
       MAX(CASE WHEN attempts > 0 THEN updated_at END) AS last
     FROM sync_queue GROUP BY session_id ORDER BY MIN(created_at) DESC`,
    [],
  );
  return rows.map((r) => ({
    sessionId: r.session_id,
    total: r.total,
    done: r.done,
    pending: r.pending,
    errors: r.errors,
    lastAttemptAt: r.last,
  }));
}

export async function countPendingSync(db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE status <> 'HECHO'", []);
  return r?.n ?? 0;
}
