// src/storage/repositories/incidentRepo.ts — Incidencias automáticas y manuales (RF-43).
//
// Se envían a la plataforma Django en lotes de hasta 200 (POST /api/v1/sessions/{id}/incidents/batch) al sincronizar
// (src/sync/syncService.ts, elemento INCIDENT_BATCH).

import type { Incident, IncidentSeverity, IncidentType } from '../../domain/types';
import { getDb, type Db } from '../db';

interface IncidentRow {
  incident_id: string;
  session_id: string;
  pass_id: string | null;
  sequence_id: string | null;
  capture_id: string | null;
  device_id: string | null;
  type: IncidentType;
  severity: IncidentSeverity;
  detail: string;
  occurred_at: string;
  created_by: 'SISTEMA' | 'OPERADOR';
}

export async function insertIncident(i: Incident, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO incidents (incident_id, session_id, pass_id, sequence_id, capture_id, device_id, type, severity, detail, occurred_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      i.incidentId,
      i.sessionId,
      i.passId,
      i.sequenceId,
      i.captureId,
      i.deviceId,
      i.type,
      i.severity,
      i.detail,
      i.occurredAt,
      i.createdBy,
    ],
  );
}

export async function listIncidents(sessionId: string | null, db: Db = getDb()): Promise<Incident[]> {
  const rows = sessionId
    ? await db.getAllAsync<IncidentRow>('SELECT * FROM incidents WHERE session_id = ? ORDER BY occurred_at DESC', [sessionId])
    : await db.getAllAsync<IncidentRow>('SELECT * FROM incidents ORDER BY occurred_at DESC LIMIT 200', []);
  return rows.map((r) => ({
    incidentId: r.incident_id,
    sessionId: r.session_id,
    passId: r.pass_id,
    sequenceId: r.sequence_id,
    captureId: r.capture_id,
    deviceId: r.device_id,
    type: r.type,
    severity: r.severity,
    detail: r.detail,
    occurredAt: r.occurred_at,
    createdBy: r.created_by,
  }));
}

export async function countIncidents(passId: string, db: Db = getDb()): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM incidents WHERE pass_id = ?', [passId]);
  return r?.n ?? 0;
}

/** Fase 4: incidencias de la sesión en orden de ocurrencia (INCIDENT_BATCH, lotes de sync.batchSize). */
export async function listIncidentsForSync(sessionId: string, db: Db = getDb()): Promise<Incident[]> {
  return (await listIncidents(sessionId, db)).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export async function setIncidentsRemoteStatus(
  sessionId: string,
  status: 'PENDIENTE_NUBE' | 'SUBIENDO' | 'SINCRONIZADO' | 'ERROR_SINCRONIZACION',
  db: Db = getDb(),
): Promise<void> {
  await db.runAsync('UPDATE incidents SET remote_sync_status = ? WHERE session_id = ?', [status, sessionId]);
}
