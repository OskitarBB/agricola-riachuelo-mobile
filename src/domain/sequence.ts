// src/domain/sequence.ts — Estado de una secuencia derivado del resultado de cada cámara (maestro §11.3).
//
// QUÉ HACE: funciones puras que el motor de secuencias (src/controller/sequenceEngine.ts) usa para
// recalcular el estado cada vez que llega una respuesta o una foto de una cámara.

import type { CameraRole, QualityResult, SequenceSlot, SequenceStatus, SlotOutcome } from './types';

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

/** Repetición que falta hacer en una cámara de la última secuencia (v0.6.1, ADR 0012). */
export interface PendingRetake {
  role: CameraRole;
  /** Número de este intento de repetición: 1..maxAttempts. */
  attempt: number;
  maxAttempts: number;
}

/**
 * v0.6.1 (ADR 0012): repeticiones pendientes de UNA secuencia (el controlador pasa solo la última).
 * Una cámara queda pendiente si su resultado permite repetir y todavía no usó `maxAttempts` repeticiones;
 * agotados los intentos ya no se pide nada y se sigue con la siguiente captura.
 */
export function pendingRetakes(
  slots: Record<CameraRole, SequenceSlot>,
  used: Partial<Record<CameraRole, number>>,
  maxAttempts: number,
): PendingRetake[] {
  const roles: readonly CameraRole[] = ['CAMERA_1', 'CAMERA_2'];
  return roles
    .filter((role) => isRetakeable(slots[role].outcome) && (used[role] ?? 0) < maxAttempts)
    .map((role) => ({ role, attempt: (used[role] ?? 0) + 1, maxAttempts }));
}

/** ¿Es el último intento permitido? En ese intento la cámara acepta la foto aunque la calidad no sea buena. */
export function isLastAttempt(r: Pick<PendingRetake, 'attempt' | 'maxAttempts'>): boolean {
  return r.attempt >= r.maxAttempts;
}

/**
 * Último intento (v0.6.1): una foto REPETIR_NITIDEZ o REPETIR_EXPOSICION ya no se rechaza; queda
 * PENDIENTE_REVISION_TECNICA (con sus motivos) para que se envíe y la IA de la plataforma la evalúe.
 * ERROR_CAMARA sigue siendo un fallo: no hay una foto que mandar.
 */
export function acceptOnLastAttempt(q: QualityResult): QualityResult {
  if (q.status !== 'REPETIR_NITIDEZ' && q.status !== 'REPETIR_EXPOSICION') return q;
  return { ...q, status: 'PENDIENTE_REVISION_TECNICA' };
}
