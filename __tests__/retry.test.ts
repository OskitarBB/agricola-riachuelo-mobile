// __tests__/retry.test.ts — Reintentos y clasificación de errores (maestro Anexo C.3; pruebas del Anexo E.7 en Jest).

import type { LocalCaptureResponse } from '../src/protocol/messages';
import { classifyCloudinaryError, classifyLocalTransfer, classifySyncError, nextDelayMs } from '../src/sync/retry';

test('nextDelayMs repite la última espera y respeta el tope', () => {
  const t = [1000, 2000, 5000];
  expect(nextDelayMs(0, t)).toBe(1000);
  expect(nextDelayMs(2, t)).toBe(2000);
  expect(nextDelayMs(10, t)).toBe(5000);
  expect(nextDelayMs(10, t, 3000)).toBe(3000);
  expect(nextDelayMs(1, [])).toBe(0);
});

test('classifySyncError', () => {
  expect(classifySyncError({ networkError: true })).toBe('REINTENTAR');
  expect(classifySyncError({ networkError: false, status: 401 })).toBe('RENOVAR_TOKEN');
  expect(classifySyncError({ networkError: false, status: 401, code: 'REFRESH_INVALID' })).toBe('REQUIERE_LOGIN');
  expect(classifySyncError({ networkError: false, status: 403, code: 'DEVICE_REVOKED' })).toBe('REQUIERE_LOGIN');
  expect(classifySyncError({ networkError: false, status: 404, code: 'PASS_NOT_FOUND' })).toBe('SINCRONIZAR_PADRE');
  expect(classifySyncError({ networkError: false, status: 503 })).toBe('REINTENTAR');
  expect(classifySyncError({ networkError: false, status: 429 })).toBe('REINTENTAR');
  expect(classifySyncError({ networkError: false, status: 422 })).toBe('DEFINITIVO');
});

test('classifyLocalTransfer', () => {
  expect(classifyLocalTransfer({ networkError: true }, 0, 3)).toBe('REINTENTAR');
  expect(classifyLocalTransfer({ networkError: false, response: { result: 'ALREADY_RECEIVED', reason: null } }, 0, 3)).toBe(
    'RECIBIDA',
  );
  expect(classifyLocalTransfer({ networkError: false, response: { result: 'REJECTED', reason: 'MD5_MISMATCH' } }, 1, 3)).toBe(
    'REINTENTAR',
  );
  expect(classifyLocalTransfer({ networkError: false, response: { result: 'REJECTED', reason: 'MD5_MISMATCH' } }, 2, 3)).toBe(
    'ERROR_LOCAL',
  );
  expect(classifyLocalTransfer({ networkError: false, response: { result: 'REJECTED', reason: 'WRONG_DEVICE' } }, 0, 3)).toBe(
    'ERROR_LOCAL',
  );
  expect(classifyLocalTransfer({ networkError: false, response: { result: 'REJECTED', reason: 'NO_SPACE' } }, 0, 3)).toBe(
    'REINTENTAR',
  );
});

// ------------------------------------------------------------------ Anexo E.7 (maestro v2.0)

test('E.7 espera creciente con tope', () => {
  const d = [2000, 4000, 8000, 16000];
  expect(nextDelayMs(1, d)).toBe(2000);
  expect(nextDelayMs(4, d)).toBe(16000);
  expect(nextDelayMs(9, d)).toBe(16000);
  expect(nextDelayMs(9, d, 10000)).toBe(10000);
});

test('E.7 clasificación de errores de sincronización', () => {
  expect(classifySyncError({ networkError: true })).toBe('REINTENTAR');
  expect(classifySyncError({ networkError: false, status: 503 })).toBe('REINTENTAR');
  expect(classifySyncError({ networkError: false, status: 429 })).toBe('REINTENTAR');
  expect(classifySyncError({ networkError: false, status: 401, code: 'TOKEN_EXPIRED' })).toBe('RENOVAR_TOKEN');
  expect(classifySyncError({ networkError: false, status: 401, code: 'REFRESH_INVALID' })).toBe('REQUIERE_LOGIN');
  expect(classifySyncError({ networkError: false, status: 403, code: 'DEVICE_REVOKED' })).toBe('REQUIERE_LOGIN');
  expect(classifySyncError({ networkError: false, status: 404, code: 'PASS_NOT_FOUND' })).toBe('SINCRONIZAR_PADRE');
  expect(classifySyncError({ networkError: false, status: 409, code: 'CAPTURE_CONFLICT' })).toBe('DEFINITIVO');
  expect(classifySyncError({ networkError: false, status: 400, code: 'VALIDATION_ERROR' })).toBe('DEFINITIVO');
});

test('E.7 decisión tras un intento de transferencia local', () => {
  const rejected = (reason: LocalCaptureResponse['reason']) => ({
    networkError: false as const,
    response: { result: 'REJECTED' as const, reason },
  });
  expect(classifyLocalTransfer({ networkError: true }, 0, 3)).toBe('REINTENTAR');
  expect(classifyLocalTransfer({ networkError: false, response: { result: 'RECEIVED', reason: null } }, 0, 3)).toBe('RECIBIDA');
  expect(classifyLocalTransfer({ networkError: false, response: { result: 'ALREADY_RECEIVED', reason: null } }, 2, 3)).toBe(
    'RECIBIDA',
  );
  expect(classifyLocalTransfer(rejected('MD5_MISMATCH'), 0, 3)).toBe('REINTENTAR');
  expect(classifyLocalTransfer(rejected('SIZE_MISMATCH'), 1, 3)).toBe('REINTENTAR');
  expect(classifyLocalTransfer(rejected('MD5_MISMATCH'), 2, 3)).toBe('ERROR_LOCAL');
  expect(classifyLocalTransfer(rejected('NO_SPACE'), 0, 3)).toBe('REINTENTAR');
  expect(classifyLocalTransfer(rejected('INTERNAL'), 0, 3)).toBe('REINTENTAR');
  for (const r of [
    'UNKNOWN_SESSION',
    'UNKNOWN_SEQUENCE',
    'WRONG_DEVICE',
    'CAPTURE_CONFLICT',
    'INVALID_META',
    'LENGTH_REQUIRED',
    'PAYLOAD_TOO_LARGE',
    'NOT_FOUND',
  ] as const) {
    expect(classifyLocalTransfer(rejected(r), 0, 3)).toBe('ERROR_LOCAL');
  }
});

test('E.7 v2.0: clasificación de errores de la subida y de la confirmación', () => {
  expect(classifySyncError({ networkError: false, status: 422, code: 'UPLOAD_SIGNATURE_INVALID' })).toBe('REPETIR_SUBIDA');
  expect(classifySyncError({ networkError: false, status: 422, code: 'UPLOAD_NOT_FOUND' })).toBe('REPETIR_SUBIDA');
  expect(classifySyncError({ networkError: false, status: 409, code: 'UPLOAD_MISMATCH' })).toBe('DEFINITIVO');
  expect(classifyCloudinaryError({ networkError: true })).toEqual({ cls: 'REINTENTAR', code: 'RED' });
  expect(classifyCloudinaryError({ networkError: false, status: 400, message: 'Stale request - reported time is 1' })).toEqual({
    cls: 'NUEVO_TICKET',
    code: 'TICKET_VENCIDO',
  });
  expect(classifyCloudinaryError({ networkError: false, status: 401, message: 'Invalid Signature abc' })).toEqual({
    cls: 'NUEVO_TICKET',
    code: 'FIRMA_RECHAZADA',
  });
  expect(
    classifyCloudinaryError({ networkError: false, status: 400, message: 'File size too large. Got 12000000. Maximum is 10485760.' }),
  ).toEqual({ cls: 'DEFINITIVO', code: 'FOTO_DEMASIADO_GRANDE' });
  expect(classifyCloudinaryError({ networkError: false, status: 420, message: 'Rate Limit Exceeded' })).toEqual({
    cls: 'REINTENTAR',
    code: 'LIMITE_DE_TASA',
  });
  expect(classifyCloudinaryError({ networkError: false, status: 503, message: null })).toEqual({
    cls: 'REINTENTAR',
    code: 'CLOUDINARY_NO_DISPONIBLE',
  });
  expect(classifyCloudinaryError({ networkError: false, status: 200, message: 'RESPUESTA_INVALIDA' })).toEqual({
    cls: 'REINTENTAR',
    code: 'RESPUESTA_INVALIDA',
  });
  expect(classifyCloudinaryError({ networkError: false, status: 200, message: 'PUBLIC_ID_DISTINTO' })).toEqual({
    cls: 'DEFINITIVO',
    code: 'PUBLIC_ID_DISTINTO',
  });
  expect(classifyCloudinaryError({ networkError: false, status: 400, message: 'Invalid image file' })).toEqual({
    cls: 'DEFINITIVO',
    code: 'RECHAZO_CLOUDINARY',
  });
});
