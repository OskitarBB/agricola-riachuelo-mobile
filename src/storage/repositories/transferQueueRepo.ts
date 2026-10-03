// src/storage/repositories/transferQueueRepo.ts — Cola de la CÁMARA hacia el controlador (transfer_queue).
//
// QUÉ HACE: cada foto a enviar tiene una fila con prioridad (-1 prueba corta, 0 útil, 1 rechazada),
// intentos, fallos de checksum y la hora del próximo intento. src/camera/transferQueue.ts la procesa.

import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

export type TransferQueueStatus = 'PENDIENTE' | 'EN_CURSO' | 'HECHO' | 'ERROR';

export interface TransferItem {
  captureId: string;
  priority: number;
  status: TransferQueueStatus;
  attempts: number;
  checksumFailures: number;
  nextAttemptAt: string;
  lastError: string | null;
}

interface Row {
  capture_id: string;
  priority: number;
  status: TransferQueueStatus;
  attempts: number;
  checksum_failures: number;
  next_attempt_at: string;
  last_error: string | null;
}

const toDomain = (r: Row): TransferItem => ({
  captureId: r.capture_id,
  priority: r.priority,
  status: r.status,
  attempts: r.attempts,
  checksumFailures: r.checksum_failures,
  nextAttemptAt: r.next_attempt_at,
  lastError: r.last_error,
});

export async function enqueueTransfer(captureId: string, priority: number, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO transfer_queue (capture_id, priority, status, attempts, checksum_failures, next_attempt_at, last_error, updated_at)
     VALUES (?, ?, 'PENDIENTE', 0, 0, ?, NULL, ?) ON CONFLICT(capture_id) DO NOTHING`,
    [captureId, priority, now, now],
  );
}

/** Siguiente foto lista para enviar (prioridad y antigüedad), de las sesiones indicadas. */
export async function nextTransfer(sessionIds: string[], db: Db = getDb()): Promise<TransferItem | null> {
  if (sessionIds.length === 0) return null;
  const marks = sessionIds.map(() => '?').join(',');
  const r = await db.getFirstAsync<Row>(
    `SELECT q.* FROM transfer_queue q JOIN captures c ON c.capture_id = q.capture_id
     WHERE q.status = 'PENDIENTE' AND q.next_attempt_at <= ? AND c.session_id IN (${marks})
     ORDER BY q.priority ASC, q.next_attempt_at ASC LIMIT 1`,
    [nowIso(), ...sessionIds],
  );
  return r ? toDomain(r) : null;
}

export async function updateTransfer(
  captureId: string,
  patch: Partial<Pick<TransferItem, 'status' | 'attempts' | 'checksumFailures' | 'nextAttemptAt' | 'lastError'>>,
  db: Db = getDb(),
): Promise<void> {
  const map: Record<string, string> = {
    status: 'status',
    attempts: 'attempts',
    checksumFailures: 'checksum_failures',
    nextAttemptAt: 'next_attempt_at',
    lastError: 'last_error',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in map)) continue;
    sets.push(`${map[k]} = ?`);
    params.push((v ?? null) as string | number | null);
  }
  sets.push('updated_at = ?');
  params.push(nowIso(), captureId);
  await db.runAsync(`UPDATE transfer_queue SET ${sets.join(', ')} WHERE capture_id = ?`, params);
}

export async function getTransfer(captureId: string, db: Db = getDb()): Promise<TransferItem | null> {
  const r = await db.getFirstAsync<Row>('SELECT * FROM transfer_queue WHERE capture_id = ?', [captureId]);
  return r ? toDomain(r) : null;
}

/** Al arrancar: lo que quedó EN_CURSO vuelve a PENDIENTE (la app se cerró a mitad de envío). */
export async function resetInFlight(db: Db = getDb()): Promise<void> {
  await db.runAsync("UPDATE transfer_queue SET status = 'PENDIENTE' WHERE status = 'EN_CURSO'", []);
  await db.runAsync(
    "UPDATE captures SET local_transfer_status = 'PENDIENTE_LOCAL' WHERE local_transfer_status = 'TRANSFIRIENDO_LOCAL'",
    [],
  );
}

/** "Reintentar transferencias con error": ERROR → PENDIENTE con contadores en cero. Devuelve cuántas. */
export async function retryErrored(db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transfer_queue WHERE status = 'ERROR'", []);
  const now = nowIso();
  await db.runAsync(
    "UPDATE transfer_queue SET status = 'PENDIENTE', attempts = 0, checksum_failures = 0, next_attempt_at = ?, updated_at = ? WHERE status = 'ERROR'",
    [now, now],
  );
  await db.runAsync(
    "UPDATE captures SET local_transfer_status = 'PENDIENTE_LOCAL' WHERE local_transfer_status = 'ERROR_LOCAL'",
    [],
  );
  return r?.n ?? 0;
}

export async function deleteTransfersOfSession(sessionId: string, onlyTest: boolean, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `DELETE FROM transfer_queue WHERE capture_id IN (SELECT capture_id FROM captures WHERE session_id = ? ${onlyTest ? 'AND is_test = 1' : ''})`,
    [sessionId],
  );
}

export async function countQueue(db: Db = getDb()): Promise<{ pending: number; errors: number }> {
  const r = await db.getFirstAsync<{ pending: number; errors: number }>(
    `SELECT SUM(CASE WHEN status IN ('PENDIENTE','EN_CURSO') THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) AS errors FROM transfer_queue`,
    [],
  );
  return { pending: r?.pending ?? 0, errors: r?.errors ?? 0 };
}
