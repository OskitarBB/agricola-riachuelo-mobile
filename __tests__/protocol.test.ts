// __tests__/protocol.test.ts — Sobres del protocolo y esquemas zod (tarea T-01): aceptan ejemplos válidos y
// rechazan campos faltantes, tipos erróneos y v ≠ 1; el QR y la cabecera X-Capture-Meta también se validan.

import { createEnvelope, parseEnvelope, parsePairingQr, serializeEnvelope } from '../src/protocol/envelope';
import { localCaptureMetaSchema } from '../src/protocol/schemas';

const SID = '5b0f7a52-1d3c-4f0e-9a51-3f2b8c7d9e10';
const DID = '3e5a7c9e-1b3d-4f5a-9c7e-2d4f6a8c0e1b';

test('un CAPTURE_COMMAND válido ida y vuelta', () => {
  const env = createEnvelope('CAPTURE_COMMAND', SID, DID, {
    purpose: 'SECUENCIA',
    sequenceId: 'e2b4d6f8-1a3c-4e5f-8a9b-0c1d2e3f4a5b',
    sequenceNumber: 3,
    captureId: 'a1f0c3e2-6b7d-4c1a-9f2e-0d3b5a7c9e11',
    passId: '7c9e1a3b-5d7f-4a1b-8c2d-3e4f5a6b7c8d',
    lateralCode: 'LATERAL_A',
    mode: 'AUTOMATICO',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3000).toISOString(),
    replacesCaptureId: null,
  });
  const parsed = parseEnvelope(serializeEnvelope(env));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.envelope.type).toBe('CAPTURE_COMMAND');
});

test('rechaza MIXTO, v distinto de 1, JSON roto y payload incompleto', () => {
  const env = createEnvelope('SESSION_CONTEXT', SID, DID, {
    passId: null,
    lateralCode: null,
    lotId: null,
    rowId: null,
    segmentId: null,
    markerId: null,
    direction: null,
    mode: 'MANUAL',
    intervalMs: 2000,
  });
  const mixto = JSON.parse(serializeEnvelope(env));
  mixto.payload.mode = 'MIXTO';
  expect(parseEnvelope(JSON.stringify(mixto)).ok).toBe(false);
  const v2 = JSON.parse(serializeEnvelope(env));
  v2.v = 2;
  expect(parseEnvelope(JSON.stringify(v2)).ok).toBe(false);
  expect(parseEnvelope('{no es json').ok).toBe(false);
  const incomplete = JSON.parse(serializeEnvelope(env));
  delete incomplete.payload.intervalMs;
  const r = parseEnvelope(JSON.stringify(incomplete));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.messageId).toBe(env.messageId);
});

test('RESUME exige payload vacío', () => {
  const ok = createEnvelope('RESUME', SID, DID, {});
  expect(parseEnvelope(serializeEnvelope(ok)).ok).toBe(true);
  const bad = JSON.parse(serializeEnvelope(ok));
  bad.payload = { extra: 1 };
  expect(parseEnvelope(JSON.stringify(bad)).ok).toBe(false);
});

test('QR de emparejamiento', () => {
  const qr = {
    type: 'RIACHUELO_PAIR',
    protocolVersion: 1,
    host: '192.168.8.101',
    controlPort: 8765,
    filePort: 8766,
    sessionId: SID,
    pairingToken: 'q3Jx9mVt0b2L8wZr4nKp1A',
    controllerAppVersion: '0.2.0',
  };
  expect(parsePairingQr(JSON.stringify(qr))).toEqual(qr);
  expect(parsePairingQr(JSON.stringify({ ...qr, type: 'OTRO' }))).toBeNull();
  expect(parsePairingQr('https://ejemplo.com')).toBeNull();
});

test('cabecera X-Capture-Meta', () => {
  const meta = {
    captureId: 'a1f0c3e2-6b7d-4c1a-9f2e-0d3b5a7c9e11',
    sequenceId: 'e2b4d6f8-1a3c-4e5f-8a9b-0c1d2e3f4a5b',
    sessionId: SID,
    passId: null,
    lateralCode: null,
    isTest: true,
    deviceId: DID,
    cameraRole: 'CAMERA_1',
    userId: '9d1e0f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a',
    capturedAt: new Date().toISOString(),
    width: 4000,
    height: 3000,
    sizeBytes: 3912044,
    md5: '9e107d9d372bb6826bd81d3542a419d6',
    qualityStatus: 'UTILIZABLE',
    qualityReasons: [],
    qualityMetrics: null,
    profileVersion: 'Q0',
    replacesCaptureId: null,
  };
  expect(localCaptureMetaSchema.safeParse(meta).success).toBe(true);
  expect(localCaptureMetaSchema.safeParse({ ...meta, sizeBytes: 0 }).success).toBe(false);
});
