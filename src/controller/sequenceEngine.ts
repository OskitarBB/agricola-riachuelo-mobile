// src/controller/sequenceEngine.ts — Secuencias coordinadas (maestro §14.7, RF-21, RN-06, RN-07, RN-18).
//
// QUÉ HACE:
//  - createSequence(): número correlativo, dos captureId (uno por cámara), contexto vigente de la pasada
//    (lote, hilera, segmento, marcador), GPS con antigüedad ≤ gps.maxAgeMs (o ninguno: RN-18) y vencimiento.
//  - applyOutcome(): actualiza el resultado de UNA cámara validando SLOT_TRANSITIONS y recalcula el estado
//    de la secuencia con deriveSequenceStatus (COMPLETE solo si ambas fotos aceptadas y recibidas).
//  - prepareRetake(): repetición de UNA cámara (RN-07): guarda en retake_requests el contexto vigente
//    ANTES de enviar la orden y reemplaza el captureId de ese rol (la foto de la otra cámara se conserva).

import { CONFIG } from '../config';
import { newId } from '../domain/ids';
import { applyRetake, deriveSequenceStatus } from '../domain/sequence';
import { canTransition, SLOT_TRANSITIONS } from '../domain/stateMachines';
import { addMsIso, nowIso } from '../domain/time';
import type { CameraRole, CaptureMode, CaptureSequence, GpsFix, MonitoringPass, SlotOutcome } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';
import { inTransaction } from '../storage/db';
import { insertRetake } from '../storage/repositories/passRepo';
import { getSequence, insertSequence, nextSequenceNumber, updateSequenceSlots } from '../storage/repositories/sequenceRepo';

export async function createSequence(
  pass: MonitoringPass,
  mode: CaptureMode,
  gps: { fix: GpsFix; ageMs: number } | null,
): Promise<CaptureSequence> {
  const issuedAt = nowIso();
  const seq: CaptureSequence = {
    sequenceId: newId(),
    passId: pass.passId,
    sessionId: pass.sessionId,
    sequenceNumber: await nextSequenceNumber(pass.passId),
    mode,
    status: 'CREATED',
    lotId: pass.lotId,
    rowId: pass.rowId,
    segmentId: pass.currentSegmentId,
    markerId: pass.currentMarkerId,
    gps: gps?.fix ?? null,
    gpsAgeMs: gps ? Math.round(gps.ageMs) : null,
    issuedAt,
    expiresAt: addMsIso(issuedAt, CONFIG.protocol.commandValidityMs),
    completedAt: null,
    slots: {
      CAMERA_1: { role: 'CAMERA_1', captureId: newId(), outcome: 'PENDIENTE' },
      CAMERA_2: { role: 'CAMERA_2', captureId: newId(), outcome: 'PENDIENTE' },
    },
    remoteSyncStatus: 'PENDIENTE_NUBE',
  };
  await insertSequence(seq);
  logEvent(
    'INFO',
    'CAPTURE',
    'SEQUENCE_CREATED',
    { sequenceId: seq.sequenceId, n: seq.sequenceNumber, gps: !!gps },
    pass.sessionId,
  );
  return seq;
}

/** CREATED → COMMAND_SENT después de enviar las órdenes (o CANCELLED si no se pudo enviar). */
export async function markSent(seq: CaptureSequence, sent: boolean): Promise<CaptureSequence> {
  const updated: CaptureSequence = { ...seq, status: sent ? 'COMMAND_SENT' : 'CANCELLED' };
  await updateSequenceSlots(updated);
  logEvent('INFO', 'CAPTURE', sent ? 'COMMAND_SENT' : 'SEQUENCE_CANCELLED', { sequenceId: seq.sequenceId }, seq.sessionId);
  return updated;
}

/** Cambia el resultado de una cámara si la transición es válida. Devuelve la secuencia actualizada o null. */
export async function applyOutcome(
  sequenceId: string,
  role: CameraRole,
  outcome: SlotOutcome,
  captureId?: string,
): Promise<CaptureSequence | null> {
  const seq = await getSequence(sequenceId);
  if (!seq) return null;
  const slot = seq.slots[role];
  if (captureId && slot.captureId !== captureId) return seq; // respuesta de un captureId ya reemplazado
  if (slot.outcome === outcome) return seq;
  if (!canTransition(SLOT_TRANSITIONS, slot.outcome, outcome)) {
    logEvent('DEBUG', 'CAPTURE', 'SLOT_IGNORED', { sequenceId, role, from: slot.outcome, to: outcome }, seq.sessionId);
    return seq;
  }
  const slots = { ...seq.slots, [role]: { ...slot, outcome } };
  const status = deriveSequenceStatus(slots);
  const updated: CaptureSequence = {
    ...seq,
    slots,
    status,
    completedAt: status === 'COMPLETE' || status === 'INCOMPLETE' ? (seq.completedAt ?? nowIso()) : null,
  };
  await updateSequenceSlots(updated);
  return updated;
}

/** RN-07: guarda el contexto vigente en retake_requests y reabre el resultado de esa cámara. */
export async function prepareRetake(
  seq: CaptureSequence,
  role: CameraRole,
  pass: MonitoringPass,
  gps: { fix: GpsFix; ageMs: number } | null,
): Promise<{ seq: CaptureSequence; newCaptureId: string; replaces: string }> {
  const newCaptureId = newId();
  const replaces = seq.slots[role].captureId;
  const slots = applyRetake(seq.slots, role, newCaptureId);
  const updated: CaptureSequence = { ...seq, slots, status: deriveSequenceStatus(slots), completedAt: null };
  await inTransaction(async (txn) => {
    await insertRetake(
      {
        captureId: newCaptureId,
        sequenceId: seq.sequenceId,
        passId: pass.passId,
        cameraRole: role,
        replacesCaptureId: replaces,
        requestedAt: nowIso(),
        segmentId: pass.currentSegmentId,
        markerId: pass.currentMarkerId,
        gps: gps?.fix ?? null,
        gpsAgeMs: gps ? Math.round(gps.ageMs) : null,
      },
      txn,
    );
    await updateSequenceSlots(updated, txn);
  });
  logEvent('INFO', 'CAPTURE', 'RETAKE', { sequenceId: seq.sequenceId, role }, seq.sessionId);
  return { seq: updated, newCaptureId, replaces };
}
