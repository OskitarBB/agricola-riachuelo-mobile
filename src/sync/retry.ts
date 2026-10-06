// src/sync/retry.ts — Espera entre reintentos y clasificación de errores (maestro v2.0, Anexo C.3, código probado).
//
// QUÉ HACE:
//  - nextDelayMs(): espera del intento N según una tabla (repite la última; respeta un tope).
//  - classifySyncError(): qué hacer ante un fallo con la plataforma Django: reintentar, renovar token, pedir login,
//    enviar primero el padre, pedir un ticket nuevo, volver a subir la foto o marcar error definitivo.
//  - classifyCloudinaryError() (v2.0): qué hacer ante un fallo de la subida directa a Cloudinary (15.7, regla 7).
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
  | 'NUEVO_TICKET' // v2.0: Cloudinary rechazó el ticket (vencido o firma): pedir otro y subir de inmediato
  | 'REPETIR_SUBIDA' // v2.0: Django rechazó la subida (UPLOAD_SIGNATURE_INVALID / UPLOAD_NOT_FOUND): subir de nuevo
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
  if (code === 'UPLOAD_SIGNATURE_INVALID' || code === 'UPLOAD_NOT_FOUND') return 'REPETIR_SUBIDA'; // v2.0 (422)
  if (status === 408 || status === 429 || status >= 500) return 'REINTENTAR';
  return 'DEFINITIVO';
}

// ------------------------------------------------------------- subida directa a Cloudinary (v2.0, 15.7)

/** Código interno (event_log y PANT-20) de una subida fallida a Cloudinary. */
export type CloudinaryFailureCode =
  | 'RED' // sin conexión, conexión cortada o tiempo agotado
  | 'TICKET_VENCIDO' // "Stale request": la firma tiene más de 1 hora
  | 'FIRMA_RECHAZADA' // "Invalid Signature" o 401
  | 'FOTO_DEMASIADO_GRANDE' // "File size too large" u otro límite de tamaño o megapíxeles del plan
  | 'LIMITE_DE_TASA' // 420 o 429
  | 'CLOUDINARY_NO_DISPONIBLE' // 408 o 5xx
  | 'RESPUESTA_INVALIDA' // 2xx con un cuerpo que no pasa el esquema
  | 'PUBLIC_ID_DISTINTO' // 2xx con otro public_id: no se confirma
  | 'RECHAZO_CLOUDINARY'; // cualquier otro 4xx

export function classifyCloudinaryError(input: { networkError: boolean; status?: number; message?: string | null }): {
  cls: 'REINTENTAR' | 'NUEVO_TICKET' | 'DEFINITIVO';
  code: CloudinaryFailureCode;
} {
  if (input.networkError || input.status === undefined) return { cls: 'REINTENTAR', code: 'RED' };
  const status = input.status;
  const message = input.message ?? '';
  if (message === 'RESPUESTA_INVALIDA') return { cls: 'REINTENTAR', code: 'RESPUESTA_INVALIDA' };
  if (message === 'PUBLIC_ID_DISTINTO') return { cls: 'DEFINITIVO', code: 'PUBLIC_ID_DISTINTO' };
  if (/stale request/i.test(message)) return { cls: 'NUEVO_TICKET', code: 'TICKET_VENCIDO' };
  if (/invalid signature/i.test(message) || status === 401) return { cls: 'NUEVO_TICKET', code: 'FIRMA_RECHAZADA' };
  if (/too large/i.test(message)) return { cls: 'DEFINITIVO', code: 'FOTO_DEMASIADO_GRANDE' };
  if (status === 420 || status === 429) return { cls: 'REINTENTAR', code: 'LIMITE_DE_TASA' };
  if (status === 408 || status >= 500) return { cls: 'REINTENTAR', code: 'CLOUDINARY_NO_DISPONIBLE' };
  return { cls: 'DEFINITIVO', code: 'RECHAZO_CLOUDINARY' };
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
