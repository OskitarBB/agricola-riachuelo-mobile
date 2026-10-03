// src/camera/retentionService.ts — Liberación de espacio según la política de retención (RN-09, D-23).
//
// QUÉ HACE:
//  - CÁMARA (TRAS_SINCRONIZACION): al recibir PAIRED.syncedSessionIds, borra SOLO los archivos de sus fotos
//    que el controlador ya confirmó (RECIBIDA_CONTROLADOR). La fila se conserva con file_deleted_at.
//  - CONTROLADOR (CONSERVAR): "Liberar espacio" en Ajustes borra solo fotos de sesiones SYNCED, y solo a mano.
//  - Nunca se borra nada de una sesión abierta.

import { CONFIG } from '../config';
import { nowIso } from '../domain/time';
import { logEvent } from '../diagnostics/eventLog';
import { getDb } from '../storage/db';
import { deleteFileIfExists } from '../storage/files';
import { updateCapture } from '../storage/repositories/captureRepo';

export async function releaseCameraPhotos(syncedSessionIds: string[]): Promise<number> {
  if (CONFIG.retention.cameraPolicy !== 'TRAS_SINCRONIZACION' || syncedSessionIds.length === 0) return 0;
  const marks = syncedSessionIds.map(() => '?').join(',');
  const rows = await getDb().getAllAsync<{ capture_id: string; file_path: string | null }>(
    `SELECT capture_id, file_path FROM captures WHERE session_id IN (${marks})
       AND local_transfer_status = 'RECIBIDA_CONTROLADOR' AND file_deleted_at IS NULL`,
    syncedSessionIds,
  );
  for (const r of rows) {
    deleteFileIfExists(r.file_path);
    await updateCapture(r.capture_id, { fileDeletedAt: nowIso() });
  }
  if (rows.length > 0) logEvent('INFO', 'TRANSFER', 'RETENTION', { released: rows.length });
  return rows.length;
}

/** Controlador: "Liberar espacio" (solo sesiones SYNCED, acción manual). */
export async function releaseControllerSyncedPhotos(): Promise<number> {
  const rows = await getDb().getAllAsync<{ capture_id: string; file_path: string | null }>(
    `SELECT c.capture_id, c.file_path FROM captures c JOIN monitoring_sessions s ON s.session_id = c.session_id
     WHERE s.status = 'SYNCED' AND c.remote_sync_status = 'SINCRONIZADO' AND c.file_deleted_at IS NULL`,
    [],
  );
  for (const r of rows) {
    deleteFileIfExists(r.file_path);
    await updateCapture(r.capture_id, { fileDeletedAt: nowIso() });
  }
  return rows.length;
}
