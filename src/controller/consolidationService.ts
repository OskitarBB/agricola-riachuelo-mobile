// src/controller/consolidationService.ts — Recepción y consolidación de fotos en el CONTROLADOR (§14.7–14.8, §8.13).
//
// QUÉ HACE con cada foto que llega (por HTTP real o desde una cámara virtual):
//  1) Controles: sesión conocida (UNKNOWN_SESSION), celular registrado en esa sesión y mismo rol, IP igual a
//     la del WebSocket de ese celular (WRONG_DEVICE), captureId emitido por el controlador (UNKNOWN_SEQUENCE).
//  2) Verifica tamaño y md5 (SIZE_MISMATCH / MD5_MISMATCH → la cámara reintenta).
//  3) Idempotencia: mismo captureId ya recibido con el mismo md5 → ALREADY_RECEIVED; con otro md5 → CAPTURE_CONFLICT.
//  4) Mueve la foto a captures/{sesión}/{pasada}/{captureId}.jpg (o short-test/…), registra captura y calidad,
//     actualiza el resultado de la cámara en la secuencia (OK_RECIBIDA) y los contadores de la pasada.
//  5) Foto tardía de una sesión cerrada (8.13): se acepta, se encola para sincronizar y la sesión SYNCED vuelve a CLOSED.
// Desde aquí la foto queda en remote_sync_status = PENDIENTE_NUBE: src/sync/syncService.ts la sube a Cloudinary con un
// ticket firmado por la plataforma Django y la confirma en /api/v1/captures/upload (Fase 4).

import { nowIso } from '../domain/time';
import type { CameraRole, Capture, QualityResult } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';
import type { LocalCaptureMeta, LocalCaptureResponse } from '../protocol/messages';
import { getDb } from '../storage/db';
import { capturePath, deleteFileIfExists, fileFacts, moveFile, shortTestPath } from '../storage/files';
import { getCapture, upsertCapture, upsertQualityResult } from '../storage/repositories/captureRepo';
import { updatePass } from '../storage/repositories/passRepo';
import { findSequenceByCapture } from '../storage/repositories/sequenceRepo';
import { getSession, getSessionDevice, updateSession } from '../storage/repositories/sessionRepo';
import { upsertSyncItem } from '../storage/repositories/syncQueueRepo';
import { refreshCounters } from './passService';
import { applyOutcome } from './sequenceEngine';
import type { ShortTestPending } from './shortTest';

export interface ConsolidationHooks {
  /** IP del WebSocket abierto de ese celular (null si no hay o en el simulador). */
  peerAddress(deviceId: string): string | null;
  shortTestPending(): ShortTestPending | null;
  onShortTestFile(role: CameraRole, meta: LocalCaptureMeta): void;
  onEvidenceFile(role: CameraRole, sequenceId: string | null, meta: LocalCaptureMeta): void;
  sendAckFile(deviceId: string, sessionId: string, captureId: string, result: 'RECEIVED' | 'ALREADY_RECEIVED' | 'REJECTED'): void;
}

const rej = (reason: LocalCaptureResponse['reason']): LocalCaptureResponse => ({ result: 'REJECTED', reason });

function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  return ip.replace(/^::ffff:/, '');
}

function qualityOf(meta: LocalCaptureMeta): QualityResult | null {
  if (meta.qualityStatus === 'CAPTURED') return null;
  return {
    status: meta.qualityStatus,
    reasons: meta.qualityReasons,
    metrics: meta.qualityMetrics,
    profileVersion: meta.profileVersion,
  };
}

function isAccepted(meta: LocalCaptureMeta): boolean {
  return meta.qualityStatus === 'UTILIZABLE' || meta.qualityStatus === 'PENDIENTE_REVISION_TECNICA';
}

/** ¿El controlador emitió este captureId? (secuencia vigente o cualquier repetición) */
async function wasEmitted(captureId: string): Promise<{ sequenceId: string; role: CameraRole; current: boolean } | null> {
  const found = await findSequenceByCapture(captureId);
  if (found) return { sequenceId: found.seq.sequenceId, role: found.role, current: true };
  const r = await getDb().getFirstAsync<{ sequence_id: string; camera_role: CameraRole }>(
    'SELECT sequence_id, camera_role FROM retake_requests WHERE capture_id = ? OR replaces_capture_id = ? LIMIT 1',
    [captureId, captureId],
  );
  return r ? { sequenceId: r.sequence_id, role: r.camera_role, current: false } : null;
}

function captureRow(meta: LocalCaptureMeta, filePath: string): Capture {
  return {
    captureId: meta.captureId,
    sequenceId: meta.sequenceId,
    sessionId: meta.sessionId,
    passId: meta.passId,
    lateralCode: meta.lateralCode,
    isTest: meta.isTest,
    deviceId: meta.deviceId,
    cameraRole: meta.cameraRole,
    userId: meta.userId,
    capturedAt: meta.capturedAt,
    filePath,
    sizeBytes: meta.sizeBytes,
    width: meta.width,
    height: meta.height,
    md5: meta.md5,
    qualityStatus: meta.qualityStatus,
    qualityProfileVersion: meta.profileVersion,
    replacesCaptureId: meta.replacesCaptureId,
    localTransferStatus: 'RECIBIDA_CONTROLADOR',
    remoteSyncStatus: meta.isTest ? null : 'PENDIENTE_NUBE',
    transferAttempts: 0,
    syncAttempts: 0,
    lastError: null,
    fileDeletedAt: null,
  };
}

export async function consolidateCapture(
  meta: LocalCaptureMeta,
  tempUri: string,
  remote: string | null,
  hooks: ConsolidationHooks,
): Promise<LocalCaptureResponse> {
  // 1) Controles de sesión y dispositivo.
  const session = await getSession(meta.sessionId);
  if (!session) return rej('UNKNOWN_SESSION');
  const device = await getSessionDevice(meta.sessionId, meta.deviceId);
  if (!device || device.role !== meta.cameraRole) return rej('WRONG_DEVICE');
  const expectedIp = normalizeIp(hooks.peerAddress(meta.deviceId));
  if (expectedIp && remote && normalizeIp(remote) !== expectedIp) return rej('WRONG_DEVICE');

  // 2) Integridad del archivo.
  let facts: { sizeBytes: number; md5: string };
  try {
    facts = fileFacts(tempUri);
  } catch {
    return rej('INTERNAL');
  }
  if (facts.sizeBytes !== meta.sizeBytes) return rej('SIZE_MISMATCH');
  if (facts.md5.toLowerCase() !== meta.md5.toLowerCase()) return rej('MD5_MISMATCH');

  // 3) Prueba corta (RN-21): solo se guarda la de la prueba pendiente; otra se responde RECEIVED y se descarta.
  if (meta.isTest) {
    const pending = hooks.shortTestPending();
    if (!pending || pending.sessionId !== meta.sessionId || pending.captureIds[meta.cameraRole] !== meta.captureId) {
      deleteFileIfExists(tempUri);
      return { result: 'RECEIVED', reason: null };
    }
    const dest = shortTestPath(meta.sessionId, meta.captureId);
    moveFile(tempUri, dest);
    await upsertCapture(captureRow(meta, dest.uri));
    const q = qualityOf(meta);
    if (q) await upsertQualityResult(meta.captureId, q);
    hooks.onShortTestFile(meta.cameraRole, meta);
    hooks.sendAckFile(meta.deviceId, meta.sessionId, meta.captureId, 'RECEIVED');
    logEvent('INFO', 'TRANSFER', 'OK', { captureId: meta.captureId, test: true }, meta.sessionId);
    return { result: 'RECEIVED', reason: null };
  }

  // 4) Evidencia: idempotencia y captureId emitido.
  const existing = await getCapture(meta.captureId);
  if (existing && existing.localTransferStatus === 'RECIBIDA_CONTROLADOR') {
    deleteFileIfExists(tempUri);
    if ((existing.md5 ?? '').toLowerCase() === meta.md5.toLowerCase()) {
      hooks.sendAckFile(meta.deviceId, meta.sessionId, meta.captureId, 'ALREADY_RECEIVED');
      return { result: 'ALREADY_RECEIVED', reason: null };
    }
    return rej('CAPTURE_CONFLICT');
  }
  const emitted = await wasEmitted(meta.captureId);
  if (!emitted || !meta.passId) return rej('UNKNOWN_SEQUENCE');

  const dest = capturePath(meta.sessionId, meta.passId, meta.captureId);
  moveFile(tempUri, dest);
  await upsertCapture(captureRow(meta, dest.uri));
  const q = qualityOf(meta);
  if (q) await upsertQualityResult(meta.captureId, q);

  if (emitted.current) {
    await applyOutcome(
      emitted.sequenceId,
      meta.cameraRole,
      isAccepted(meta) ? 'OK_RECIBIDA' : 'RECHAZADA_CALIDAD',
      meta.captureId,
    );
  }
  await refreshCounters(meta.passId);

  // 5) Foto tardía de una sesión cerrada o sincronizada (8.13).
  if (session.status === 'CLOSED' || session.status === 'SYNCED') {
    await upsertSyncItem('CAPTURE', meta.captureId, meta.sessionId);
    await upsertSyncItem('PASS', meta.passId, meta.sessionId);
    await upsertSyncItem('SEQUENCE_BATCH', meta.passId, meta.sessionId);
    await updatePass(meta.passId, { remoteSyncStatus: 'PENDIENTE_NUBE' });
    await getDb().runAsync("UPDATE capture_sequences SET remote_sync_status = 'PENDIENTE_NUBE' WHERE pass_id = ?", [meta.passId]);
    if (session.status === 'SYNCED') await updateSession(session.sessionId, { status: 'CLOSED' });
    logEvent('INFO', 'TRANSFER', 'LATE', { captureId: meta.captureId, at: nowIso() }, meta.sessionId);
  }

  hooks.onEvidenceFile(meta.cameraRole, emitted.sequenceId, meta);
  hooks.sendAckFile(meta.deviceId, meta.sessionId, meta.captureId, 'RECEIVED');
  logEvent('INFO', 'TRANSFER', 'OK', { captureId: meta.captureId, role: meta.cameraRole }, meta.sessionId);
  return { result: 'RECEIVED', reason: null };
}
