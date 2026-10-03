// src/storage/repositories/passRepo.ts — Pasadas, cambios de marcador y repeticiones (controlador).
//
// QUÉ HACE: lee y escribe monitoring_passes, marker_changes y retake_requests. Las filas de evidencia
// nunca se eliminan (maestro §12.5).

import type {
  Direction,
  GpsFix,
  LateralCode,
  MarkerChange,
  MonitoringPass,
  PassStatus,
  RemoteSyncStatus,
  RetakeRequest,
} from '../../domain/types';
import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

interface PassRow {
  pass_id: string;
  session_id: string;
  lot_id: string;
  row_id: string;
  lateral_code: LateralCode;
  pass_order: number;
  direction: Direction;
  start_marker_id: string | null;
  end_marker_id: string | null;
  current_segment_id: string | null;
  current_marker_id: string | null;
  status: PassStatus;
  started_at: string | null;
  ended_at: string | null;
  sequences_total: number;
  sequences_complete: number;
  sequences_incomplete: number;
  remote_sync_status: RemoteSyncStatus;
}

function toDomain(r: PassRow): MonitoringPass {
  return {
    passId: r.pass_id,
    sessionId: r.session_id,
    lotId: r.lot_id,
    rowId: r.row_id,
    lateralCode: r.lateral_code,
    passOrder: r.pass_order,
    direction: r.direction,
    startMarkerId: r.start_marker_id,
    endMarkerId: r.end_marker_id,
    currentSegmentId: r.current_segment_id,
    currentMarkerId: r.current_marker_id,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    sequencesTotal: r.sequences_total,
    sequencesComplete: r.sequences_complete,
    sequencesIncomplete: r.sequences_incomplete,
    remoteSyncStatus: r.remote_sync_status,
  };
}

export async function insertPass(p: MonitoringPass, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO monitoring_passes (pass_id, session_id, lot_id, row_id, lateral_code, pass_order, direction, start_marker_id,
      end_marker_id, current_segment_id, current_marker_id, status, started_at, ended_at, sequences_total, sequences_complete,
      sequences_incomplete, remote_sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.passId,
      p.sessionId,
      p.lotId,
      p.rowId,
      p.lateralCode,
      p.passOrder,
      p.direction,
      p.startMarkerId,
      p.endMarkerId,
      p.currentSegmentId,
      p.currentMarkerId,
      p.status,
      p.startedAt,
      p.endedAt,
      p.sequencesTotal,
      p.sequencesComplete,
      p.sequencesIncomplete,
      p.remoteSyncStatus,
      now,
      now,
    ],
  );
}

export async function getPass(passId: string, db: Db = getDb()): Promise<MonitoringPass | null> {
  const r = await db.getFirstAsync<PassRow>('SELECT * FROM monitoring_passes WHERE pass_id = ?', [passId]);
  return r ? toDomain(r) : null;
}

export async function listPasses(sessionId: string, db: Db = getDb()): Promise<MonitoringPass[]> {
  const rows = await db.getAllAsync<PassRow>('SELECT * FROM monitoring_passes WHERE session_id = ? ORDER BY created_at', [
    sessionId,
  ]);
  return rows.map(toDomain);
}

export async function getOpenPass(sessionId: string, db: Db = getDb()): Promise<MonitoringPass | null> {
  const r = await db.getFirstAsync<PassRow>(
    "SELECT * FROM monitoring_passes WHERE session_id = ? AND status IN ('READY','ACTIVE','PAUSED') ORDER BY created_at DESC LIMIT 1",
    [sessionId],
  );
  return r ? toDomain(r) : null;
}

export async function updatePass(
  passId: string,
  patch: Partial<
    Pick<
      MonitoringPass,
      | 'status'
      | 'startedAt'
      | 'endedAt'
      | 'endMarkerId'
      | 'currentSegmentId'
      | 'currentMarkerId'
      | 'sequencesTotal'
      | 'sequencesComplete'
      | 'sequencesIncomplete'
      | 'remoteSyncStatus'
    >
  >,
  db: Db = getDb(),
): Promise<void> {
  const map: Record<string, string> = {
    status: 'status',
    startedAt: 'started_at',
    endedAt: 'ended_at',
    endMarkerId: 'end_marker_id',
    currentSegmentId: 'current_segment_id',
    currentMarkerId: 'current_marker_id',
    sequencesTotal: 'sequences_total',
    sequencesComplete: 'sequences_complete',
    sequencesIncomplete: 'sequences_incomplete',
    remoteSyncStatus: 'remote_sync_status',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in map)) continue;
    sets.push(`${map[k]} = ?`);
    params.push((v ?? null) as string | number | null);
  }
  sets.push('updated_at = ?');
  params.push(nowIso(), passId);
  await db.runAsync(`UPDATE monitoring_passes SET ${sets.join(', ')} WHERE pass_id = ?`, params);
}

// ------------------------------------------------------------------ marker_changes

export async function insertMarkerChange(c: MarkerChange, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO marker_changes (marker_change_id, pass_id, marker_id, segment_id, changed_at, lat, lon, gps_accuracy_m, gps_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      c.markerChangeId,
      c.passId,
      c.markerId,
      c.segmentId,
      c.changedAt,
      c.gps?.lat ?? null,
      c.gps?.lon ?? null,
      c.gps?.accuracyM ?? null,
      c.gps?.timestamp ?? null,
    ],
  );
}

export async function listMarkerChanges(passId: string, db: Db = getDb()): Promise<MarkerChange[]> {
  const rows = await db.getAllAsync<{
    marker_change_id: string;
    pass_id: string;
    marker_id: string | null;
    segment_id: string | null;
    changed_at: string;
    lat: number | null;
    lon: number | null;
    gps_accuracy_m: number | null;
    gps_timestamp: string | null;
  }>('SELECT * FROM marker_changes WHERE pass_id = ? ORDER BY changed_at', [passId]);
  return rows.map((r) => ({
    markerChangeId: r.marker_change_id,
    passId: r.pass_id,
    markerId: r.marker_id,
    segmentId: r.segment_id,
    changedAt: r.changed_at,
    gps: gpsFrom(r.lat, r.lon, r.gps_accuracy_m, r.gps_timestamp),
  }));
}

// ------------------------------------------------------------------ retake_requests

export async function insertRetake(r: RetakeRequest, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO retake_requests (capture_id, sequence_id, pass_id, camera_role, replaces_capture_id, requested_at, segment_id,
       marker_id, lat, lon, gps_accuracy_m, gps_timestamp, gps_age_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.captureId,
      r.sequenceId,
      r.passId,
      r.cameraRole,
      r.replacesCaptureId,
      r.requestedAt,
      r.segmentId,
      r.markerId,
      r.gps?.lat ?? null,
      r.gps?.lon ?? null,
      r.gps?.accuracyM ?? null,
      r.gps?.timestamp ?? null,
      r.gpsAgeMs,
    ],
  );
}

export async function countRetakes(passId: string, db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM retake_requests WHERE pass_id = ?', [passId]);
  return r?.n ?? 0;
}

export async function isRetakeCapture(captureId: string, db: Db = getDb()): Promise<boolean> {
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM retake_requests WHERE capture_id = ?', [captureId]);
  return (r?.n ?? 0) > 0;
}

export function gpsFrom(lat: number | null, lon: number | null, accuracy: number | null, ts: string | null): GpsFix | null {
  if (lat === null || lon === null || ts === null) return null;
  return { lat, lon, accuracyM: accuracy, timestamp: ts };
}
