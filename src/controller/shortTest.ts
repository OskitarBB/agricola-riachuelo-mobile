// src/controller/shortTest.ts — Prueba corta antes de la primera pasada (contrato del maestro §14.12).
//
// QUÉ HACE: define el estado de la prueba en curso (app_meta.short_test_pending) y la decisión por cámara:
//  - APROBADA: respondió CAPTURE_OK a tiempo y su foto llegó con md5 correcto dentro de shortTest.timeoutMs.
//  - APROBADA_CALIDAD: respondió QUALITY_ERROR con REPETIR_* (la comunicación funciona) y la foto llegó →
//    PANT-14 muestra PRUEBA_CORTA_CALIDAD.
//  - REPROBADA: ERROR_CAMARA, ERROR, sin respuesta o sin foto a tiempo → PRUEBA_CORTA_FALLIDA.
// Las capturas de prueba no son evidencia (RN-21): no cambian contadores y nunca se sincronizan.

import type { CameraRole, QualityStatus } from '../domain/types';
import type { ShortTestCamState } from './controllerStore';

export interface ShortTestPending {
  sessionId: string;
  testId: string;
  captureIds: Record<CameraRole, string>;
  issuedAt: string;
}

export interface ShortTestObservation {
  response: 'CAPTURE_OK' | 'QUALITY_ERROR' | 'ERROR' | 'SIN_RESPUESTA' | null;
  quality: QualityStatus | null;
  /** Foto recibida y verificada (RECEIVED). */
  transferred: boolean;
  /** ms desde la orden hasta la respuesta. */
  responseMs: number | null;
  /** ms desde la orden hasta recibir la foto. */
  totalMs: number | null;
}

export function decideShortTest(
  o: ShortTestObservation,
  cfg: { captureResponseTimeoutMs: number; shortTestTimeoutMs: number },
): ShortTestCamState {
  if (o.response === null) return 'EN_CURSO';
  if (o.response === 'ERROR' || o.response === 'SIN_RESPUESTA') return 'REPROBADA';
  if (o.responseMs !== null && o.responseMs > cfg.captureResponseTimeoutMs) return 'REPROBADA';
  if (o.quality === 'ERROR_CAMARA') return 'REPROBADA';
  if (!o.transferred) return 'EN_CURSO';
  if (o.totalMs !== null && o.totalMs > cfg.shortTestTimeoutMs) return 'REPROBADA';
  if (o.response === 'CAPTURE_OK') return 'APROBADA';
  return o.quality === 'REPETIR_NITIDEZ' || o.quality === 'REPETIR_EXPOSICION' ? 'APROBADA_CALIDAD' : 'REPROBADA';
}

export function isShortTestFinal(state: ShortTestCamState): boolean {
  return state === 'APROBADA' || state === 'APROBADA_CALIDAD' || state === 'REPROBADA';
}

export function isShortTestPassed(state: ShortTestCamState): boolean {
  return state === 'APROBADA' || state === 'APROBADA_CALIDAD';
}
