// src/controller/sessionService.ts — Sesión de monitoreo en el CONTROLADOR (maestro §8.3, §8.8, §13 "Sesión").
//
// QUÉ HACE (solo datos y reglas; los mensajes a las cámaras los envía controllerRuntime):
//  - createDraft(): PANT-12 "Crear sesión" → DRAFT con versión de app, configuración y perfil de calidad.
//    Exige catálogos, batería/espacio mínimos (RN-10) y que no haya otra sesión abierta (7.12).
//  - setStatus(): cambia el estado validando SESSION_TRANSITIONS y lo registra (SESSION/STATE).
//  - finalizeClose(): CLOSING → CLOSED y, EN LA MISMA TRANSACCIÓN, crea los elementos de sync_queue (15.5);
//    luego borra los archivos de la prueba corta (RN-21).
//
// Fase 4: los elementos de sync_queue los procesa src/sync/syncService.ts (a mano en PANT-20 o solo con Wi-Fi).

import { APP_VERSION, CONFIG, CONFIG_VERSION } from '../config';
import { newId } from '../domain/ids';
import { validateSessionMode, type RuleResult } from '../domain/rules';
import { assertTransition, SESSION_TRANSITIONS } from '../domain/stateMachines';
import { nowIso } from '../domain/time';
import type { CaptureMode, MonitoringSession, SessionStatus } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';
import { getDb, inTransaction } from '../storage/db';
import { deleteDirIfExists } from '../storage/files';
import { getCatalogInfo } from '../storage/repositories/catalogRepo';
import { listCapturesBySession, updateCapture } from '../storage/repositories/captureRepo';
import { listPasses } from '../storage/repositories/passRepo';
import { deleteDraft, getCurrentSession, getSession, insertSession, updateSession } from '../storage/repositories/sessionRepo';
import { upsertSyncItem } from '../storage/repositories/syncQueueRepo';

export interface CreateDraftInput {
  mode: CaptureMode;
  intervalMs: number;
  operatorUserId: string;
  controllerDeviceId: string;
  batteryPct: number | null;
  freeSpaceBytes: number | null;
}

export async function createDraft(
  i: CreateDraftInput,
): Promise<{ ok: true; session: MonitoringSession } | { ok: false; code: string }> {
  const catalogs = await getCatalogInfo();
  if (catalogs.lots === 0 || catalogs.rows === 0) return { ok: false, code: 'CATALOGOS_FALTANTES' };
  const modeRule: RuleResult = validateSessionMode(i.mode, i.intervalMs, CONFIG.capture);
  if (!modeRule.ok) return { ok: false, code: modeRule.code };
  if (i.batteryPct !== null && i.batteryPct < CONFIG.device.minBatteryToStartPct) return { ok: false, code: 'BATERIA_BAJA' };
  if (i.freeSpaceBytes !== null && i.freeSpaceBytes < CONFIG.device.minFreeSpaceToStartBytes)
    return { ok: false, code: 'ESPACIO_BAJO' };
  const current = await getCurrentSession(true);
  if (current && current.status !== 'DRAFT') return { ok: false, code: 'PASADA_ABIERTA' };
  if (current && current.status === 'DRAFT') await deleteDraft(current.sessionId);
  const now = nowIso();
  const session: MonitoringSession = {
    sessionId: newId(),
    operatorUserId: i.operatorUserId,
    controllerDeviceId: i.controllerDeviceId,
    status: 'DRAFT',
    mode: i.mode,
    // En MANUAL el intervalo no participa; se guarda el valor por defecto (la columna exige > 0).
    intervalMs: i.mode === 'AUTOMATICO' ? i.intervalMs : CONFIG.capture.intervalMs,
    startedAt: null,
    endedAt: null,
    appVersion: APP_VERSION,
    configVersion: CONFIG_VERSION,
    qualityProfileVersion: CONFIG.quality.profileVersion,
    pairingTokenHash: null,
    shortTestPassedAt: null,
    createdAt: now,
    updatedAt: now,
    remoteSyncStatus: 'PENDIENTE_NUBE',
  };
  await insertSession(session);
  logEvent('INFO', 'SESSION', 'STATE', { from: null, to: 'DRAFT', mode: session.mode }, session.sessionId);
  return { ok: true, session };
}

export async function discardDraft(sessionId: string): Promise<void> {
  await deleteDraft(sessionId);
  logEvent('INFO', 'SESSION', 'STATE', { from: 'DRAFT', to: 'ELIMINADA' }, sessionId);
}

export async function setStatus(
  session: MonitoringSession,
  to: SessionStatus,
  extra: Partial<Pick<MonitoringSession, 'pairingTokenHash' | 'shortTestPassedAt' | 'startedAt' | 'endedAt'>> = {},
): Promise<MonitoringSession> {
  if (session.status !== to) assertTransition('sesión', SESSION_TRANSITIONS, session.status, to);
  await updateSession(session.sessionId, { status: to, ...extra });
  if (session.status !== to) logEvent('INFO', 'SESSION', 'STATE', { from: session.status, to }, session.sessionId);
  return (await getSession(session.sessionId)) as MonitoringSession;
}

/** Actualiza campos sin cambiar el estado (token del QR, prueba corta). */
export async function patchSession(
  session: MonitoringSession,
  patch: Partial<Pick<MonitoringSession, 'pairingTokenHash' | 'shortTestPassedAt' | 'startedAt'>>,
): Promise<MonitoringSession> {
  await updateSession(session.sessionId, patch);
  return (await getSession(session.sessionId)) as MonitoringSession;
}

/**
 * CLOSING → CLOSED + elementos de sync_queue en la misma transacción (maestro §12.5 y §15.5).
 * Solo se encolan capturas de evidencia (is_test = 0) ya RECIBIDA_CONTROLADOR.
 */
export async function finalizeClose(session: MonitoringSession): Promise<MonitoringSession> {
  assertTransition('sesión', SESSION_TRANSITIONS, session.status, 'CLOSED');
  const passes = await listPasses(session.sessionId);
  const captures = await listCapturesBySession(session.sessionId);
  await inTransaction(async (txn) => {
    const now = nowIso();
    await txn.runAsync("UPDATE monitoring_sessions SET status = 'CLOSED', ended_at = ?, updated_at = ? WHERE session_id = ?", [
      now,
      now,
      session.sessionId,
    ]);
    await upsertSyncItem('SESSION', session.sessionId, session.sessionId, txn);
    for (const p of passes) {
      await upsertSyncItem('PASS', p.passId, session.sessionId, txn);
      await upsertSyncItem('SEQUENCE_BATCH', p.passId, session.sessionId, txn);
    }
    for (const c of captures) {
      if (!c.isTest && c.localTransferStatus === 'RECIBIDA_CONTROLADOR')
        await upsertSyncItem('CAPTURE', c.captureId, session.sessionId, txn);
    }
    await upsertSyncItem('INCIDENT_BATCH', session.sessionId, session.sessionId, txn);
    await upsertSyncItem('SESSION_CLOSE', session.sessionId, session.sessionId, txn);
  });
  logEvent('INFO', 'SESSION', 'STATE', { from: session.status, to: 'CLOSED' }, session.sessionId);
  // RN-21: los archivos de la prueba corta se borran (las filas se conservan con file_deleted_at).
  deleteDirIfExists('short-test', session.sessionId);
  for (const c of captures) if (c.isTest && !c.fileDeletedAt) await updateCapture(c.captureId, { fileDeletedAt: nowIso() });
  return (await getSession(session.sessionId)) as MonitoringSession;
}

/** Sesiones cerradas o sincronizadas (para el panel y la sincronización). */
export async function countClosedPendingSync(): Promise<number> {
  const r = await getDb().getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM monitoring_sessions WHERE status = 'CLOSED'",
    [],
  );
  return r?.n ?? 0;
}

/** Pasadas de la sesión para el resumen de PANT-19 (solo lectura). */
export async function sessionPasses(sessionId: string) {
  return listPasses(sessionId);
}
