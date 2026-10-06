// src/storage/repositories/captureRepo.ts — Capturas (fotos) y resultados de calidad.
//
// QUÉ HACE: tabla `captures` (en cámaras y controlador) y `quality_results`.
//  - En la CÁMARA: cada foto tomada, su calidad y su estado de transferencia al controlador.
//  - En el CONTROLADOR: cada foto recibida (o esperada) y su estado de sincronización con la nube.
// Las filas nunca se eliminan; liberar espacio solo borra el archivo y marca file_deleted_at (RN-09).
// Fase 4: el controlador marca remote_sync_status (PENDIENTE_NUBE → SUBIENDO → SINCRONIZADO o ERROR_SINCRONIZACION)
// con setRemoteSyncStatus(); el archivo nunca se borra por haberse subido (solo por "Liberar espacio", RN-09).

import type {
  Capture,
  CameraRole,
  LateralCode,
  LocalTransferStatus,
  QualityResult,
  QualityStatus,
  RemoteSyncStatus,
} from '../../domain/types';
import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

interface CaptureRow {
  capture_id: string;
  sequence_id: string;
  session_id: string;
  pass_id: string | null;
  lateral_code: LateralCode | null;
  is_test: number;
  device_id: string;
  camera_role: CameraRole;
  user_id: string;
  captured_at: string;
  file_path: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  md5: string | null;
  quality_status: QualityStatus;
  quality_profile_version: string;
  replaces_capture_id: string | null;
  local_transfer_status: LocalTransferStatus;
  remote_sync_status: RemoteSyncStatus | null;
  transfer_attempts: number;
  sync_attempts: number;
  last_error: string | null;
  file_deleted_at: string | null;
}

function toDomain(r: CaptureRow): Capture {
  return {
    captureId: r.capture_id,
    sequenceId: r.sequence_id,
    sessionId: r.session_id,
    passId: r.pass_id,
    lateralCode: r.lateral_code,
    isTest: r.is_test === 1,
    deviceId: r.device_id,
    cameraRole: r.camera_role,
    userId: r.user_id,
    capturedAt: r.captured_at,
    filePath: r.file_path,
    sizeBytes: r.size_bytes,
    width: r.width,
    height: r.height,
    md5: r.md5,
    qualityStatus: r.quality_status,
    qualityProfileVersion: r.quality_profile_version,
    replacesCaptureId: r.replaces_capture_id,
    localTransferStatus: r.local_transfer_status,
    remoteSyncStatus: r.remote_sync_status,
    transferAttempts: r.transfer_attempts,
    syncAttempts: r.sync_attempts,
    lastError: r.last_error,
    fileDeletedAt: r.file_deleted_at,
  };
}

/** Inserta o reemplaza los metadatos de una captura (idempotente por captureId). */
export async function upsertCapture(c: Capture, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO captures (capture_id, sequence_id, session_id, pass_id, lateral_code, is_test, device_id, camera_role, user_id,
       captured_at, file_path, size_bytes, width, height, md5, quality_status, quality_profile_version, replaces_capture_id,
       local_transfer_status, remote_sync_status, transfer_attempts, sync_attempts, last_error, file_deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_id) DO UPDATE SET file_path = COALESCE(excluded.file_path, captures.file_path),
       size_bytes = excluded.size_bytes, width = excluded.width, height = excluded.height, md5 = excluded.md5,
       quality_status = excluded.quality_status, quality_profile_version = excluded.quality_profile_version,
       local_transfer_status = excluded.local_transfer_status, remote_sync_status = excluded.remote_sync_status,
       captured_at = excluded.captured_at,
       -- Fase 4: los metadatos que trae la foto (cámara) prevalecen sobre la fila provisional creada con CAPTURE_OK.
       user_id = CASE WHEN excluded.user_id <> '' THEN excluded.user_id ELSE captures.user_id END,
       device_id = excluded.device_id,
       pass_id = COALESCE(excluded.pass_id, captures.pass_id),
       lateral_code = COALESCE(excluded.lateral_code, captures.lateral_code),
       replaces_capture_id = COALESCE(excluded.replaces_capture_id, captures.replaces_capture_id),
       updated_at = excluded.updated_at`,
    [
      c.captureId,
      c.sequenceId,
      c.sessionId,
      c.passId,
      c.lateralCode,
      c.isTest ? 1 : 0,
      c.deviceId,
      c.cameraRole,
      c.userId,
      c.capturedAt,
      c.filePath,
      c.sizeBytes,
      c.width,
      c.height,
      c.md5,
      c.qualityStatus,
      c.qualityProfileVersion,
      c.replacesCaptureId,
      c.localTransferStatus,
      c.remoteSyncStatus,
      c.transferAttempts,
      c.syncAttempts,
      c.lastError,
      c.fileDeletedAt,
      now,
      now,
    ],
  );
}

export async function getCapture(captureId: string, db: Db = getDb()): Promise<Capture | null> {
  const r = await db.getFirstAsync<CaptureRow>('SELECT * FROM captures WHERE capture_id = ?', [captureId]);
  return r ? toDomain(r) : null;
}

export async function getCaptureByFile(fileUri: string, db: Db = getDb()): Promise<Capture | null> {
  const r = await db.getFirstAsync<CaptureRow>('SELECT * FROM captures WHERE file_path = ?', [fileUri]);
  return r ? toDomain(r) : null;
}

export async function updateCapture(
  captureId: string,
  patch: Partial<
    Pick<
      Capture,
      | 'filePath'
      | 'sizeBytes'
      | 'width'
      | 'height'
      | 'md5'
      | 'qualityStatus'
      | 'localTransferStatus'
      | 'remoteSyncStatus'
      | 'transferAttempts'
      | 'lastError'
      | 'fileDeletedAt'
    >
  >,
  db: Db = getDb(),
): Promise<void> {
  const map: Record<string, string> = {
    filePath: 'file_path',
    sizeBytes: 'size_bytes',
    width: 'width',
    height: 'height',
    md5: 'md5',
    qualityStatus: 'quality_status',
    localTransferStatus: 'local_transfer_status',
    remoteSyncStatus: 'remote_sync_status',
    transferAttempts: 'transfer_attempts',
    lastError: 'last_error',
    fileDeletedAt: 'file_deleted_at',
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
  await db.runAsync(`UPDATE captures SET ${sets.join(', ')} WHERE capture_id = ?`, params);
}

export async function listCapturesBySession(sessionId: string, db: Db = getDb()): Promise<Capture[]> {
  const rows = await db.getAllAsync<CaptureRow>('SELECT * FROM captures WHERE session_id = ? ORDER BY captured_at', [sessionId]);
  return rows.map(toDomain);
}

export async function listCapturesBySequence(sequenceId: string, db: Db = getDb()): Promise<Capture[]> {
  const rows = await db.getAllAsync<CaptureRow>('SELECT * FROM captures WHERE sequence_id = ? ORDER BY captured_at', [
    sequenceId,
  ]);
  return rows.map(toDomain);
}

/** Capturas (con fila) que aún no llegan al controlador, por rol (PANT-19). */
export async function countMissingByRole(sessionId: string, db: Db = getDb()): Promise<Record<CameraRole, number>> {
  const rows = await db.getAllAsync<{ camera_role: CameraRole; n: number }>(
    `SELECT camera_role, COUNT(*) AS n FROM captures WHERE session_id = ? AND is_test = 0
       AND local_transfer_status <> 'RECIBIDA_CONTROLADOR' GROUP BY camera_role`,
    [sessionId],
  );
  const out: Record<CameraRole, number> = { CAMERA_1: 0, CAMERA_2: 0 };
  for (const r of rows) out[r.camera_role] = r.n;
  return out;
}

/** Cámara: transferencias pendientes (o con error) de este celular (RN-15). */
export async function countPendingTransfers(db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM captures WHERE local_transfer_status IN ('PENDIENTE_LOCAL','TRANSFIRIENDO_LOCAL','ERROR_LOCAL') AND file_deleted_at IS NULL",
    [],
  );
  return r?.n ?? 0;
}

/** Cámara: capturas de evidencia de una sesión que no están RECIBIDA_CONTROLADOR (RESYNC_STATE, 14.9). */
export async function listUnreceivedEvidence(sessionId: string, db: Db = getDb()): Promise<Capture[]> {
  const rows = await db.getAllAsync<CaptureRow>(
    "SELECT * FROM captures WHERE session_id = ? AND is_test = 0 AND local_transfer_status <> 'RECIBIDA_CONTROLADOR' ORDER BY captured_at",
    [sessionId],
  );
  return rows.map(toDomain);
}

/** Cámara: capturas que quedaron en CAPTURED (la app se cerró durante la calidad, 8.10). */
export async function listCapturedNotEvaluated(db: Db = getDb()): Promise<Capture[]> {
  const rows = await db.getAllAsync<CaptureRow>("SELECT * FROM captures WHERE quality_status = 'CAPTURED'", []);
  return rows.map(toDomain);
}

// ------------------------------------------------------------------ quality_results

export async function upsertQualityResult(captureId: string, q: QualityResult, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO quality_results (capture_id, profile_version, status, reasons_json, luminance_mean, dark_ratio, bright_ratio,
       laplacian_variance, analyzed_regions, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(capture_id) DO UPDATE SET profile_version = excluded.profile_version, status = excluded.status,
       reasons_json = excluded.reasons_json, luminance_mean = excluded.luminance_mean, dark_ratio = excluded.dark_ratio,
       bright_ratio = excluded.bright_ratio, laplacian_variance = excluded.laplacian_variance,
       analyzed_regions = excluded.analyzed_regions, duration_ms = excluded.duration_ms`,
    [
      captureId,
      q.profileVersion,
      q.status,
      JSON.stringify(q.reasons),
      q.metrics?.luminanceMean ?? null,
      q.metrics?.darkRatio ?? null,
      q.metrics?.brightRatio ?? null,
      q.metrics?.laplacianVariance ?? null,
      q.metrics?.analyzedRegions ?? null,
      q.metrics?.durationMs ?? null,
      nowIso(),
    ],
  );
}

export async function getQualityResult(captureId: string, db: Db = getDb()): Promise<QualityResult | null> {
  const r = await db.getFirstAsync<{
    profile_version: string;
    status: QualityResult['status'];
    reasons_json: string;
    luminance_mean: number | null;
    dark_ratio: number | null;
    bright_ratio: number | null;
    laplacian_variance: number | null;
    analyzed_regions: number | null;
    duration_ms: number | null;
  }>('SELECT * FROM quality_results WHERE capture_id = ?', [captureId]);
  if (!r) return null;
  return {
    status: r.status,
    profileVersion: r.profile_version,
    reasons: JSON.parse(r.reasons_json) as QualityResult['reasons'],
    metrics:
      r.luminance_mean === null
        ? null
        : {
            luminanceMean: r.luminance_mean,
            darkRatio: r.dark_ratio ?? 0,
            brightRatio: r.bright_ratio ?? 0,
            laplacianVariance: r.laplacian_variance ?? -1,
            analyzedRegions: r.analyzed_regions ?? 0,
            durationMs: r.duration_ms ?? 0,
          },
  };
}

// ------------------------------------------------------------------ sincronización (controlador, Fase 4)

/** Estado de la captura respecto de la plataforma Django (y el error visible en PANT-20, si lo hay). */
export async function setRemoteSyncStatus(
  captureId: string,
  status: RemoteSyncStatus,
  lastError: string | null = null,
  db: Db = getDb(),
): Promise<void> {
  await db.runAsync(
    `UPDATE captures SET remote_sync_status = ?, last_error = ?,
       sync_attempts = sync_attempts + CASE WHEN ? IN ('SINCRONIZADO','ERROR_SINCRONIZACION') THEN 1 ELSE 0 END,
       updated_at = ? WHERE capture_id = ?`,
    [status, lastError, status, nowIso(), captureId],
  );
}

/** Sesión → SINCRONIZADO: todas sus capturas de evidencia ya confirmadas en el servidor. */
export async function countUnsyncedEvidence(sessionId: string, db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM captures WHERE session_id = ? AND is_test = 0 AND local_transfer_status = 'RECIBIDA_CONTROLADOR'
       AND COALESCE(remote_sync_status, 'PENDIENTE_NUBE') <> 'SINCRONIZADO'`,
    [sessionId],
  );
  return r?.n ?? 0;
}

/** "Reintentar errores" (PANT-20): las fotos con error de sincronización vuelven a PENDIENTE_NUBE. */
export async function resetCaptureSyncErrors(db: Db = getDb()): Promise<number> {
  const r = await db.runAsync(
    "UPDATE captures SET remote_sync_status = 'PENDIENTE_NUBE', updated_at = ? WHERE remote_sync_status = 'ERROR_SINCRONIZACION'",
    [nowIso()],
  );
  return r.changes;
}

/** Al arrancar: una foto que quedó SUBIENDO (app cerrada a mitad del envío) vuelve a PENDIENTE_NUBE. */
export async function releaseUploadingCaptures(db: Db = getDb()): Promise<number> {
  const r = await db.runAsync(
    "UPDATE captures SET remote_sync_status = 'PENDIENTE_NUBE', updated_at = ? WHERE remote_sync_status = 'SUBIENDO'",
    [nowIso()],
  );
  return r.changes;
}
