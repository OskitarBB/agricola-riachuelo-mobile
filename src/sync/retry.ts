// src/sync/retry.ts — Espera entre reintentos y clasificación de errores (maestro Anexo C.3, código probado).
//
// QUÉ HACE:
//  - nextDelayMs(): espera del intento N según una tabla (repite la última; respeta un tope).
//  - classifySyncError(): qué hacer ante un fallo con el backend (Fase 4): reintentar, renovar token,
//    pedir login, enviar primero el padre o marcar error definitivo.
//  - classifyLocalTransfer(): qué hace la CÁMARA tras cada intento de enviar una foto al controlador.

import type { ApiErrorCode } from '../api/dto';
import type { LocalCaptureResponse } from '../protocol/messages';

/** attempt empieza en 1. Usa la tabla de esperas y repite la última; nunca supera maxDelayMs si se indica. */
export function nextDelayMs(attempt: number, delaysMs: readonly number[], maxDelayMs?: number): number {
  if (delaysMs.length === 0) return 0;
  const idx = Math.min(Math.max(attempt, 1), delaysMs.length) - 1;
  const d = delaysMs[idx];
  return maxDelayMs === undefined ? d : Math.min(d, maxDelayMs);
}

export type SyncErrorClass =
  | 'REINTENTAR' // red, tiempo agotado, 408, 429, 5xx: sigue en cola con espera creciente
  | 'RENOVAR_TOKEN' // 401 por token vencido: renovar y reintentar una vez
  | 'REQUIERE_LOGIN' // refresh inválido, cuenta bloqueada, dispositivo revocado, rol no permitido: pausar la cola
  | 'SINCRONIZAR_PADRE' // 404 de sesión/pasada/secuencia: enviar primero el registro padre
  | 'DEFINITIVO'; // 400, 409, 413, 422 y otros 4xx: ERROR_SINCRONIZACION, revisión manual

export function classifySyncError(input: { networkError: boolean; status?: number; code?: ApiErrorCode }): SyncErrorClass {
  if (input.networkError || input.status === undefined) return 'REINTENTAR';
  const { status, code } = input;
  if (status === 401) return code === 'REFRESH_INVALID' ? 'REQUIERE_LOGIN' : 'RENOVAR_TOKEN';
  if (status === 403) {
    return code === 'ACCOUNT_BLOCKED' || code === 'DEVICE_REVOKED' || code === 'ROLE_NOT_ALLOWED' || code === undefined
      ? 'REQUIERE_LOGIN'
      : 'DEFINITIVO';
  }
  if (status === 404 && (code === 'SESSION_NOT_FOUND' || code === 'PASS_NOT_FOUND' || code === 'SEQUENCE_NOT_FOUND')) {
    return 'SINCRONIZAR_PADRE';
  }
  if (status === 408 || status === 429 || status >= 500) return 'REINTENTAR';
  return 'DEFINITIVO';
}

// ------------------------------------------------------------- transferencia local (cámara → controlador)
export type LocalTransferDecision =
  | 'RECIBIDA' // RECIBIDA_CONTROLADOR
  | 'REINTENTAR' // vuelve a PENDIENTE_LOCAL con espera transfer.retryDelaysMs
  | 'ERROR_LOCAL'; // ERROR_LOCAL: event_log TRANSFER/ERROR en la cámara; solo reintento manual

/**
 * Decide el siguiente estado de una foto tras un intento de envío.
 * checksumFailures cuenta los MD5_MISMATCH / SIZE_MISMATCH previos de esa foto (sin el actual).
 */
export function classifyLocalTransfer(
  outcome: { networkError: true } | { networkError: false; response: LocalCaptureResponse },
  checksumFailures: number,
  maxChecksumRetries: number,
): LocalTransferDecision {
  if (outcome.networkError) return 'REINTENTAR'; // red, tiempo agotado o conexión cortada
  const { result, reason } = outcome.response;
  if (result === 'RECEIVED' || result === 'ALREADY_RECEIVED') return 'RECIBIDA';
  switch (reason) {
    case 'MD5_MISMATCH':
    case 'SIZE_MISMATCH':
      return checksumFailures + 1 < maxChecksumRetries ? 'REINTENTAR' : 'ERROR_LOCAL';
    case 'NO_SPACE':
    case 'INTERNAL':
      return 'REINTENTAR';
    default:
      // UNKNOWN_SESSION, UNKNOWN_SEQUENCE, WRONG_DEVICE, CAPTURE_CONFLICT, INVALID_META,
      // LENGTH_REQUIRED, PAYLOAD_TOO_LARGE, NOT_FOUND o motivo nulo en un rechazo
      return 'ERROR_LOCAL';
  }
}
