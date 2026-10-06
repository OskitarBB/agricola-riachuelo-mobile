// src/storage/repositories/remoteUploadRepo.ts — Tabla remote_uploads (migración 003, maestro v2.0 §12.1.1).
//
// QUÉ HACE: guarda el resultado de la subida directa de cada foto a Cloudinary en el CONTROLADOR, para confirmar
// en Django sin volver a subir si la app se cerró entre la subida y la confirmación (D-31, RF-51).
// Las filas nunca se borran (trazabilidad). Las transacciones las arma src/sync/syncService.ts (R-14).

import type { CloudinaryUploadResult } from '../../api/dto';
import { nowIso } from '../../domain/time';
import type { RemoteUploadStatus, StoredUpload } from '../../sync/captureUploader';
import { getDb, type Db } from '../db';

interface RemoteUploadRow {
  capture_id: string;
  status: RemoteUploadStatus;
  public_id: string;
  version: number;
  signature: string;
  bytes: number;
  format: string | null;
  width: number | null;
  height: number | null;
  etag: string | null;
  uploaded_at: string;
  confirmed_at: string | null;
  reupload_count: number;
  last_error_code: string | null;
  updated_at: string;
}

export interface RemoteUpload extends StoredUpload {
  captureId: string;
  uploadedAt: string;
  confirmedAt: string | null;
  lastErrorCode: string | null;
}

function toDomain(r: RemoteUploadRow): RemoteUpload {
  return {
    captureId: r.capture_id,
    status: r.status,
    result: {
      publicId: r.public_id,
      version: r.version,
      signature: r.signature,
      bytes: r.bytes,
      format: r.format,
      width: r.width,
      height: r.height,
      etag: r.etag,
      existing: false,
    },
    reuploadCount: r.reupload_count,
    uploadedAt: r.uploaded_at,
    confirmedAt: r.confirmed_at,
    lastErrorCode: r.last_error_code,
  };
}

export async function getRemoteUpload(captureId: string, db: Db = getDb()): Promise<RemoteUpload | null> {
  const r = await db.getFirstAsync<RemoteUploadRow>('SELECT * FROM remote_uploads WHERE capture_id = ?', [captureId]);
  return r ? toDomain(r) : null;
}

/** Escribe o reescribe la fila con status SUBIDA (subida exitosa a Cloudinary). */
export async function saveUploaded(
  captureId: string,
  result: CloudinaryUploadResult,
  reuploadCount: number,
  db: Db = getDb(),
): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO remote_uploads (capture_id, status, public_id, version, signature, bytes, format, width, height, etag,
       uploaded_at, confirmed_at, reupload_count, last_error_code, updated_at)
     VALUES (?, 'SUBIDA', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)
     ON CONFLICT(capture_id) DO UPDATE SET status = 'SUBIDA', public_id = excluded.public_id, version = excluded.version,
       signature = excluded.signature, bytes = excluded.bytes, format = excluded.format, width = excluded.width,
       height = excluded.height, etag = excluded.etag, uploaded_at = excluded.uploaded_at, confirmed_at = NULL,
       reupload_count = excluded.reupload_count, last_error_code = NULL, updated_at = excluded.updated_at`,
    [
      captureId,
      result.publicId,
      result.version,
      result.signature,
      result.bytes,
      result.format,
      result.width,
      result.height,
      result.etag,
      now,
      reuploadCount,
      now,
    ],
  );
}

export async function markRemoteConfirmed(captureId: string, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    "UPDATE remote_uploads SET status = 'CONFIRMADA', confirmed_at = ?, last_error_code = NULL, updated_at = ? WHERE capture_id = ?",
    [now, now, captureId],
  );
}

export async function markRemoteDiscarded(captureId: string, code: string, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    "UPDATE remote_uploads SET status = 'DESCARTADA', last_error_code = ?, updated_at = ? WHERE capture_id = ?",
    [code.slice(0, 60), nowIso(), captureId],
  );
}

export interface RemoteUploadCounts {
  /** Fotos que Django ya confirmó (captures.remote_sync_status = SINCRONIZADO). */
  confirmed: number;
  /** Subidas a Cloudinary que todavía no se confirmaron en Django (remote_uploads SUBIDA). */
  uploadedNotConfirmed: number;
  /** Subidas rechazadas por Django que se volverán a subir (remote_uploads DESCARTADA). */
  discarded: number;
}

/**
 * Conteo por sesión para PANT-20: fotos en la nube (confirmadas en Django, aunque se hayan confirmado con
 * alreadyConfirmed y sin fila en remote_uploads), subidas pendientes de confirmar y descartadas.
 */
export async function countRemoteUploadsBySession(db: Db = getDb()): Promise<Map<string, RemoteUploadCounts>> {
  const out = new Map<string, RemoteUploadCounts>();
  const get = (sessionId: string) => {
    const e = out.get(sessionId) ?? { confirmed: 0, uploadedNotConfirmed: 0, discarded: 0 };
    out.set(sessionId, e);
    return e;
  };
  const synced = await db.getAllAsync<{ session_id: string; n: number }>(
    `SELECT session_id, COUNT(*) AS n FROM captures WHERE is_test = 0 AND remote_sync_status = 'SINCRONIZADO' GROUP BY session_id`,
    [],
  );
  for (const r of synced) get(r.session_id).confirmed = r.n;
  const rows = await db.getAllAsync<{ session_id: string; status: RemoteUploadStatus; n: number }>(
    `SELECT c.session_id AS session_id, r.status AS status, COUNT(*) AS n
       FROM remote_uploads r JOIN captures c ON c.capture_id = r.capture_id
      WHERE r.status <> 'CONFIRMADA'
      GROUP BY c.session_id, r.status`,
    [],
  );
  for (const r of rows) {
    const e = get(r.session_id);
    if (r.status === 'SUBIDA') e.uploadedNotConfirmed += r.n;
    else e.discarded += r.n;
  }
  return out;
}

/**
 * "Reintentar errores" (PANT-20): una foto que agotó sus subidas repetidas (REINTENTOS_DE_SUBIDA_AGOTADOS) vuelve a
 * tener sync.maxReuploads intentos. Es una acción explícita del operador; el historial queda en event_log (REUPLOAD).
 */
export async function resetExhaustedReuploads(db: Db = getDb()): Promise<number> {
  const r = await db.runAsync(
    `UPDATE remote_uploads SET reupload_count = 0, updated_at = ?
     WHERE status = 'DESCARTADA' AND capture_id IN (
       SELECT entity_id FROM sync_queue WHERE entity_type = 'CAPTURE' AND status = 'ERROR_DEFINITIVO'
         AND last_error_code = 'REINTENTOS_DE_SUBIDA_AGOTADOS')`,
    [nowIso()],
  );
  return r.changes;
}
