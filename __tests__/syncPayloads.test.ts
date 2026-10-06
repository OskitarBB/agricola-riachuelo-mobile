// __tests__/syncPayloads.test.ts — Datos locales → contrato /api/v1 de la plataforma Django (Fase 4).
// Reglas del servidor real (api/v1/serializers.py): lateral de la pasada, motivos de calidad aceptados, referencias de
// incidencias que el servidor conoce, lotes de hasta 200 y largos máximos.

import type {
  Capture,
  CaptureSequence,
  Incident,
  MarkerChange,
  MonitoringPass,
  MonitoringSession,
  QualityResult,
  RetakeRequest,
  SessionDevice,
} from '../src/domain/types';
import {
  buildCaptureMetadata,
  buildIncidentDtos,
  buildPassRequest,
  buildSequenceDto,
  buildSessionRequest,
  chunk,
  serverQualityReasons,
} from '../src/sync/syncPayloads';

const T = '2026-10-05T10:00:00.000Z';

const session: MonitoringSession = {
  sessionId: 'S1',
  operatorUserId: 'U-OP',
  controllerDeviceId: 'D-CTRL',
  status: 'CLOSED',
  mode: 'AUTOMATICO',
  intervalMs: 4000,
  startedAt: T,
  endedAt: '2026-10-05T12:00:00.000Z',
  appVersion: '0.4.0',
  configVersion: 'CFG-4',
  qualityProfileVersion: 'Q0',
  pairingTokenHash: 'hash-que-no-se-envia',
  shortTestPassedAt: T,
  createdAt: T,
  updatedAt: T,
  remoteSyncStatus: 'PENDIENTE_NUBE',
};

const device = (role: 'CAMERA_1' | 'CAMERA_2', userId: string): SessionDevice => ({
  sessionId: 'S1',
  role,
  deviceId: `D-${role}`,
  userId,
  platform: 'android',
  model: 'Moto G'.padEnd(250, 'x'),
  osVersion: '14',
  appVersion: '0.4.0',
  pairedAt: T,
  lastSeenAt: T,
  linkStatus: 'CONECTADA',
  released: false,
  batteryLevel: 80,
  freeSpaceBytes: 1e9,
  pendingTransfers: 0,
  clockOffsetMs: 12,
});

const pass: MonitoringPass = {
  passId: 'P1',
  sessionId: 'S1',
  lotId: 'L1',
  rowId: 'R1',
  lateralCode: 'LATERAL_B',
  passOrder: 2,
  direction: 'DESCENDENTE',
  startMarkerId: 'M1',
  endMarkerId: null,
  currentSegmentId: 'SEG1',
  currentMarkerId: 'M1',
  status: 'COMPLETED',
  startedAt: T,
  endedAt: T,
  sequencesTotal: 3,
  sequencesComplete: 2,
  sequencesIncomplete: 1,
  remoteSyncStatus: 'PENDIENTE_NUBE',
};

const capture: Capture = {
  captureId: 'C1',
  sequenceId: 'Q1',
  sessionId: 'S1',
  passId: 'P1',
  lateralCode: 'LATERAL_A', // fila pendiente creada con un lateral equivocado: se usa el de la pasada
  isTest: false,
  deviceId: 'D-CAMERA_1',
  cameraRole: 'CAMERA_1',
  userId: '',
  capturedAt: T,
  filePath: 'file:///captures/S1/P1/C1.jpg',
  sizeBytes: 3_912_044,
  width: 4000,
  height: 3000,
  md5: '9E107D9D372BB6826BD81D3542A419D6',
  qualityStatus: 'UTILIZABLE',
  qualityProfileVersion: 'Q0',
  replacesCaptureId: null,
  localTransferStatus: 'RECIBIDA_CONTROLADOR',
  remoteSyncStatus: 'PENDIENTE_NUBE',
  transferAttempts: 1,
  syncAttempts: 0,
  lastError: null,
  fileDeletedAt: null,
};

const quality: QualityResult = {
  status: 'REPETIR_NITIDEZ',
  reasons: ['NITIDEZ_BAJA', 'CAMARA_EN_MOVIMIENTO', 'NITIDEZ_BAJA'],
  metrics: { luminanceMean: 120, darkRatio: 0.01, brightRatio: 0.02, laplacianVariance: 80.5, analyzedRegions: 4.4, durationMs: 310 },
  profileVersion: 'Q0',
};

describe('sesión (10 y 60)', () => {
  test('CLOSING sin endedAt; CLOSED con endedAt; nunca SYNCED ni el hash del QR', () => {
    const devices = [device('CAMERA_1', 'U-C1'), device('CAMERA_2', 'U-C2')];
    const open = buildSessionRequest(session, devices, 'CLOSING');
    expect(open.status).toBe('CLOSING');
    expect(open.endedAt).toBeNull();
    const closed = buildSessionRequest(session, devices, 'CLOSED');
    expect(closed.status).toBe('CLOSED');
    expect(closed.endedAt).toBe('2026-10-05T12:00:00.000Z');
    expect(JSON.stringify(closed)).not.toContain('hash-que-no-se-envia');
    expect(closed.cameras).toHaveLength(2);
    expect(closed.cameras[0].model.length).toBe(200); // largo máximo del servidor
    expect(closed.cameras[1]).toMatchObject({ role: 'CAMERA_2', userId: 'U-C2', released: false });
  });
});

describe('pasada (20) y secuencias (30)', () => {
  test('pasada con cambios de marcador y GPS', () => {
    const changes: MarkerChange[] = [
      { markerChangeId: 'MC1', passId: 'P1', markerId: 'M2', segmentId: 'SEG2', changedAt: T, gps: { lat: -14.1, lon: -75.7, accuracyM: 5, timestamp: T } },
      { markerChangeId: 'MC2', passId: 'P1', markerId: null, segmentId: null, changedAt: T, gps: null },
    ];
    const req = buildPassRequest(pass, changes);
    expect(req).toMatchObject({ passId: 'P1', lateralCode: 'LATERAL_B', direction: 'DESCENDENTE', status: 'COMPLETED' });
    expect(req.markerChanges[0]).toEqual({
      markerChangeId: 'MC1',
      markerId: 'M2',
      segmentId: 'SEG2',
      changedAt: T,
      lat: -14.1,
      lon: -75.7,
      gpsAccuracyM: 5,
      gpsTimestamp: T,
    });
    expect(req.markerChanges[1].lat).toBeNull();
  });

  test('secuencia con los captureId vigentes y el resultado por cámara', () => {
    const q: CaptureSequence = {
      sequenceId: 'Q1',
      passId: 'P1',
      sessionId: 'S1',
      sequenceNumber: 7,
      mode: 'MANUAL',
      status: 'PARTIAL',
      lotId: 'L1',
      rowId: 'R1',
      segmentId: 'SEG1',
      markerId: 'M1',
      gps: null,
      gpsAgeMs: null,
      issuedAt: T,
      expiresAt: T,
      completedAt: null,
      slots: {
        CAMERA_1: { role: 'CAMERA_1', captureId: 'C1', outcome: 'OK_RECIBIDA' },
        CAMERA_2: { role: 'CAMERA_2', captureId: 'C2', outcome: 'SIN_RESPUESTA' },
      },
      remoteSyncStatus: 'PENDIENTE_NUBE',
    };
    const dto = buildSequenceDto(q);
    expect(dto.expectedCaptureIds).toEqual({ CAMERA_1: 'C1', CAMERA_2: 'C2' });
    expect(dto.slotOutcomes).toEqual({ CAMERA_1: 'OK_RECIBIDA', CAMERA_2: 'SIN_RESPUESTA' });
    expect(dto.lat).toBeNull();
  });

  test('lotes de como máximo 200', () => {
    const list = Array.from({ length: 450 }, (_, i) => i);
    expect(chunk(list, 200).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunk([], 200)).toEqual([]);
  });
});

describe('capturas (40)', () => {
  test('metadatos: lateral de la pasada, usuario de la cámara, md5 en minúsculas y motivos aceptados', () => {
    const r = buildCaptureMetadata({
      capture,
      quality,
      pass,
      session,
      retake: null,
      devices: [device('CAMERA_1', 'U-C1')],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.lateralCode).toBe('LATERAL_B');
    expect(r.meta.cameraUserId).toBe('U-C1');
    expect(r.meta.operatorUserId).toBe('U-OP');
    expect(r.meta.md5).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(r.meta.quality.status).toBe('REPETIR_NITIDEZ');
    expect(r.meta.quality.reasons).toEqual(['NITIDEZ_BAJA']); // CAMARA_EN_MOVIMIENTO es solo local; sin duplicados
    expect(r.meta.quality.metrics?.analyzedRegions).toBe(4);
    expect(r.meta.retakeContext).toBeNull();
    expect(r.meta.replacesCaptureId).toBeNull();
  });

  test('repetición: contexto vigente al pedirla (RN-07) y foto reemplazada', () => {
    const retake: RetakeRequest = {
      captureId: 'C1',
      sequenceId: 'Q1',
      passId: 'P1',
      cameraRole: 'CAMERA_1',
      replacesCaptureId: 'C0',
      requestedAt: '2026-10-05T10:05:00.000Z',
      segmentId: 'SEG3',
      markerId: 'M3',
      gps: { lat: -14.2, lon: -75.8, accuracyM: 7, timestamp: T },
      gpsAgeMs: 900,
    };
    const r = buildCaptureMetadata({ capture, quality, pass, session, retake, devices: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.replacesCaptureId).toBe('C0');
    expect(r.meta.retakeContext).toEqual({
      requestedAt: '2026-10-05T10:05:00.000Z',
      segmentId: 'SEG3',
      markerId: 'M3',
      lat: -14.2,
      lon: -75.8,
      gpsAccuracyM: 7,
      gpsTimestamp: T,
    });
    // Sin celular registrado y sin usuario en la fila: se usa el operador (el servidor exige un usuario existente).
    expect(r.meta.cameraUserId).toBe('U-OP');
  });

  test('datos que el servidor exige: sin md5 o sin tamaño no se envía; sin calidad evaluada tampoco', () => {
    const base = { quality, pass, session, retake: null, devices: [] };
    expect(buildCaptureMetadata({ ...base, capture: { ...capture, md5: null } })).toEqual({ ok: false, code: 'METADATOS_INCOMPLETOS' });
    expect(buildCaptureMetadata({ ...base, capture: { ...capture, md5: 'xyz' } })).toEqual({ ok: false, code: 'METADATOS_INCOMPLETOS' });
    expect(buildCaptureMetadata({ ...base, capture: { ...capture, sizeBytes: 0 } })).toEqual({ ok: false, code: 'METADATOS_INCOMPLETOS' });
    expect(buildCaptureMetadata({ ...base, capture: { ...capture, width: null } })).toEqual({ ok: false, code: 'METADATOS_INCOMPLETOS' });
    expect(
      buildCaptureMetadata({ ...base, quality: null, capture: { ...capture, qualityStatus: 'CAPTURED' } }),
    ).toEqual({ ok: false, code: 'CALIDAD_SIN_EVALUAR' });
  });

  test('motivos de calidad: solo los que acepta el servidor', () => {
    expect(serverQualityReasons(['CAMARA_EN_MOVIMIENTO'])).toEqual([]);
    expect(serverQualityReasons(['EXPOSICION_OSCURA', 'TIEMPO_AGOTADO'])).toEqual(['EXPOSICION_OSCURA', 'TIEMPO_AGOTADO']);
  });
});

describe('incidencias (50)', () => {
  test('una referencia que el servidor no conoce viaja como null (si no, Django rechaza todo el lote)', () => {
    const incidents: Incident[] = [
      {
        incidentId: 'I1',
        sessionId: 'S1',
        passId: 'P1',
        sequenceId: 'Q1',
        captureId: 'C1',
        deviceId: 'D-CAMERA_1',
        type: 'CALIDAD',
        severity: 'INFO',
        detail: 'x'.repeat(5000),
        occurredAt: T,
        createdBy: 'SISTEMA',
      },
      {
        incidentId: 'I2',
        sessionId: 'S1',
        passId: 'P-PRUEBA',
        sequenceId: 'Q-PRUEBA',
        captureId: null,
        deviceId: null,
        type: 'OPERADOR',
        severity: 'AVISO',
        detail: 'Lluvia',
        occurredAt: T,
        createdBy: 'OPERADOR',
      },
    ];
    const dtos = buildIncidentDtos(incidents, new Set(['P1']), new Set(['Q1']));
    expect(dtos[0]).toMatchObject({ passId: 'P1', sequenceId: 'Q1', captureId: 'C1' });
    expect(dtos[0].detail.length).toBe(4000);
    expect(dtos[1]).toMatchObject({ passId: null, sequenceId: null, detail: 'Lluvia', createdBy: 'OPERADOR' });
    expect(JSON.stringify(dtos)).not.toContain('sessionId');
  });
});
