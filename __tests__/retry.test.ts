// __tests__/retry.test.ts — Reintentos y clasificación de errores (maestro Anexo C.3).

import { classifyLocalTransfer, classifySyncError, nextDelayMs } from '../src/sync/retry';

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
