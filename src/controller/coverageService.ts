// src/controller/coverageService.ts — Ciclo de monitoreo y avance de campo en el CONTROLADOR (CFG-3).
//
// QUÉ HACE: une SQLite (src/storage/repositories/coverageRepo.ts y passRepo.ts) con las reglas puras de
// src/domain/coverage.ts para que las pantallas solo muestren resultados:
//  - Ciclo vigente: ensureCurrentCycle() crea el ciclo 1 la primera vez (y le asigna las sesiones antiguas);
//    startNewCycle() abre el siguiente (solo ADMINISTRADOR y sin sesión abierta) y libera lo bloqueado.
//  - Avance dentro del ciclo: qué lotes e hileras están completos (candado), qué lateral falta y en qué
//    dirección debe ir el LATERAL B.
//  - Áreas no hechas de una sesión: compara los lotes planificados con lo hecho (para PANT-19) y lista las
//    registradas en el ciclo (aviso en el panel del controlador).
// INTEGRACIÓN FUTURA (Fase 4): el ciclo vigente y el avance de OTROS controladores vendrán del backend; un
// supervisor abrirá ciclos y reabrirá hileras desde la web. Las pantallas no cambian.

import {
  canStartNewCycle,
  lotCoverage,
  pendingAreasOfSession,
  rowCoverage,
  type LotCoverage,
  type PendingArea,
  type RowCoverage,
} from '../domain/coverage';
import { newId } from '../domain/ids';
import { nowIso } from '../domain/time';
import type { FieldRow, Lot, MonitoringCycle, MonitoringPass, UncoveredArea, UserRole } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';
import { inTransaction } from '../storage/db';
import { listLots, listRows } from '../storage/repositories/catalogRepo';
import {
  assignOrphanSessions,
  getLatestCycle,
  insertCycle,
  listPlannedLots,
  listUncoveredOfCycle,
} from '../storage/repositories/coverageRepo';
import { listCyclePasses, listCyclePassesOfLot, listCyclePassesOfRow, listPasses } from '../storage/repositories/passRepo';
import { getCurrentSession } from '../storage/repositories/sessionRepo';

// ------------------------------------------------------------------ ciclo

let cycleCache: MonitoringCycle | null = null;

/** Ciclo vigente; si no existe ninguno (primera vez tras la migración 002) crea el ciclo 1. */
export async function ensureCurrentCycle(): Promise<MonitoringCycle> {
  if (cycleCache) return cycleCache;
  let cycle = await getLatestCycle();
  if (!cycle) {
    const created: MonitoringCycle = { cycleId: newId(), number: 1, startedAt: nowIso(), startedByUserId: null, note: null };
    await inTransaction(async (txn) => {
      await insertCycle(created, txn);
      await assignOrphanSessions(created.cycleId, txn);
    });
    logEvent('INFO', 'SESSION', 'CYCLE_STARTED', { number: 1, auto: true });
    cycle = created;
  }
  cycleCache = cycle;
  return cycle;
}

/** Abre el ciclo siguiente: todo lo bloqueado vuelve a estar disponible. */
export async function startNewCycle(
  user: { id: string; roles: readonly UserRole[] },
  note: string | null,
): Promise<{ ok: true; cycle: MonitoringCycle } | { ok: false; code: string }> {
  const open = await getCurrentSession(true);
  const rule = canStartNewCycle(user.roles, open !== null);
  if (!rule.ok) return rule;
  const current = await ensureCurrentCycle();
  const next: MonitoringCycle = {
    cycleId: newId(),
    number: current.number + 1,
    startedAt: nowIso(),
    startedByUserId: user.id,
    note: note && note.trim() ? note.trim() : null,
  };
  await insertCycle(next);
  cycleCache = next;
  logEvent('INFO', 'SESSION', 'CYCLE_STARTED', { number: next.number });
  return { ok: true, cycle: next };
}

// ------------------------------------------------------------------ avance dentro del ciclo

function groupByRow(passes: MonitoringPass[]): Map<string, MonitoringPass[]> {
  const map = new Map<string, MonitoringPass[]>();
  for (const p of passes) {
    const list = map.get(p.rowId) ?? [];
    list.push(p);
    map.set(p.rowId, list);
  }
  return map;
}

/** Pasadas de una hilera en el ciclo de la sesión (o el vigente si la sesión no tiene ciclo). */
export async function cyclePassesOfRow(rowId: string, cycleId?: string | null): Promise<MonitoringPass[]> {
  const id = cycleId ?? (await ensureCurrentCycle()).cycleId;
  return listCyclePassesOfRow(rowId, id);
}

/** Cobertura de cada hilera del lote (rowId → RowCoverage) en el ciclo. */
export async function rowsCoverage(lotId: string, cycleId?: string | null): Promise<Map<string, RowCoverage>> {
  const id = cycleId ?? (await ensureCurrentCycle()).cycleId;
  const [rows, passes] = await Promise.all([listRows(lotId), listCyclePassesOfLot(lotId, id)]);
  const byRow = groupByRow(passes);
  return new Map(rows.map((r) => [r.id, rowCoverage(r.id, byRow.get(r.id) ?? [])]));
}

/** Cobertura de todos los lotes (lotId → LotCoverage) en el ciclo. */
export async function lotsCoverage(cycleId?: string | null): Promise<Map<string, LotCoverage>> {
  const id = cycleId ?? (await ensureCurrentCycle()).cycleId;
  const [lots, passes] = await Promise.all([listLots(), listCyclePasses(id)]);
  const byRow = groupByRow(passes);
  const out = new Map<string, LotCoverage>();
  for (const lot of lots) {
    const rows = await listRows(lot.id);
    const cov = new Map(rows.map((r) => [r.id, rowCoverage(r.id, byRow.get(r.id) ?? [])]));
    out.set(lot.id, lotCoverage(lot.id, rows, cov));
  }
  return out;
}

/** Resumen para el panel del controlador: ciclo, lotes y hileras completas. */
export async function cycleProgress(): Promise<{
  cycle: MonitoringCycle;
  lotsDone: number;
  lotsTotal: number;
  rowsDone: number;
  rowsTotal: number;
}> {
  const cycle = await ensureCurrentCycle();
  const cov = [...(await lotsCoverage(cycle.cycleId)).values()];
  return {
    cycle,
    lotsDone: cov.filter((c) => c.complete).length,
    lotsTotal: cov.filter((c) => c.totalRows > 0).length,
    rowsDone: cov.reduce((n, c) => n + c.completeRows, 0),
    rowsTotal: cov.reduce((n, c) => n + c.totalRows, 0),
  };
}

// ------------------------------------------------------------------ áreas no hechas

/** Área pendiente con los datos que necesita la pantalla (código de lote y números de hilera). */
export interface PendingAreaView extends PendingArea {
  lotLabel: string;
  rowNumbers: number[];
}

async function labelsFor(lotIds: readonly string[]): Promise<{ lots: Map<string, Lot>; rows: Map<string, FieldRow[]> }> {
  const lots = new Map((await listLots()).map((l) => [l.id, l]));
  const rows = new Map<string, FieldRow[]>();
  for (const id of lotIds) rows.set(id, await listRows(id));
  return { lots, rows };
}

/** Lotes, hileras y laterales planificados en la sesión que quedan sin terminar en el ciclo. */
export async function sessionPendingAreas(sessionId: string, cycleId: string | null): Promise<PendingAreaView[]> {
  const planned = await listPlannedLots(sessionId);
  if (planned.length === 0) return [];
  const id = cycleId ?? (await ensureCurrentCycle()).cycleId;
  const [{ lots, rows }, sessionPasses] = await Promise.all([labelsFor(planned), listPasses(sessionId)]);
  const cyclePasses: MonitoringPass[] = [];
  for (const lotId of planned) cyclePasses.push(...(await listCyclePassesOfLot(lotId, id)));
  const areas = pendingAreasOfSession({
    plannedLotIds: planned,
    rowsByLot: rows,
    cyclePassesByRow: groupByRow(cyclePasses),
    sessionPasses,
  });
  return areas.map((a) => {
    const lotRows = rows.get(a.lotId) ?? [];
    return {
      ...a,
      lotLabel: lots.get(a.lotId)?.code ?? a.lotId,
      rowNumbers: a.rowIds.map((r) => lotRows.find((x) => x.id === r)?.number ?? 0).filter((n) => n > 0),
    };
  });
}

/** Lotes planificados en la sesión. */
export function plannedLotsOf(sessionId: string): Promise<string[]> {
  return listPlannedLots(sessionId);
}

/** Área no hecha ya registrada, con etiquetas para mostrarla. */
export interface UncoveredAreaView extends UncoveredArea {
  lotLabel: string;
  rowNumber: number | null;
}

/** Áreas no hechas registradas en el ciclo vigente (aviso "Pendientes del ciclo"). */
export async function cycleUncoveredAreas(): Promise<UncoveredAreaView[]> {
  const cycle = await ensureCurrentCycle();
  const areas = await listUncoveredOfCycle(cycle.cycleId);
  if (areas.length === 0) return [];
  const lotIds = [...new Set(areas.map((a) => a.lotId))];
  const { lots, rows } = await labelsFor(lotIds);
  // Solo se muestran las que SIGUEN pendientes (una hilera hecha después en otra sesión ya no avisa).
  const coverage = new Map<string, Map<string, RowCoverage>>();
  for (const lotId of lotIds) coverage.set(lotId, await rowsCoverage(lotId, cycle.cycleId));
  return areas
    .filter((a) => {
      const cov = coverage.get(a.lotId);
      if (!cov) return true;
      if (a.rowId === null) return [...cov.values()].some((c) => c.state !== 'COMPLETA');
      const c = cov.get(a.rowId);
      if (!c) return false;
      return a.lateralCode ? c.laterals[a.lateralCode] !== 'COMPLETO' : c.state !== 'COMPLETA';
    })
    .map((a) => ({
      ...a,
      lotLabel: lots.get(a.lotId)?.code ?? a.lotId,
      rowNumber: a.rowId ? (rows.get(a.lotId)?.find((r) => r.id === a.rowId)?.number ?? null) : null,
    }));
}
