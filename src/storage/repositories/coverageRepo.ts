// src/storage/repositories/coverageRepo.ts — Ciclos, lotes planificados y áreas no hechas (CFG-3, migración 002).
//
// QUÉ HACE: lee y escribe monitoring_cycles, session_planned_lots y uncovered_areas en el CONTROLADOR.
// Las reglas (qué está bloqueado, qué falta, quién puede abrir un ciclo) NO están aquí: están en
// src/domain/coverage.ts y las orquesta src/controller/cycleService.ts.
// PENDIENTE EN LA PLATAFORMA (CFG-3): el ciclo vigente vendrá del bootstrap y estas tablas actuarán
// como caché local; uncovered_areas se enviará con INCIDENT_BATCH y se marcará SINCRONIZADO.

import type { LateralCode, MonitoringCycle, UncoveredArea, UncoveredKind, UncoveredReason } from '../../domain/types';
import { getDb, type Db } from '../db';

// ------------------------------------------------------------------ ciclos

interface CycleRow {
  cycle_id: string;
  number: number;
  started_at: string;
  started_by_user_id: string | null;
  note: string | null;
}

const toCycle = (r: CycleRow): MonitoringCycle => ({
  cycleId: r.cycle_id,
  number: r.number,
  startedAt: r.started_at,
  startedByUserId: r.started_by_user_id,
  note: r.note,
});

/** Ciclo vigente = el de número más alto. */
export async function getLatestCycle(db: Db = getDb()): Promise<MonitoringCycle | null> {
  const r = await db.getFirstAsync<CycleRow>('SELECT * FROM monitoring_cycles ORDER BY number DESC LIMIT 1', []);
  return r ? toCycle(r) : null;
}

export async function insertCycle(c: MonitoringCycle, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    'INSERT INTO monitoring_cycles (cycle_id, number, started_at, started_by_user_id, note) VALUES (?, ?, ?, ?, ?)',
    [c.cycleId, c.number, c.startedAt, c.startedByUserId, c.note],
  );
}

/** Sesiones creadas antes de la migración 002 (sin ciclo) pasan al ciclo indicado. */
export async function assignOrphanSessions(cycleId: string, db: Db = getDb()): Promise<void> {
  await db.runAsync('UPDATE monitoring_sessions SET cycle_id = ? WHERE cycle_id IS NULL', [cycleId]);
}

// ------------------------------------------------------------------ lotes planificados

export async function setPlannedLots(sessionId: string, lotIds: readonly string[], db: Db = getDb()): Promise<void> {
  await db.runAsync('DELETE FROM session_planned_lots WHERE session_id = ?', [sessionId]);
  for (const lotId of lotIds) {
    await db.runAsync('INSERT INTO session_planned_lots (session_id, lot_id) VALUES (?, ?)', [sessionId, lotId]);
  }
}

export async function listPlannedLots(sessionId: string, db: Db = getDb()): Promise<string[]> {
  const rows = await db.getAllAsync<{ lot_id: string }>(
    'SELECT lot_id FROM session_planned_lots WHERE session_id = ? ORDER BY lot_id',
    [sessionId],
  );
  return rows.map((r) => r.lot_id);
}

// ------------------------------------------------------------------ áreas no hechas

interface AreaRow {
  area_id: string;
  session_id: string;
  cycle_id: string | null;
  kind: UncoveredKind;
  lot_id: string;
  row_id: string | null;
  lateral_code: LateralCode | null;
  reason: UncoveredReason;
  note: string | null;
  user_id: string | null;
  created_at: string;
  remote_sync_status: UncoveredArea['remoteSyncStatus'];
}

const toArea = (r: AreaRow): UncoveredArea => ({
  areaId: r.area_id,
  sessionId: r.session_id,
  cycleId: r.cycle_id,
  kind: r.kind,
  lotId: r.lot_id,
  rowId: r.row_id,
  lateralCode: r.lateral_code,
  reason: r.reason,
  note: r.note,
  userId: r.user_id,
  createdAt: r.created_at,
  remoteSyncStatus: r.remote_sync_status,
});

export async function insertUncoveredArea(a: UncoveredArea, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO uncovered_areas (area_id, session_id, cycle_id, kind, lot_id, row_id, lateral_code, reason, note, user_id,
      created_at, remote_sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      a.areaId,
      a.sessionId,
      a.cycleId,
      a.kind,
      a.lotId,
      a.rowId,
      a.lateralCode,
      a.reason,
      a.note,
      a.userId,
      a.createdAt,
      a.remoteSyncStatus,
    ],
  );
}

/** Áreas no hechas registradas en el ciclo (más recientes primero). */
export async function listUncoveredOfCycle(cycleId: string, db: Db = getDb()): Promise<UncoveredArea[]> {
  const rows = await db.getAllAsync<AreaRow>('SELECT * FROM uncovered_areas WHERE cycle_id = ? ORDER BY created_at DESC', [
    cycleId,
  ]);
  return rows.map(toArea);
}

export async function listUncoveredOfSession(sessionId: string, db: Db = getDb()): Promise<UncoveredArea[]> {
  const rows = await db.getAllAsync<AreaRow>('SELECT * FROM uncovered_areas WHERE session_id = ? ORDER BY created_at', [
    sessionId,
  ]);
  return rows.map(toArea);
}
