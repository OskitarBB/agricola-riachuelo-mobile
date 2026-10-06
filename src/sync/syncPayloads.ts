// src/sync/syncPayloads.ts — Conversión de los datos locales del CONTROLADOR al contrato /api/v1 (funciones puras).
//
// QUÉ HACE: arma los cuerpos de cada petición de la sincronización (maestro v2.0 §15.3 y §15.5) a partir de los tipos
// del dominio, SIN tocar SQLite ni la red (se prueba en __tests__/syncPayloads.test.ts). Aplica las reglas del
// servidor real (api/v1/serializers.py de la plataforma) para que un dato local nunca bloquee la cola:
//  - sesión: status CLOSING (elemento 10) o CLOSED con endedAt (elemento 60); versiones recortadas al largo del servidor;
//  - captura: lateral = el de la PASADA (Django lo valida), usuario de la cámara, operador de la sesión, contexto de la
//    repetición (retake_requests, RN-07) y motivos de calidad que el servidor acepta (CAMARA_EN_MOVIMIENTO es local);
//  - incidencias: una referencia a una pasada o secuencia que el servidor no conoce (p. ej. la prueba corta) se envía
//    como null, porque Django rechaza TODO el lote con 404 si una referencia no existe;
//  - lotes de como máximo sync.batchSize (200) elementos.

import type {
  CaptureUploadMetadata,
  IncidentDto,
  PassUpsertRequest,
  SequenceDto,
  ServerQualityReason,
  SessionUpsertRequest,
} from '../api/dto';
import type {
  Capture,
  CaptureSequence,
  Incident,
  MarkerChange,
  MonitoringPass,
  MonitoringSession,
  QualityMetrics,
  QualityReason,
  QualityResult,
  RetakeRequest,
  SessionDevice,
} from '../domain/types';

/** Largos máximos de la plataforma (serializers.py / modelos). */
export const SERVER_LIMITS = {
  appVersion: 40,
  configVersion: 40,
  qualityProfileVersion: 20,
  deviceModel: 200,
  osVersion: 80,
  cameraAppVersion: 80,
  incidentDetail: 4000,
} as const;

const SERVER_REASONS: readonly ServerQualityReason[] = [
  'EXPOSICION_OSCURA',
  'EXPOSICION_SATURADA',
  'NITIDEZ_BAJA',
  'ARCHIVO_INVALIDO',
  'FALLO_CAMARA',
  'TIEMPO_AGOTADO',
];

const MD5_RE = /^[0-9a-f]{32}$/i;

const cut = (s: string | null | undefined, max: number): string => (s ?? '').slice(0, max);

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** Motivos de calidad que acepta el servidor (sin duplicados, en el orden original). */
export function serverQualityReasons(reasons: readonly QualityReason[]): ServerQualityReason[] {
  const out: ServerQualityReason[] = [];
  for (const r of reasons) {
    if ((SERVER_REASONS as readonly string[]).includes(r) && !out.includes(r as ServerQualityReason)) {
      out.push(r as ServerQualityReason);
    }
  }
  return out;
}

/** Métricas válidas para el servidor (todas numéricas y finitas; duración ≥ 0) o null. */
export function serverQualityMetrics(m: QualityMetrics | null): QualityMetrics | null {
  if (!m) return null;
  const vals = [m.luminanceMean, m.darkRatio, m.brightRatio, m.laplacianVariance, m.analyzedRegions, m.durationMs];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return {
    luminanceMean: m.luminanceMean,
    darkRatio: m.darkRatio,
    brightRatio: m.brightRatio,
    laplacianVariance: m.laplacianVariance,
    analyzedRegions: Math.max(0, Math.round(m.analyzedRegions)),
    durationMs: Math.max(0, m.durationMs),
  };
}

// ------------------------------------------------------------------ sesión (elementos 10 y 60)

export function buildSessionRequest(
  s: MonitoringSession,
  devices: readonly SessionDevice[],
  phase: 'CLOSING' | 'CLOSED',
): SessionUpsertRequest {
  return {
    sessionId: s.sessionId,
    operatorUserId: s.operatorUserId,
    controllerDeviceId: s.controllerDeviceId,
    status: phase,
    mode: s.mode,
    intervalMs: Math.max(0, Math.round(s.intervalMs)),
    startedAt: s.startedAt,
    endedAt: phase === 'CLOSED' ? (s.endedAt ?? s.updatedAt) : null,
    appVersion: cut(s.appVersion, SERVER_LIMITS.appVersion),
    configVersion: cut(s.configVersion, SERVER_LIMITS.configVersion),
    qualityProfileVersion: cut(s.qualityProfileVersion, SERVER_LIMITS.qualityProfileVersion),
    shortTestPassedAt: s.shortTestPassedAt,
    cameras: devices.map((d) => ({
      role: d.role,
      deviceId: d.deviceId,
      userId: d.userId,
      platform: d.platform,
      model: cut(d.model, SERVER_LIMITS.deviceModel),
      osVersion: cut(d.osVersion, SERVER_LIMITS.osVersion),
      appVersion: cut(d.appVersion, SERVER_LIMITS.cameraAppVersion),
      pairedAt: d.pairedAt,
      released: d.released,
    })),
  };
}

// ------------------------------------------------------------------ pasada (elemento 20)

export function buildPassRequest(p: MonitoringPass, changes: readonly MarkerChange[]): PassUpsertRequest {
  return {
    passId: p.passId,
    lotId: p.lotId,
    rowId: p.rowId,
    lateralCode: p.lateralCode,
    passOrder: p.passOrder,
    direction: p.direction,
    startMarkerId: p.startMarkerId,
    endMarkerId: p.endMarkerId,
    status: p.status,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    sequencesTotal: Math.max(0, p.sequencesTotal),
    sequencesComplete: Math.max(0, p.sequencesComplete),
    sequencesIncomplete: Math.max(0, p.sequencesIncomplete),
    markerChanges: changes.map((c) => ({
      markerChangeId: c.markerChangeId,
      markerId: c.markerId,
      segmentId: c.segmentId,
      changedAt: c.changedAt,
      lat: c.gps?.lat ?? null,
      lon: c.gps?.lon ?? null,
      gpsAccuracyM: c.gps?.accuracyM ?? null,
      gpsTimestamp: c.gps?.timestamp ?? null,
    })),
  };
}

// ------------------------------------------------------------------ secuencias (elemento 30)

export function buildSequenceDto(q: CaptureSequence): SequenceDto {
  return {
    sequenceId: q.sequenceId,
    passId: q.passId,
    sequenceNumber: q.sequenceNumber,
    mode: q.mode,
    status: q.status,
    segmentId: q.segmentId,
    markerId: q.markerId,
    lat: q.gps?.lat ?? null,
    lon: q.gps?.lon ?? null,
    gpsAccuracyM: q.gps?.accuracyM ?? null,
    gpsTimestamp: q.gps?.timestamp ?? null,
    issuedAt: q.issuedAt,
    completedAt: q.completedAt,
    expectedCaptureIds: { CAMERA_1: q.slots.CAMERA_1.captureId, CAMERA_2: q.slots.CAMERA_2.captureId },
    slotOutcomes: { CAMERA_1: q.slots.CAMERA_1.outcome, CAMERA_2: q.slots.CAMERA_2.outcome },
  };
}

// ------------------------------------------------------------------ incidencias (elemento 50)

export function buildIncidentDtos(
  incidents: readonly Incident[],
  knownPassIds: ReadonlySet<string>,
  knownSequenceIds: ReadonlySet<string>,
): IncidentDto[] {
  return incidents.map((i) => ({
    incidentId: i.incidentId,
    passId: i.passId && knownPassIds.has(i.passId) ? i.passId : null,
    sequenceId: i.sequenceId && knownSequenceIds.has(i.sequenceId) ? i.sequenceId : null,
    captureId: i.captureId,
    deviceId: i.deviceId,
    type: i.type,
    severity: i.severity,
    detail: cut(i.detail, SERVER_LIMITS.incidentDetail),
    occurredAt: i.occurredAt,
    createdBy: i.createdBy,
  }));
}

// ------------------------------------------------------------------ capturas (elemento 40)

export interface CaptureMetaInput {
  capture: Capture;
  quality: QualityResult | null;
  pass: MonitoringPass;
  session: MonitoringSession;
  /** Repetición que originó esta captura (retake_requests), si la hay. */
  retake: RetakeRequest | null;
  /** Celulares registrados en la sesión (para el usuario y la versión de la cámara). */
  devices: readonly SessionDevice[];
}

export type CaptureMetaResult = { ok: true; meta: CaptureUploadMetadata } | { ok: false; code: 'METADATOS_INCOMPLETOS' | 'CALIDAD_SIN_EVALUAR' };

/**
 * Metadatos de la confirmación (POST /captures/upload). Devuelve un código local si faltan datos que el servidor
 * exige (tamaño, md5, ancho y alto > 0, calidad evaluada): esas capturas no se pueden sincronizar (DEFINITIVO).
 */
export function buildCaptureMetadata(i: CaptureMetaInput): CaptureMetaResult {
  const c = i.capture;
  if (!c.md5 || !MD5_RE.test(c.md5) || !c.sizeBytes || c.sizeBytes < 1 || !c.width || c.width < 1 || !c.height || c.height < 1) {
    return { ok: false, code: 'METADATOS_INCOMPLETOS' };
  }
  const status = i.quality?.status ?? c.qualityStatus;
  if (status === 'CAPTURED') return { ok: false, code: 'CALIDAD_SIN_EVALUAR' };
  const device = i.devices.find((d) => d.deviceId === c.deviceId) ?? null;
  const cameraUserId = c.userId || device?.userId || i.session.operatorUserId;
  const retake = i.retake;
  return {
    ok: true,
    meta: {
      captureId: c.captureId,
      sequenceId: c.sequenceId,
      sessionId: c.sessionId,
      passId: i.pass.passId,
      lateralCode: i.pass.lateralCode,
      deviceId: c.deviceId,
      cameraRole: c.cameraRole,
      cameraUserId,
      operatorUserId: i.session.operatorUserId,
      capturedAt: c.capturedAt,
      width: c.width,
      height: c.height,
      sizeBytes: c.sizeBytes,
      md5: c.md5.toLowerCase(),
      quality: {
        status,
        reasons: serverQualityReasons(i.quality?.reasons ?? []),
        metrics: serverQualityMetrics(i.quality?.metrics ?? null),
        profileVersion: cut(i.quality?.profileVersion || c.qualityProfileVersion, SERVER_LIMITS.qualityProfileVersion),
      },
      replacesCaptureId: retake?.replacesCaptureId ?? c.replacesCaptureId ?? null,
      retakeContext: retake
        ? {
            requestedAt: retake.requestedAt,
            segmentId: retake.segmentId,
            markerId: retake.markerId,
            lat: retake.gps?.lat ?? null,
            lon: retake.gps?.lon ?? null,
            gpsAccuracyM: retake.gps?.accuracyM ?? null,
            gpsTimestamp: retake.gps?.timestamp ?? null,
          }
        : null,
      appVersion: cut(device?.appVersion || i.session.appVersion, SERVER_LIMITS.appVersion),
    },
  };
}
