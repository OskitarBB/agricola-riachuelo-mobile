// src/storage/repositories/sequenceRepo.ts — Secuencias de captura (controlador).
//
// QUÉ HACE: una secuencia = una orden coordinada a las dos cámaras con dos captureId (uno por cámara),
// el contexto vigente (lote, hilera, segmento, marcador) y el GPS de ese momento (RF-21, RN-18).

import type { CameraRole, CaptureMode, CaptureSequence, RemoteSyncStatus, SequenceStatus, SlotOutcome } from '../../domain/types';
import { getDb, type Db } from '../db';
import { gpsFrom } from './passRepo';

interface SeqRow {
  sequence_id: string;
  pass_id: string;
  session_id: string;
  sequence_number: number;
  mode: CaptureMode;
  status: SequenceStatus;
  lot_id: string;
  row_id: string;
  segment_id: string | null;
  marker_id: string | null;
  lat: number | null;
  lon: number | null;
  gps_accuracy_m: number | null;
  gps_timestamp: string | null;
  gps_age_ms: number | null;
  issued_at: string;
  expires_at: string;
  completed_at: string | null;
  slot1_capture_id: string;
  slot1_outcome: SlotOutcome;
  slot2_capture_id: string;
  slot2_outcome: SlotOutcome;
  remote_sync_status: RemoteSyncStatus;
}

function toDomain(r: SeqRow): CaptureSequence {
  return {
    sequenceId: r.sequence_id,
    passId: r.pass_id,
    sessionId: r.session_id,
    sequenceNumber: r.sequence_number,
    mode: r.mode,
    status: r.status,
    lotId: r.lot_id,
    rowId: r.row_id,
    segmentId: r.segment_id,
    markerId: r.marker_id,
    gps: gpsFrom(r.lat, r.lon, r.gps_accuracy_m, r.gps_timestamp),
    gpsAgeMs: r.gps_age_ms,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    completedAt: r.completed_at,
    slots: {
      CAMERA_1: { role: 'CAMERA_1', captureId: r.slot1_capture_id, outcome: r.slot1_outcome },
      CAMERA_2: { role: 'CAMERA_2', captureId: r.slot2_capture_id, outcome: r.slot2_outcome },
    },
    remoteSyncStatus: r.remote_sync_status,
  };
}

export async function insertSequence(s: CaptureSequence, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO capture_sequences (sequence_id, pass_id, session_id, sequence_number, mode, status, lot_id, row_id, segment_id,
      marker_id, lat, lon, gps_accuracy_m, gps_timestamp, gps_age_ms, issued_at, expires_at, completed_at, slot1_capture_id,
      slot1_outcome, slot2_capture_id, slot2_outcome, remote_sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.sequenceId,
      s.passId,
      s.sessionId,
      s.sequenceNumber,
      s.mode,
      s.status,
      s.lotId,
      s.rowId,
      s.segmentId,
      s.markerId,
      s.gps?.lat ?? null,
      s.gps?.lon ?? null,
      s.gps?.accuracyM ?? null,
      s.gps?.timestamp ?? null,
      s.gpsAgeMs,
      s.issuedAt,
      s.expiresAt,
      s.completedAt,
      s.slots.CAMERA_1.captureId,
      s.slots.CAMERA_1.outcome,
      s.slots.CAMERA_2.captureId,
      s.slots.CAMERA_2.outcome,
      s.remoteSyncStatus,
    ],
  );
}

export async function getSequence(sequenceId: string, db: Db = getDb()): Promise<CaptureSequence | null> {
  const r = await db.getFirstAsync<SeqRow>('SELECT * FROM capture_sequences WHERE sequence_id = ?', [sequenceId]);
  return r ? toDomain(r) : null;
}

/** Busca la secuencia que emitió un captureId (vigente) para una cámara. */
export async function findSequenceByCapture(
  captureId: string,
  db: Db = getDb(),
): Promise<{ seq: CaptureSequence; role: CameraRole } | null> {
  const r = await db.getFirstAsync<SeqRow>(
    'SELECT * FROM capture_sequences WHERE slot1_capture_id = ? OR slot2_capture_id = ? LIMIT 1',
    [captureId, captureId],
  );
  if (!r) return null;
  return { seq: toDomain(r), role: r.slot1_capture_id === captureId ? 'CAMERA_1' : 'CAMERA_2' };
}

export async function updateSequenceSlots(s: CaptureSequence, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `UPDATE capture_sequences SET status = ?, completed_at = ?, slot1_capture_id = ?, slot1_outcome = ?, slot2_capture_id = ?,
       slot2_outcome = ?, remote_sync_status = ? WHERE sequence_id = ?`,
    [
      s.status,
      s.completedAt,
      s.slots.CAMERA_1.captureId,
      s.slots.CAMERA_1.outcome,
      s.slots.CAMERA_2.captureId,
      s.slots.CAMERA_2.outcome,
      s.remoteSyncStatus,
      s.sequenceId,
    ],
  );
}

export async function listSequences(passId: string, db: Db = getDb()): Promise<CaptureSequence[]> {
  const rows = await db.getAllAsync<SeqRow>('SELECT * FROM capture_sequences WHERE pass_id = ? ORDER BY sequence_number', [
    passId,
  ]);
  return rows.map(toDomain);
}

export async function lastSequence(passId: string, db: Db = getDb()): Promise<CaptureSequence | null> {
  const r = await db.getFirstAsync<SeqRow>(
    'SELECT * FROM capture_sequences WHERE pass_id = ? ORDER BY sequence_number DESC LIMIT 1',
    [passId],
  );
  return r ? toDomain(r) : null;
}

export async function nextSequenceNumber(passId: string, db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ m: number | null }>(
    'SELECT MAX(sequence_number) AS m FROM capture_sequences WHERE pass_id = ?',
    [passId],
  );
  return (r?.m ?? 0) + 1;
}

export interface PassCounters {
  total: number;
  complete: number;
  partial: number;
  incomplete: number;
}

export async function passCounters(passId: string, db: Db = getDb()): Promise<PassCounters> {
  const r = await db.getFirstAsync<{ total: number; complete: number; partial: number; incomplete: number }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status = 'COMPLETE' THEN 1 ELSE 0 END) AS complete,
       SUM(CASE WHEN status IN ('PARTIAL','COMMAND_SENT','CREATED') THEN 1 ELSE 0 END) AS partial,
       SUM(CASE WHEN status IN ('INCOMPLETE','CANCELLED') THEN 1 ELSE 0 END) AS incomplete
     FROM capture_sequences WHERE pass_id = ?`,
    [passId],
  );
  return { total: r?.total ?? 0, complete: r?.complete ?? 0, partial: r?.partial ?? 0, incomplete: r?.incomplete ?? 0 };
}

/** Recuperación (8.10): resultados PENDIENTE de la última secuencia pasan a SIN_RESPUESTA. */
export async function markPendingAsNoResponse(passId: string, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `UPDATE capture_sequences SET slot1_outcome = CASE WHEN slot1_outcome = 'PENDIENTE' THEN 'SIN_RESPUESTA' ELSE slot1_outcome END,
       slot2_outcome = CASE WHEN slot2_outcome = 'PENDIENTE' THEN 'SIN_RESPUESTA' ELSE slot2_outcome END
     WHERE pass_id = ? AND (slot1_outcome = 'PENDIENTE' OR slot2_outcome = 'PENDIENTE')`,
    [passId],
  );
}

/** Fase 4: secuencias de la pasada → estado respecto de la plataforma (SEQUENCE_BATCH enviado o reabierto). */
export async function setSequencesRemoteStatus(passId: string, status: RemoteSyncStatus, db: Db = getDb()): Promise<void> {
  await db.runAsync('UPDATE capture_sequences SET remote_sync_status = ? WHERE pass_id = ?', [status, passId]);
}

/** IDs de las secuencias de evidencia de la sesión (para no enviar incidencias con referencias inexistentes). */
export async function listSequenceIdsOfSession(sessionId: string, db: Db = getDb()): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ sequence_id: string }>('SELECT sequence_id FROM capture_sequences WHERE session_id = ?', [
    sessionId,
  ]);
  return new Set(rows.map((r) => r.sequence_id));
}

/** IDs de las secuencias de varias pasadas (las que el servidor ya recibió en su SEQUENCE_BATCH). */
export async function listSequenceIdsOfPasses(passIds: readonly string[], db: Db = getDb()): Promise<Set<string>> {
  const out = new Set<string>();
  for (const passId of passIds) {
    const rows = await db.getAllAsync<{ sequence_id: string }>('SELECT sequence_id FROM capture_sequences WHERE pass_id = ?', [
      passId,
    ]);
    for (const r of rows) out.add(r.sequence_id);
  }
  return out;
}
