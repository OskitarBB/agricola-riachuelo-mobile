// src/storage/repositories/deletionRepo.ts — Copia local de lo que el administrador borró (plataforma v1.3.1).
//
// QUÉ HACE: para fotos o sesiones eliminadas en el servidor:
//  - devuelve las rutas de los archivos de esas fotos (los borra deletionService, fuera de la transacción);
//  - marca file_deleted_at y la nota «ELIMINADA_POR_ADMIN» en captures (la fila se conserva, RN-09);
//  - cierra (HECHO) lo que estaba en la cola de sincronización para no volver a enviarlo, y quita la foto de la cola
//    de transferencia de la cámara;
//  - una sesión borrada que estaba CLOSED pasa a SYNCED (ya no queda nada por enviar).

import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';
import { markSessionSynced } from './sessionRepo';

export const DELETED_NOTE = 'ELIMINADA_POR_ADMIN';

interface FileRow {
  capture_id: string;
  file_path: string | null;
}

/** Rutas de archivos todavía presentes de esas fotos (para borrarlos después de la transacción). */
export async function filesOfCaptures(captureIds: readonly string[], db: Db = getDb()): Promise<string[]> {
  if (captureIds.length === 0) return [];
  const marks = captureIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<FileRow>(
    `SELECT capture_id, file_path FROM captures WHERE capture_id IN (${marks}) AND file_path IS NOT NULL`,
    [...captureIds],
  );
  return rows.map((r) => r.file_path).filter((p): p is string => !!p);
}

export async function captureIdsOfSession(sessionId: string, db: Db = getDb()): Promise<string[]> {
  const rows = await db.getAllAsync<{ capture_id: string }>('SELECT capture_id FROM captures WHERE session_id = ?', [
    sessionId,
  ]);
  return rows.map((r) => r.capture_id);
}

/** Marca las fotos como borradas por el administrador y cierra sus elementos de cola. Devuelve cuántas existían. */
export async function markCapturesDeleted(captureIds: readonly string[], code: string, db: Db = getDb()): Promise<number> {
  if (captureIds.length === 0) return 0;
  const now = nowIso();
  const marks = captureIds.map(() => '?').join(',');
  const ids = [...captureIds];
  const r = await db.runAsync(
    `UPDATE captures SET file_deleted_at = COALESCE(file_deleted_at, ?), last_error = ?, updated_at = ? WHERE capture_id IN (${marks})`,
    [now, DELETED_NOTE, now, ...ids],
  );
  await db.runAsync(
    `UPDATE sync_queue SET status = 'HECHO', last_error_code = ?, last_error = NULL, updated_at = ?
      WHERE entity_type = 'CAPTURE' AND entity_id IN (${marks}) AND status <> 'HECHO'`,
    [code, now, ...ids],
  );
  await db.runAsync(`DELETE FROM transfer_queue WHERE capture_id IN (${marks})`, ids);
  return r.changes;
}

/** Cierra toda la cola de una sesión borrada en el servidor y, si estaba CLOSED, la deja SYNCED. */
export async function markSessionDeleted(sessionId: string, code: string, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    "UPDATE sync_queue SET status = 'HECHO', last_error_code = ?, last_error = NULL, updated_at = ? WHERE session_id = ? AND status <> 'HECHO'",
    [code, nowIso(), sessionId],
  );
  await markSessionSynced(sessionId, db);
}
