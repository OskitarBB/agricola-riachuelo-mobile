// src/protocol/messages.ts — Protocolo local v1 (WebSocket, JSON). Contrato del maestro §14.5.
//
// QUÉ HACE: define el sobre (Envelope) y el contenido (payload) de cada mensaje que viaja entre el
// controlador y las cámaras por el Wi-Fi del campo. Lo usan por igual la red real (Development Build/APK)
// y el simulador de Expo Go, por eso el flujo se prueba igual en ambos.
// Cambio CFG-2: CaptureMode sin 'MIXTO' (ver src/domain/types.ts).

import type {
  CameraRole,
  CaptureMode,
  Direction,
  ISODateString,
  LateralCode,
  Platform,
  QualityMetrics,
  QualityReason,
  QualityStatus,
  UserRole,
  UUID,
} from '../domain/types';

export const PROTOCOL_VERSION = 1 as const;

/** Contenido del código QR que muestra el controlador. */
export interface PairingQrPayload {
  type: 'RIACHUELO_PAIR';
  protocolVersion: typeof PROTOCOL_VERSION;
  host: string; // IP del controlador en la red local
  controlPort: number;
  filePort: number;
  sessionId: UUID;
  pairingToken: string; // base64url de 16 bytes aleatorios
  controllerAppVersion: string;
}

export interface Envelope<T extends MessageType = MessageType> {
  v: typeof PROTOCOL_VERSION;
  type: T;
  messageId: UUID; // único por mensaje; un reenvío conserva el mismo messageId
  sessionId: UUID;
  deviceId: UUID; // emisor
  sentAt: ISODateString; // reloj del emisor
  payload: PayloadMap[T];
}

export type PairRejectReason =
  'INVALID_TOKEN' | 'SESSION_CLOSED' | 'ROLE_TAKEN' | 'PROTOCOL_MISMATCH' | 'APP_VERSION_MISMATCH' | 'USER_NOT_ALLOWED';

export type ProtocolErrorCode =
  | 'UNKNOWN_SESSION'
  | 'UNKNOWN_DEVICE'
  | 'NOT_PAIRED'
  | 'INVALID_MESSAGE'
  | 'COMMAND_EXPIRED'
  | 'WRONG_PASS'
  | 'BUSY'
  | 'INTERNAL';

/** Configuración de captura y calidad que el controlador envía a las cámaras en PAIRED (D-21). */
export interface CaptureContextConfig {
  configVersion: string;
  qualityProfileVersion: string;
  jpegQuality: number;
  shutterSound: boolean;
  quality: {
    timeoutMs: number;
    exposure: {
      analysisWidth: number;
      darkLevel: number;
      brightLevel: number;
      minMean: number;
      maxMean: number;
      maxDarkRatio: number;
      maxBrightRatio: number;
    };
    sharpness: { regionSize: number; regionCount: 1 | 2 | 3; minLaplacianVariance: number };
  };
  heartbeatIntervalMs: number;
  transferIncludeRejected: boolean;
}

export interface PayloadMap {
  /** Cámara → controlador, primer mensaje tras conectar el WebSocket. */
  PAIR_REQUEST: {
    pairingToken: string;
    requestedRole: CameraRole;
    userId: UUID;
    userName: string;
    /** Roles y modo de acceso del usuario con sesión en la cámara (datos de su último login; RN-02). */
    userRoles: UserRole[];
    authMode: 'ONLINE' | 'OFFLINE';
    platform: Platform;
    model: string;
    osVersion: string;
    appVersion: string;
    protocolVersion: typeof PROTOCOL_VERSION;
    batteryLevel: number | null;
    freeSpaceBytes: number | null;
    pendingTransfers: number;
  };
  /** Controlador → cámara. */
  PAIRED: {
    role: CameraRole;
    controllerDeviceId: UUID;
    serverTime: ISODateString;
    config: CaptureContextConfig;
    /** Sesiones ya SINCRONIZADAS en el backend: la cámara puede liberar esas fotos (retención). */
    syncedSessionIds: UUID[];
  };
  PAIR_REJECTED: { reason: PairRejectReason; detail: string | null };
  /** Controlador → cámaras: contexto vigente (se reenvía al cambiar pasada o marcador). */
  SESSION_CONTEXT: {
    passId: UUID | null;
    lateralCode: LateralCode | null;
    lotId: string | null;
    rowId: string | null;
    segmentId: string | null;
    markerId: string | null;
    direction: Direction | null;
    mode: CaptureMode;
    intervalMs: number;
  };
  START_PASS: { passId: UUID; lateralCode: LateralCode; passOrder: number };
  END_PASS: { passId: UUID; status: 'COMPLETED' | 'INCOMPLETE' };
  CAPTURE_COMMAND: {
    /** PRUEBA_CORTA: captura de prueba sin pasada (passId y lateralCode nulos); no es evidencia ni se sincroniza. */
    purpose: 'SECUENCIA' | 'PRUEBA_CORTA';
    sequenceId: UUID; // en PRUEBA_CORTA es un identificador de la prueba (no existe en capture_sequences)
    sequenceNumber: number; // 0 en PRUEBA_CORTA
    captureId: UUID; // captureId esperado para ESTA cámara
    passId: UUID | null;
    lateralCode: LateralCode | null;
    mode: CaptureMode;
    issuedAt: ISODateString;
    expiresAt: ISODateString;
    replacesCaptureId: UUID | null; // presente en repeticiones
  };
  CAPTURE_OK: {
    sequenceId: UUID;
    captureId: UUID;
    capturedAt: ISODateString;
    width: number;
    height: number;
    sizeBytes: number;
    md5: string;
    qualityStatus: Extract<QualityStatus, 'UTILIZABLE' | 'PENDIENTE_REVISION_TECNICA'>;
    reasons: QualityReason[]; // vacío si UTILIZABLE; ['TIEMPO_AGOTADO'] si PENDIENTE_REVISION_TECNICA
    metrics: QualityMetrics | null;
    profileVersion: string;
    captureDurationMs: number;
  };
  QUALITY_ERROR: {
    sequenceId: UUID;
    captureId: UUID;
    capturedAt: ISODateString | null; // null solo si fileAvailable = false
    qualityStatus: Extract<QualityStatus, 'REPETIR_NITIDEZ' | 'REPETIR_EXPOSICION' | 'ERROR_CAMARA'>;
    reasons: QualityReason[];
    metrics: QualityMetrics | null;
    profileVersion: string;
    fileAvailable: boolean; // false en ERROR_CAMARA sin archivo (y en CAMARA_EN_MOVIMIENTO)
  };
  PAUSE: { reason: 'OPERADOR' | 'ENLACE_PERDIDO' | 'BATERIA' | 'ESPACIO' | 'SEGUNDO_PLANO' | 'OTRO' };
  RESUME: Record<string, never>;
  /** Ambos sentidos. El controlador inicia; la cámara responde con echoSentAt. */
  HEARTBEAT: {
    echoSentAt: ISODateString | null;
    role: CameraRole | 'CONTROLADOR';
    batteryLevel: number | null;
    freeSpaceBytes: number | null;
    pendingTransfers: number;
    lastSequenceId: UUID | null;
    appState: 'active' | 'background' | 'inactive';
  };
  ACK: {
    ackType: 'MESSAGE' | 'FILE';
    refMessageId: UUID | null;
    captureId: UUID | null;
    result: 'RECEIVED' | 'ALREADY_RECEIVED' | 'REJECTED';
    reason: string | null;
  };
  RESYNC_REQUEST: { passId: UUID | null; lastSequenceIdKnown: UUID | null };
  /** Solo capturas de evidencia de la sesión (sin las de prueba corta) que aún no están RECIBIDA_CONTROLADOR. */
  RESYNC_STATE: {
    lastSequenceIdSeen: UUID | null;
    page: number; // 1..totalPages
    totalPages: number; // 1 aunque no haya capturas pendientes
    captures: {
      captureId: UUID;
      sequenceId: UUID;
      qualityStatus: QualityStatus;
      localTransferStatus: 'PENDIENTE_LOCAL' | 'TRANSFIRIENDO_LOCAL' | 'RECIBIDA_CONTROLADOR' | 'ERROR_LOCAL';
    }[];
  };
  SESSION_CLOSED: { sessionId: UUID };
  ERROR: { code: ProtocolErrorCode; detail: string | null; refMessageId: UUID | null };
}

export type MessageType = keyof PayloadMap;

export const MESSAGE_TYPES: readonly MessageType[] = [
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
];

/** Mensajes que exigen ACK MESSAGE (maestro §14.3). */
export const ACK_REQUIRED: readonly MessageType[] = [
  'PAIRED',
  'SESSION_CONTEXT',
  'START_PASS',
  'END_PASS',
  'PAUSE',
  'RESUME',
  'SESSION_CLOSED',
];

/** Validación mínima de forma del sobre (la validación completa por tipo se hace con esquemas zod). */
export function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === PROTOCOL_VERSION &&
    typeof v.type === 'string' &&
    (MESSAGE_TYPES as readonly string[]).includes(v.type) &&
    typeof v.messageId === 'string' &&
    typeof v.sessionId === 'string' &&
    typeof v.deviceId === 'string' &&
    typeof v.sentAt === 'string' &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}

/** Metadatos que acompañan a cada foto en la transferencia local (cabecera X-Capture-Meta, JSON en base64url). */
export interface LocalCaptureMeta {
  captureId: UUID;
  sequenceId: UUID;
  sessionId: UUID;
  passId: UUID | null; // null solo si isTest
  lateralCode: LateralCode | null; // null solo si isTest
  isTest: boolean;
  deviceId: UUID;
  cameraRole: CameraRole;
  userId: UUID;
  capturedAt: ISODateString;
  width: number;
  height: number;
  sizeBytes: number;
  md5: string;
  qualityStatus: QualityStatus;
  qualityReasons: QualityReason[];
  qualityMetrics: QualityMetrics | null;
  profileVersion: string;
  replacesCaptureId: UUID | null;
}

export interface LocalCaptureResponse {
  result: 'RECEIVED' | 'ALREADY_RECEIVED' | 'REJECTED';
  reason:
    | null
    | 'MD5_MISMATCH'
    | 'SIZE_MISMATCH'
    | 'UNKNOWN_SESSION'
    | 'UNKNOWN_SEQUENCE'
    | 'WRONG_DEVICE'
    | 'CAPTURE_CONFLICT'
    | 'NO_SPACE'
    | 'INVALID_META'
    | 'LENGTH_REQUIRED'
    | 'PAYLOAD_TOO_LARGE'
    | 'NOT_FOUND'
    | 'INTERNAL';
}
