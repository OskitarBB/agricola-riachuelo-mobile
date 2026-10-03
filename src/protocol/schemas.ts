// src/protocol/schemas.ts — Esquemas zod de cada mensaje del protocolo local (maestro §14.3: todo mensaje
// se valida con zod ANTES de procesarse). También valida el QR y la cabecera X-Capture-Meta.
//
// QUÉ HACE: si un mensaje no cumple su esquema, envelope.ts lo rechaza con ERROR INVALID_MESSAGE
// (error de programación que se registra en event_log y no se reenvía).

import { z } from 'zod';

import type { MessageType } from './messages';

const uuid = z.string().min(8);
const iso = z.string().min(10);
const cameraRole = z.enum(['CAMERA_1', 'CAMERA_2']);
const lateral = z.enum(['LATERAL_A', 'LATERAL_B']);
const captureMode = z.enum(['MANUAL', 'AUTOMATICO']);
const qualityStatus = z.enum([
  'CAPTURED',
  'UTILIZABLE',
  'REPETIR_NITIDEZ',
  'REPETIR_EXPOSICION',
  'ERROR_CAMARA',
  'PENDIENTE_REVISION_TECNICA',
]);
const qualityReason = z.enum([
  'EXPOSICION_OSCURA',
  'EXPOSICION_SATURADA',
  'NITIDEZ_BAJA',
  'ARCHIVO_INVALIDO',
  'FALLO_CAMARA',
  'TIEMPO_AGOTADO',
  'CAMARA_EN_MOVIMIENTO',
]);
const metrics = z
  .object({
    luminanceMean: z.number(),
    darkRatio: z.number(),
    brightRatio: z.number(),
    laplacianVariance: z.number(),
    analyzedRegions: z.number(),
    durationMs: z.number(),
  })
  .nullable();
const transferStatus = z.enum(['PENDIENTE_LOCAL', 'TRANSFIRIENDO_LOCAL', 'RECIBIDA_CONTROLADOR', 'ERROR_LOCAL']);

export const captureContextConfigSchema = z.object({
  configVersion: z.string(),
  qualityProfileVersion: z.string(),
  jpegQuality: z.number().min(0).max(1),
  shutterSound: z.boolean(),
  quality: z.object({
    timeoutMs: z.number().positive(),
    exposure: z.object({
      analysisWidth: z.number().positive(),
      darkLevel: z.number(),
      brightLevel: z.number(),
      minMean: z.number(),
      maxMean: z.number(),
      maxDarkRatio: z.number(),
      maxBrightRatio: z.number(),
    }),
    sharpness: z.object({
      regionSize: z.number().positive(),
      regionCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      minLaplacianVariance: z.number(),
    }),
  }),
  heartbeatIntervalMs: z.number().positive(),
  transferIncludeRejected: z.boolean(),
});

export const PAYLOAD_SCHEMAS: Record<MessageType, z.ZodType> = {
  PAIR_REQUEST: z.object({
    pairingToken: z.string().min(1),
    requestedRole: cameraRole,
    userId: uuid,
    userName: z.string(),
    userRoles: z.array(z.enum(['ADMINISTRADOR', 'OPERADOR_CAMPO', 'ESPECIALISTA_FITOSANITARIO', 'SUPERVISOR'])),
    authMode: z.enum(['ONLINE', 'OFFLINE']),
    platform: z.enum(['android', 'ios']),
    model: z.string(),
    osVersion: z.string(),
    appVersion: z.string(),
    protocolVersion: z.number(),
    batteryLevel: z.number().nullable(),
    freeSpaceBytes: z.number().nullable(),
    pendingTransfers: z.number().int().min(0),
  }),
  PAIRED: z.object({
    role: cameraRole,
    controllerDeviceId: uuid,
    serverTime: iso,
    config: captureContextConfigSchema,
    syncedSessionIds: z.array(uuid),
  }),
  PAIR_REJECTED: z.object({
    reason: z.enum([
      'INVALID_TOKEN',
      'SESSION_CLOSED',
      'ROLE_TAKEN',
      'PROTOCOL_MISMATCH',
      'APP_VERSION_MISMATCH',
      'USER_NOT_ALLOWED',
    ]),
    detail: z.string().nullable(),
  }),
  SESSION_CONTEXT: z.object({
    passId: uuid.nullable(),
    lateralCode: lateral.nullable(),
    lotId: z.string().nullable(),
    rowId: z.string().nullable(),
    segmentId: z.string().nullable(),
    markerId: z.string().nullable(),
    direction: z.enum(['ASCENDENTE', 'DESCENDENTE']).nullable(),
    mode: captureMode,
    intervalMs: z.number().positive(),
  }),
  START_PASS: z.object({ passId: uuid, lateralCode: lateral, passOrder: z.number().int().positive() }),
  END_PASS: z.object({ passId: uuid, status: z.enum(['COMPLETED', 'INCOMPLETE']) }),
  CAPTURE_COMMAND: z.object({
    purpose: z.enum(['SECUENCIA', 'PRUEBA_CORTA']),
    sequenceId: uuid,
    sequenceNumber: z.number().int().min(0),
    captureId: uuid,
    passId: uuid.nullable(),
    lateralCode: lateral.nullable(),
    mode: captureMode,
    issuedAt: iso,
    expiresAt: iso,
    replacesCaptureId: uuid.nullable(),
  }),
  CAPTURE_OK: z.object({
    sequenceId: uuid,
    captureId: uuid,
    capturedAt: iso,
    width: z.number(),
    height: z.number(),
    sizeBytes: z.number(),
    md5: z.string(),
    qualityStatus: z.enum(['UTILIZABLE', 'PENDIENTE_REVISION_TECNICA']),
    reasons: z.array(qualityReason),
    metrics,
    profileVersion: z.string(),
    captureDurationMs: z.number(),
  }),
  QUALITY_ERROR: z.object({
    sequenceId: uuid,
    captureId: uuid,
    capturedAt: iso.nullable(),
    qualityStatus: z.enum(['REPETIR_NITIDEZ', 'REPETIR_EXPOSICION', 'ERROR_CAMARA']),
    reasons: z.array(qualityReason),
    metrics,
    profileVersion: z.string(),
    fileAvailable: z.boolean(),
  }),
  PAUSE: z.object({ reason: z.enum(['OPERADOR', 'ENLACE_PERDIDO', 'BATERIA', 'ESPACIO', 'SEGUNDO_PLANO', 'OTRO']) }),
  RESUME: z.object({}).strict(),
  HEARTBEAT: z.object({
    echoSentAt: iso.nullable(),
    role: z.enum(['CAMERA_1', 'CAMERA_2', 'CONTROLADOR']),
    batteryLevel: z.number().nullable(),
    freeSpaceBytes: z.number().nullable(),
    pendingTransfers: z.number().int().min(0),
    lastSequenceId: uuid.nullable(),
    appState: z.enum(['active', 'background', 'inactive']),
  }),
  ACK: z.object({
    ackType: z.enum(['MESSAGE', 'FILE']),
    refMessageId: uuid.nullable(),
    captureId: uuid.nullable(),
    result: z.enum(['RECEIVED', 'ALREADY_RECEIVED', 'REJECTED']),
    reason: z.string().nullable(),
  }),
  RESYNC_REQUEST: z.object({ passId: uuid.nullable(), lastSequenceIdKnown: uuid.nullable() }),
  RESYNC_STATE: z.object({
    lastSequenceIdSeen: uuid.nullable(),
    page: z.number().int().positive(),
    totalPages: z.number().int().positive(),
    captures: z.array(z.object({ captureId: uuid, sequenceId: uuid, qualityStatus, localTransferStatus: transferStatus })),
  }),
  SESSION_CLOSED: z.object({ sessionId: uuid }),
  ERROR: z.object({
    code: z.enum([
      'UNKNOWN_SESSION',
      'UNKNOWN_DEVICE',
      'NOT_PAIRED',
      'INVALID_MESSAGE',
      'COMMAND_EXPIRED',
      'WRONG_PASS',
      'BUSY',
      'INTERNAL',
    ]),
    detail: z.string().nullable(),
    refMessageId: uuid.nullable(),
  }),
};

export const envelopeSchema = z.object({
  v: z.literal(1),
  type: z.enum([
    'PAIR_REQUEST',
    'PAIRED',
    'PAIR_REJECTED',
    'SESSION_CONTEXT',
    'START_PASS',
    'END_PASS',
    'CAPTURE_COMMAND',
    'CAPTURE_OK',
    'QUALITY_ERROR',
    'PAUSE',
    'RESUME',
    'HEARTBEAT',
    'ACK',
    'RESYNC_REQUEST',
    'RESYNC_STATE',
    'SESSION_CLOSED',
    'ERROR',
  ]),
  messageId: uuid,
  sessionId: uuid,
  deviceId: uuid,
  sentAt: iso,
  payload: z.unknown(),
});

/** Contenido del QR de emparejamiento (maestro §14.2). */
export const pairingQrSchema = z.object({
  type: z.literal('RIACHUELO_PAIR'),
  protocolVersion: z.literal(1),
  host: z.string().min(3),
  controlPort: z.number().int().positive(),
  filePort: z.number().int().positive(),
  sessionId: uuid,
  pairingToken: z.string().min(8),
  controllerAppVersion: z.string(),
});

/** Cabecera X-Capture-Meta de la transferencia local (maestro §14.8). */
export const localCaptureMetaSchema = z.object({
  captureId: uuid,
  sequenceId: uuid,
  sessionId: uuid,
  passId: uuid.nullable(),
  lateralCode: lateral.nullable(),
  isTest: z.boolean(),
  deviceId: uuid,
  cameraRole: cameraRole,
  userId: uuid,
  capturedAt: iso,
  width: z.number(),
  height: z.number(),
  sizeBytes: z.number().int().positive(),
  md5: z.string().min(16),
  qualityStatus,
  qualityReasons: z.array(qualityReason),
  qualityMetrics: metrics,
  profileVersion: z.string(),
  replacesCaptureId: uuid.nullable(),
});
