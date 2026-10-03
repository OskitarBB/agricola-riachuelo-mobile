// src/domain/sequence.ts — Estado de una secuencia derivado del resultado de cada cámara (maestro §11.3).
//
// QUÉ HACE: funciones puras que el motor de secuencias (src/controller/sequenceEngine.ts) usa para
// recalcular el estado cada vez que llega una respuesta o una foto de una cámara.

import type { CameraRole, SequenceSlot, SequenceStatus, SlotOutcome } from './types';

const FINAL_OUTCOMES: readonly SlotOutcome[] = ['OK_RECIBIDA', 'RECHAZADA_CALIDAD', 'ERROR_CAMARA', 'SIN_RESPUESTA'];

export function isFinalOutcome(outcome: SlotOutcome): boolean {
  return FINAL_OUTCOMES.includes(outcome);
}

/** Un resultado "respondido" ya liberó la orden (RN-11), aunque la foto aún esté viajando. */
export function isAnsweredOutcome(outcome: SlotOutcome): boolean {
  return outcome !== 'PENDIENTE';
}

/**
 * Regla (RN-06): COMPLETE solo si ambas cámaras tienen una foto aceptada (CAPTURE_OK) y recibida por el controlador.
 * - Si todavía falta algún resultado final: PARTIAL (si alguna cámara ya respondió) o COMMAND_SENT.
 * - Si todos los resultados son finales y no ambos son OK_RECIBIDA: INCOMPLETE.
 */
export function deriveSequenceStatus(slots: Record<CameraRole, SequenceSlot>): SequenceStatus {
  const outcomes = [slots.CAMERA_1.outcome, slots.CAMERA_2.outcome];
  if (outcomes.every((o) => o === 'OK_RECIBIDA')) return 'COMPLETE';
  if (outcomes.every(isFinalOutcome)) return 'INCOMPLETE';
  if (outcomes.every((o) => o === 'PENDIENTE')) return 'COMMAND_SENT';
  return 'PARTIAL';
}

/** Una repetición reemplaza el captureId del rol y reabre su resultado. */
export function applyRetake(
  slots: Record<CameraRole, SequenceSlot>,
  role: CameraRole,
  newCaptureId: string,
): Record<CameraRole, SequenceSlot> {
  return { ...slots, [role]: { role, captureId: newCaptureId, outcome: 'PENDIENTE' } };
}

/** ¿El resultado de esa cámara permite pedir "Repetir CÁMARA X"? (maestro §8.5) */
export function isRetakeable(outcome: SlotOutcome): boolean {
  return outcome === 'RECHAZADA_CALIDAD' || outcome === 'ERROR_CAMARA' || outcome === 'SIN_RESPUESTA';
}
