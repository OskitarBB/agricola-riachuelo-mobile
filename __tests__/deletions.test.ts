// __tests__/deletions.test.ts — Limpieza ordenada por el administrador (app 0.5.1, plataforma v1.3.1): códigos 410,
// forma de la respuesta y plan de borrado local.
import { errorFromResponse } from '../src/api/httpClient';
import { isDeletionCode, isValidDeletionResponse, planPurge } from '../src/domain/deletions';
import { classifySyncError } from '../src/sync/retry';

const page = (over: object = {}) => ({
  captures: [] as { captureId: string; sessionId: string }[],
  sessionIds: [] as string[],
  cursor: '2026-10-09T07:00:00.123456Z',
  hasMore: false,
  serverTime: '2026-10-09T07:00:01Z',
  ...over,
});

test('410 SESSION_DELETED y CAPTURE_DELETED se reconocen (no son errores de sincronización)', () => {
  expect(isDeletionCode('SESSION_DELETED')).toBe(true);
  expect(isDeletionCode('CAPTURE_DELETED')).toBe(true);
  expect(isDeletionCode('VALIDATION_ERROR')).toBe(false);
  expect(isDeletionCode(undefined)).toBe(false);
  // Sin el manejo nuevo serían DEFINITIVO (ERROR_SINCRONIZACION): syncService los atiende antes.
  expect(classifySyncError({ networkError: false, status: 410, code: 'SESSION_DELETED' })).toBe('DEFINITIVO');
});

test('forma mínima de GET /mobile/deleted-captures', () => {
  expect(isValidDeletionResponse(page())).toBe(true);
  expect(isValidDeletionResponse(page({ cursor: null }))).toBe(true);
  expect(isValidDeletionResponse(page({ captures: [{ captureId: 1 }] }))).toBe(false);
  expect(isValidDeletionResponse({ captures: [] })).toBe(false);
  expect(isValidDeletionResponse(null)).toBe(false);
});

test('las fotos de una sesión borrada se borran con la sesión; las sueltas, una por una y sin repetir', () => {
  const plan = planPurge([
    page({
      captures: [
        { captureId: 'c1', sessionId: 's1' },
        { captureId: 'c2', sessionId: 's2' },
      ],
      sessionIds: ['s1'],
      hasMore: true,
    }),
    page({ captures: [{ captureId: 'c2', sessionId: 's2' }, { captureId: 'c3', sessionId: 's2' }] }),
  ]);
  expect(plan.sessionIds).toEqual(['s1']);
  expect(plan.captureIds.sort()).toEqual(['c2', 'c3']);
});

test('el cliente HTTP reconoce los códigos 410 de la limpieza', () => {
  const e = errorFromResponse(410, JSON.stringify({ code: 'SESSION_DELETED', message: 'x', traceId: 't' }));
  expect(e.code).toBe('SESSION_DELETED');
  expect(errorFromResponse(410, JSON.stringify({ code: 'CAPTURE_DELETED' })).code).toBe('CAPTURE_DELETED');
});
