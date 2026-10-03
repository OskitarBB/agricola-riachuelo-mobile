// src/controller/passService.ts — Pasadas por lateral (maestro §8.4, §8.6, §8.7; RN-10, RN-12, RN-13).
//
// QUÉ HACE (datos y reglas; los mensajes START_PASS/END_PASS los envía controllerRuntime):
//  - createPass(): valida RN-12 (LATERAL_B exige LATERAL_A cerrada; nunca dos pasadas abiertas), calcula
//    passOrder (máximo de la hilera + 1) y exige incidencia OPERADOR si es "Repetir lateral".
//  - setPassStatus(): cambia el estado validando PASS_TRANSITIONS.
//  - changeMarker(): cambio de marcador/segmento SIEMPRE manual (contexto §25.2): fila en marker_changes
//    con hora y GPS; las secuencias anteriores conservan su contexto.
//  - refreshCounters(): recalcula total, completas e incompletas desde capture_sequences.

import { newId } from '../domain/ids';
import { canCreatePass, isLateralRepeat, nextPassOrder } from '../domain/rules';
import { assertTransition, PASS_TRANSITIONS } from '../domain/stateMachines';
import { nowIso } from '../domain/time';
import type { Direction, GpsFix, LateralCode, MonitoringPass, PassStatus } from '../domain/types';
import { addManualIncident } from '../diagnostics/incidents';
import { logEvent } from '../diagnostics/eventLog';
import { getDb } from '../storage/db';
import { countIncidents } from '../storage/repositories/incidentRepo';
import { countRetakes, getPass, insertMarkerChange, insertPass, listPasses, updatePass } from '../storage/repositories/passRepo';
import { listSequences, passCounters } from '../storage/repositories/sequenceRepo';

export interface NewPassInput {
  sessionId: string;
  lotId: string;
  rowId: string;
  lateral: LateralCode;
  direction: Direction;
  segmentId: string | null;
  markerId: string;
  /** Texto de la incidencia obligatoria para "Repetir lateral". */
  repeatReason: string | null;
}

export async function evaluateNewPass(sessionId: string, rowId: string, lateral: LateralCode) {
  const passes = await listPasses(sessionId);
  return {
    rule: canCreatePass(passes, rowId, lateral),
    isRepeat: isLateralRepeat(passes, rowId, lateral),
    passOrder: nextPassOrder(passes, rowId),
  };
}

export async function createPass(i: NewPassInput): Promise<{ ok: true; pass: MonitoringPass } | { ok: false; code: string }> {
  const { rule, isRepeat, passOrder } = await evaluateNewPass(i.sessionId, i.rowId, i.lateral);
  if (!rule.ok) return { ok: false, code: rule.code };
  if (isRepeat && !(i.repeatReason && i.repeatReason.trim().length >= 3)) return { ok: false, code: 'INCIDENCIA_REQUERIDA' };
  const pass: MonitoringPass = {
    passId: newId(),
    sessionId: i.sessionId,
    lotId: i.lotId,
    rowId: i.rowId,
    lateralCode: i.lateral,
    passOrder,
    direction: i.direction,
    startMarkerId: i.markerId,
    endMarkerId: null,
    currentSegmentId: i.segmentId,
    currentMarkerId: i.markerId,
    status: 'READY',
    startedAt: null,
    endedAt: null,
    sequencesTotal: 0,
    sequencesComplete: 0,
    sequencesIncomplete: 0,
    remoteSyncStatus: 'PENDIENTE_NUBE',
  };
  await insertPass(pass);
  if (isRepeat && i.repeatReason) {
    await addManualIncident(
      { sessionId: i.sessionId, passId: pass.passId },
      'OPERADOR',
      'AVISO',
      `Repetir lateral: ${i.repeatReason}`,
    );
  }
  logEvent(
    'INFO',
    'SESSION',
    'PASS_STATE',
    { passId: pass.passId, to: 'READY', lateral: i.lateral, passOrder, repeat: isRepeat },
    i.sessionId,
  );
  return { ok: true, pass };
}

export async function setPassStatus(
  pass: MonitoringPass,
  to: PassStatus,
  extra: Partial<Pick<MonitoringPass, 'startedAt' | 'endedAt' | 'endMarkerId'>> = {},
) {
  if (pass.status !== to) assertTransition('pasada', PASS_TRANSITIONS, pass.status, to);
  await updatePass(pass.passId, { status: to, ...extra });
  if (pass.status !== to)
    logEvent('INFO', 'SESSION', 'PASS_STATE', { passId: pass.passId, from: pass.status, to }, pass.sessionId);
  return (await getPass(pass.passId)) as MonitoringPass;
}

export async function changeMarker(
  pass: MonitoringPass,
  markerId: string,
  segmentId: string | null,
  gps: GpsFix | null,
): Promise<MonitoringPass> {
  await insertMarkerChange({ markerChangeId: newId(), passId: pass.passId, markerId, segmentId, changedAt: nowIso(), gps });
  await updatePass(pass.passId, { currentMarkerId: markerId, currentSegmentId: segmentId });
  logEvent('INFO', 'SESSION', 'MARKER_CHANGE', { passId: pass.passId, markerId, segmentId }, pass.sessionId);
  return (await getPass(pass.passId)) as MonitoringPass;
}

export async function refreshCounters(passId: string): Promise<{ pass: MonitoringPass; partial: number }> {
  const c = await passCounters(passId);
  await updatePass(passId, { sequencesTotal: c.total, sequencesComplete: c.complete, sequencesIncomplete: c.incomplete });
  return { pass: (await getPass(passId)) as MonitoringPass, partial: c.partial };
}

// ------------------------------------------------------------------ resumen para PANT-18 (RF-47)

export interface PassSummary {
  durationMs: number;
  retakes: number;
  incidents: number;
  missingPhotos: number;
  bySegment: { segmentId: string | null; total: number; complete: number; incomplete: number }[];
}

export async function passSummary(pass: MonitoringPass): Promise<PassSummary> {
  const seqs = await listSequences(pass.passId);
  const map = new Map<string | null, { total: number; complete: number; incomplete: number }>();
  for (const s of seqs) {
    const e = map.get(s.segmentId) ?? { total: 0, complete: 0, incomplete: 0 };
    e.total += 1;
    if (s.status === 'COMPLETE') e.complete += 1;
    if (s.status === 'INCOMPLETE' || s.status === 'CANCELLED') e.incomplete += 1;
    map.set(s.segmentId, e);
  }
  const missing = await getDb().getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM captures WHERE pass_id = ? AND is_test = 0 AND local_transfer_status <> 'RECIBIDA_CONTROLADOR'",
    [pass.passId],
  );
  const start = pass.startedAt ? new Date(pass.startedAt).getTime() : Date.now();
  const end = pass.endedAt ? new Date(pass.endedAt).getTime() : Date.now();
  return {
    durationMs: Math.max(0, end - start),
    retakes: await countRetakes(pass.passId),
    incidents: await countIncidents(pass.passId),
    missingPhotos: missing?.n ?? 0,
    bySegment: [...map.entries()].map(([segmentId, v]) => ({ segmentId, ...v })),
  };
}
