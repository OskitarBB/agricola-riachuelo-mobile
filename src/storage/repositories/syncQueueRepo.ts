// src/storage/repositories/syncQueueRepo.ts — Cola del CONTROLADOR hacia la plataforma Django (sync_queue).
//
// QUÉ HACE: al cerrar una sesión se crean, en la MISMA transacción, sus elementos en orden
// (10 sesión, 20 pasada, 30 secuencias, 40 capturas, 50 incidencias, 60 cierre; maestro §15.5).
// src/sync/syncService.ts la procesa contra /api/v1 (y Cloudinary para el archivo de cada foto):
//  - claimItem(): PENDIENTE → EN_CURSO (solo si sigue PENDIENTE).
//  - markItemDone(): EN_CURSO → HECHO. Si mientras tanto una foto tardía reencoló el elemento (upsert → PENDIENTE),
//    NO se marca HECHO: se vuelve a enviar con los datos nuevos (concurrencia optimista, 8.13).
//  - markItemRetry() / markItemError(): espera creciente o ERROR_DEFINITIVO con el código visible en PANT-20.
//  - releaseStuckItems(): al arrancar, los EN_CURSO de una ejecución interrumpida vuelven a PENDIENTE.

import { ORDER_KEY, type SyncEntityType, type SyncItemStatus } from '../../domain/syncQueue';
import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

export { ORDER_KEY };
export type { SyncEntityType, SyncItemStatus };

/** Inserta o reactiva (upsert por entity_type + entity_id) un elemento de la cola. */
export async function upsertSyncItem(type: SyncEntityType, entityId: string, sessionId: string, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO sync_queue (entity_type, entity_id, session_id, order_key, status, attempts, next_attempt_at, last_error_code, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PENDIENTE', 0, ?, NULL, NULL, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET status = 'PENDIENTE', attempts = 0, next_attempt_at = excluded.next_attempt_at,
       last_error_code = NULL, last_error = NULL, updated_at = excluded.updated_at`,
    [type, entityId, sessionId, ORDER_KEY[type], now, now, now],
  );
}

export interface SyncQueueItem {
  id: number;
  entityType: SyncEntityType;
  entityId: string;
  sessionId: string;
  orderKey: number;
  status: SyncItemStatus;
  attempts: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  /** Pasada de la captura (CAPTURE) o la propia pasada (PASS y SEQUENCE_BATCH). */
  passId: string | null;
}

interface QueueRow {
  id: number;
  entity_type: SyncEntityType;
  entity_id: string;
  session_id: string;
  order_key: number;
  status: SyncItemStatus;
  attempts: number;
  next_attempt_at: string;
  last_error_code: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  pass_id: string | null;
}

function toItem(r: QueueRow): SyncQueueItem {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    sessionId: r.session_id,
    orderKey: r.order_key,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    lastErrorCode: r.last_error_code,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    passId: r.pass_id,
  };
}

const ITEM_SELECT = `SELECT q.*, CASE
    WHEN q.entity_type IN ('PASS','SEQUENCE_BATCH') THEN q.entity_id
    WHEN q.entity_type = 'CAPTURE' THEN (SELECT c.pass_id FROM captures c WHERE c.capture_id = q.entity_id)
    ELSE NULL END AS pass_id
  FROM sync_queue q`;

/**
 * Todos los elementos de las sesiones que todavía tienen trabajo (PENDIENTE, EN_CURSO o ERROR_DEFINITIVO),
 * incluidos sus HECHO (los necesita el planificador para saber qué padres ya están en el servidor).
 */
export async function listOpenSessionItems(db: Db = getDb()): Promise<SyncQueueItem[]> {
  const rows = await db.getAllAsync<QueueRow>(
    `${ITEM_SELECT}
     WHERE q.session_id IN (SELECT DISTINCT session_id FROM sync_queue WHERE status IN ('PENDIENTE','EN_CURSO'))
     ORDER BY q.id`,
    [],
  );
  return rows.map(toItem);
}

/** Todos los elementos de UNA sesión (para saber qué pasadas y secuencias ya conoce el servidor). */
export async function listSessionItems(sessionId: string, db: Db = getDb()): Promise<SyncQueueItem[]> {
  const rows = await db.getAllAsync<QueueRow>(`${ITEM_SELECT} WHERE q.session_id = ? ORDER BY q.order_key, q.id`, [sessionId]);
  return rows.map(toItem);
}

/** ¿Hay elementos PENDIENTE cuya espera ya venció? (sincronización automática) */
export async function hasDueItems(now: string, db: Db = getDb()): Promise<boolean> {
  const r = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'PENDIENTE' AND next_attempt_at <= ?",
    [now],
  );
  return (r?.n ?? 0) > 0;
}

/**
 * PENDIENTE → ERROR_DEFINITIVO porque un padre quedó con error definitivo (nunca podrían enviarse y bloquearían el
 * cierre de la sesión y el cambio de función). "Reintentar errores" los vuelve a PENDIENTE junto con el padre.
 */
export async function markItemBlocked(id: number, code: string, db: Db = getDb()): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE sync_queue SET status = 'ERROR_DEFINITIVO', last_error_code = ?, last_error = NULL, updated_at = ?
     WHERE id = ? AND status = 'PENDIENTE'`,
    [code.slice(0, 60), nowIso(), id],
  );
  return r.changes > 0;
}

/**
 * Una incidencia nueva en una sesión ya cerrada: su INCIDENT_BATCH vuelve a PENDIENTE (si ya se había enviado) para
 * que la incidencia también llegue al servidor; la sesión SYNCED vuelve a CLOSED (como una foto tardía, 8.13).
 */
export async function reopenIncidentBatch(sessionId: string, db: Db = getDb()): Promise<boolean> {
  const now = nowIso();
  const r = await db.runAsync(
    `UPDATE sync_queue SET status = 'PENDIENTE', attempts = 0, next_attempt_at = ?, last_error_code = NULL, last_error = NULL,
       updated_at = ? WHERE entity_type = 'INCIDENT_BATCH' AND entity_id = ? AND status = 'HECHO'`,
    [now, now, sessionId],
  );
  if (r.changes > 0) {
    await db.runAsync(
      "UPDATE monitoring_sessions SET status = 'CLOSED', remote_sync_status = 'PENDIENTE_NUBE', updated_at = ? WHERE session_id = ? AND status = 'SYNCED'",
      [now, sessionId],
    );
  }
  return r.changes > 0;
}

export interface SessionQueueCounts {
  total: number;
  done: number;
  errors: number;
  open: number;
}

/** Conteo de la cola de una sesión (estado remoto de la sesión al terminar una ronda). */
export async function sessionQueueCounts(sessionId: string, db: Db = getDb()): Promise<SessionQueueCounts> {
  const r = await db.getFirstAsync<{ total: number; done: number | null; errors: number | null; open: number | null }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status = 'HECHO' THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN status = 'ERROR_DEFINITIVO' THEN 1 ELSE 0 END) AS errors,
       SUM(CASE WHEN status IN ('PENDIENTE','EN_CURSO') THEN 1 ELSE 0 END) AS open
     FROM sync_queue WHERE session_id = ?`,
    [sessionId],
  );
  return { total: r?.total ?? 0, done: r?.done ?? 0, errors: r?.errors ?? 0, open: r?.open ?? 0 };
}

/** PENDIENTE → EN_CURSO. Devuelve false si otro proceso ya lo cambió. */
export async function claimItem(id: number, db: Db = getDb()): Promise<boolean> {
  const r = await db.runAsync("UPDATE sync_queue SET status = 'EN_CURSO', updated_at = ? WHERE id = ? AND status = 'PENDIENTE'", [
    nowIso(),
    id,
  ]);
  return r.changes > 0;
}

/** EN_CURSO → HECHO. Devuelve false si el elemento fue reencolado mientras se enviaba (se reenviará). */
export async function markItemDone(id: number, db: Db = getDb()): Promise<boolean> {
  const r = await db.runAsync(
    "UPDATE sync_queue SET status = 'HECHO', last_error_code = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'EN_CURSO'",
    [nowIso(), id],
  );
  return r.changes > 0;
}

/** HECHO por entidad (lo usa la confirmación de una captura dentro de su transacción). */
export async function markEntityDone(type: SyncEntityType, entityId: string, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    "UPDATE sync_queue SET status = 'HECHO', last_error_code = NULL, last_error = NULL, updated_at = ? WHERE entity_type = ? AND entity_id = ? AND status = 'EN_CURSO'",
    [nowIso(), type, entityId],
  );
}

/**
 * Vuelve a PENDIENTE con espera. `countAttempt` = false para fallos de red (la falta de red no cuenta como intento,
 * §15.5 paso 6) y para reintentos inmediatos (padre reenviado, subida repetida).
 */
export async function markItemRetry(
  id: number,
  nextAttemptAt: string,
  code: string | null,
  detail: string | null,
  countAttempt: boolean,
  db: Db = getDb(),
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_queue SET status = 'PENDIENTE', attempts = attempts + ?, next_attempt_at = ?, last_error_code = ?, last_error = ?,
       updated_at = ? WHERE id = ? AND status = 'EN_CURSO'`,
    [countAttempt ? 1 : 0, nextAttemptAt, code, detail ? detail.slice(0, 500) : null, nowIso(), id],
  );
}

export async function markItemError(id: number, code: string, detail: string | null, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `UPDATE sync_queue SET status = 'ERROR_DEFINITIVO', attempts = attempts + 1, last_error_code = ?, last_error = ?, updated_at = ?
     WHERE id = ? AND status = 'EN_CURSO'`,
    [code.slice(0, 60), detail ? detail.slice(0, 500) : null, nowIso(), id],
  );
}

/**
 * "Reintentar errores" (PANT-20): ERROR_DEFINITIVO → PENDIENTE de inmediato y con attempts = 0 (igual que «Reintentar
 * transferencias con error» en la tabla de estados): el elemento recupera sus esperas cortas y sus reenvíos de padre
 * (MAX_PARENT_RESYNCS de syncService). Devuelve cuántos.
 */
export async function resetErrors(db: Db = getDb()): Promise<number> {
  const now = nowIso();
  const r = await db.runAsync(
    "UPDATE sync_queue SET status = 'PENDIENTE', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE status = 'ERROR_DEFINITIVO'",
    [now, now],
  );
  return r.changes;
}

/** Reenvía padres (SINCRONIZAR_PADRE): los elementos indicados vuelven a PENDIENTE sin espera. */
export async function requeueEntities(items: { type: SyncEntityType; entityId: string }[], db: Db = getDb()): Promise<void> {
  const now = nowIso();
  for (const it of items) {
    await db.runAsync(
      `UPDATE sync_queue SET status = 'PENDIENTE', next_attempt_at = ?, updated_at = ?
       WHERE entity_type = ? AND entity_id = ? AND status = 'HECHO'`,
      [now, now, it.type, it.entityId],
    );
  }
}

/** Al arrancar: lo que quedó EN_CURSO (app cerrada a mitad de un envío) vuelve a PENDIENTE. */
export async function releaseStuckItems(db: Db = getDb()): Promise<number> {
  const r = await db.runAsync("UPDATE sync_queue SET status = 'PENDIENTE', updated_at = ? WHERE status = 'EN_CURSO'", [nowIso()]);
  return r.changes;
}

/** ¿Todos los elementos de la sesión están HECHO? (y hay al menos uno) */
export async function isSessionFullySynced(sessionId: string, db: Db = getDb()): Promise<boolean> {
  const r = await db.getFirstAsync<{ total: number; done: number }>(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'HECHO' THEN 1 ELSE 0 END) AS done FROM sync_queue WHERE session_id = ?",
    [sessionId],
  );
  return (r?.total ?? 0) > 0 && r?.total === r?.done;
}

export interface SyncErrorItem {
  entityType: SyncEntityType;
  entityId: string;
  code: string | null;
  detail: string | null;
}

export interface SyncSessionSummary {
  sessionId: string;
  total: number;
  done: number;
  pending: number;
  errors: number;
  lastAttemptAt: string | null;
  /** Fotos de la sesión en la cola. */
  capturesTotal: number;
  capturesDone: number;
  capturesErrors: number;
  /** Bytes de las fotos que faltan subir (para avisar con datos móviles). */
  pendingCaptureBytes: number;
  errorItems: SyncErrorItem[];
}

export async function summarizeBySession(db: Db = getDb()): Promise<SyncSessionSummary[]> {
  const rows = await db.getAllAsync<{
    session_id: string;
    total: number;
    done: number;
    pending: number;
    errors: number;
    last: string | null;
    cap_total: number;
    cap_done: number;
    cap_errors: number;
    pending_bytes: number | null;
  }>(
    `SELECT q.session_id, COUNT(*) AS total,
       SUM(CASE WHEN q.status = 'HECHO' THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN q.status IN ('PENDIENTE','EN_CURSO') THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN q.status = 'ERROR_DEFINITIVO' THEN 1 ELSE 0 END) AS errors,
       MAX(CASE WHEN q.attempts > 0 OR q.status <> 'PENDIENTE' THEN q.updated_at END) AS last,
       SUM(CASE WHEN q.entity_type = 'CAPTURE' THEN 1 ELSE 0 END) AS cap_total,
       SUM(CASE WHEN q.entity_type = 'CAPTURE' AND q.status = 'HECHO' THEN 1 ELSE 0 END) AS cap_done,
       SUM(CASE WHEN q.entity_type = 'CAPTURE' AND q.status = 'ERROR_DEFINITIVO' THEN 1 ELSE 0 END) AS cap_errors,
       SUM(CASE WHEN q.entity_type = 'CAPTURE' AND q.status IN ('PENDIENTE','EN_CURSO')
                THEN COALESCE((SELECT c.size_bytes FROM captures c WHERE c.capture_id = q.entity_id), 0) ELSE 0 END) AS pending_bytes
     FROM sync_queue q GROUP BY q.session_id ORDER BY MIN(q.created_at) DESC`,
    [],
  );
  const errs = await db.getAllAsync<{
    session_id: string;
    entity_type: SyncEntityType;
    entity_id: string;
    last_error_code: string | null;
    last_error: string | null;
  }>(
    "SELECT session_id, entity_type, entity_id, last_error_code, last_error FROM sync_queue WHERE status = 'ERROR_DEFINITIVO' ORDER BY order_key, id",
    [],
  );
  const bySession = new Map<string, SyncErrorItem[]>();
  for (const e of errs) {
    const list = bySession.get(e.session_id) ?? [];
    list.push({ entityType: e.entity_type, entityId: e.entity_id, code: e.last_error_code, detail: e.last_error });
    bySession.set(e.session_id, list);
  }
  return rows.map((r) => ({
    sessionId: r.session_id,
    total: r.total,
    done: r.done,
    pending: r.pending,
    errors: r.errors,
    lastAttemptAt: r.last,
    capturesTotal: r.cap_total,
    capturesDone: r.cap_done,
    capturesErrors: r.cap_errors,
    pendingCaptureBytes: r.pending_bytes ?? 0,
    errorItems: bySession.get(r.session_id) ?? [],
  }));
}

/** Elementos sin confirmar por el backend (PENDIENTE o EN_CURSO): bloquean el cambio de función (RN-15). */
export async function countPendingSync(db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sync_queue WHERE status IN ('PENDIENTE','EN_CURSO')",
    [],
  );
  return r?.n ?? 0;
}

/** Elementos con error definitivo (requieren revisión; no se pierden). */
export async function countSyncErrors(db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'ERROR_DEFINITIVO'", []);
  return r?.n ?? 0;
}

/** Bytes de fotos pendientes de subir (aviso con datos móviles). */
export async function pendingCaptureBytes(db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number | null }>(
    `SELECT SUM(COALESCE(c.size_bytes, 0)) AS n FROM sync_queue q JOIN captures c ON c.capture_id = q.entity_id
     WHERE q.entity_type = 'CAPTURE' AND q.status IN ('PENDIENTE','EN_CURSO')`,
    [],
  );
  return r?.n ?? 0;
}
