// src/api/dto.ts — Contrato esperado con Spring Boot /api/v1 (versión 1, maestro §15.3; a acordar con backend).
//
// QUÉ HACE: tipos de petición y respuesta de cada endpoint. El cliente real (httpClient + authApi,
// bootstrapApi, syncApi) y el backend simulado (src/api/mock) implementan EXACTAMENTE estos tipos,
// así cambiar de simulado a real es solo cambiar EXPO_PUBLIC_USE_MOCK_API (sin tocar pantallas).
//
// INTEGRACIÓN FUTURA CON LA WEB / BASE DE DATOS: el backend Spring Boot guarda estos datos en PostgreSQL
// y las fotos en S3. La app NUNCA habla con PostgreSQL ni S3 directamente (regla R-18).

import type {
  AccountStatus,
  CameraRole,
  CaptureMode,
  Direction,
  FieldRow,
  IncidentType,
  ISODateString,
  LateralCode,
  Lot,
  Marker,
  PassStatus,
  Platform,
  QualityMetrics,
  QualityReason,
  QualityStatus,
  Segment,
  SequenceStatus,
  SessionStatus,
  SlotOutcome,
  UserProfile,
  UUID,
} from '../domain/types';

// ------------------------------------------------------------- errores
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_PENDING'
  | 'ACCOUNT_REJECTED'
  | 'ACCOUNT_BLOCKED'
  | 'ROLE_NOT_ALLOWED'
  | 'DEVICE_REVOKED'
  | 'PASSWORD_POLICY'
  | 'TOO_MANY_ATTEMPTS'
  | 'TOKEN_EXPIRED'
  | 'REFRESH_INVALID'
  | 'SESSION_NOT_FOUND'
  | 'PASS_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'CAPTURE_CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  fieldErrors?: { field: string; message: string }[];
  traceId?: string;
}

// ------------------------------------------------------------- autenticación
export interface DeviceInfoDto {
  deviceId: UUID;
  platform: Platform;
  model: string;
  osVersion: string;
  appVersion: string;
}
export interface RegisterRequest {
  fullName: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  password: string;
  acceptedPrivacyNotice: true;
}
export interface RegisterResponse {
  userId: UUID;
  status: Extract<AccountStatus, 'PENDIENTE_APROBACION'>;
}
export interface LoginRequest {
  email: string;
  password: string;
  device: DeviceInfoDto;
}
export interface TokenBundle {
  accessToken: string;
  accessTokenExpiresAt: ISODateString;
  refreshToken: string;
  refreshTokenExpiresAt: ISODateString;
}
export interface LoginResponse extends TokenBundle {
  user: UserProfile;
  serverTime: ISODateString;
}
export interface RefreshRequest {
  refreshToken: string;
  deviceId: UUID;
}
export type RefreshResponse = LoginResponse;
export interface LogoutRequest {
  refreshToken: string;
  deviceId: UUID;
}
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
export interface PasswordResetRequest {
  email: string;
}
export interface HealthResponse {
  status: 'UP';
  serverTime: ISODateString;
}

// ------------------------------------------------------------- bootstrap
export interface BootstrapResponse {
  catalogVersion: string;
  lots: Lot[];
  rows: FieldRow[];
  segments: Segment[];
  markers: Marker[];
  lateralCodes: LateralCode[];
  /** Perfil de calidad y parámetros publicados por el backend; si faltan, la app usa sus valores por defecto. */
  qualityProfile: { version: string; params: Record<string, number> } | null;
  serverTime: ISODateString;
}

// ------------------------------------------------------------- sincronización (idempotente por ID)
export interface SessionUpsertRequest {
  sessionId: UUID;
  operatorUserId: UUID;
  controllerDeviceId: UUID;
  /** SYNCED es solo local: nunca se envía. El cierre se envía con CLOSED y endedAt. */
  status: Exclude<SessionStatus, 'SYNCED'>;
  mode: CaptureMode;
  intervalMs: number;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
  appVersion: string;
  configVersion: string;
  qualityProfileVersion: string;
  shortTestPassedAt: ISODateString | null;
  /** Todos los celulares que ocuparon un rol en la sesión; released = true si el rol se liberó para reemplazarlo. */
  cameras: {
    role: CameraRole;
    deviceId: UUID;
    userId: UUID;
    platform: Platform;
    model: string;
    osVersion: string;
    appVersion: string;
    pairedAt: ISODateString;
    released: boolean;
  }[];
}

export interface PassUpsertRequest {
  passId: UUID;
  lotId: string;
  rowId: string;
  lateralCode: LateralCode;
  passOrder: number;
  direction: Direction;
  startMarkerId: string | null;
  endMarkerId: string | null;
  status: PassStatus;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
  sequencesTotal: number;
  sequencesComplete: number;
  sequencesIncomplete: number;
  markerChanges: {
    markerChangeId: UUID;
    markerId: string | null;
    segmentId: string | null;
    changedAt: ISODateString;
    lat: number | null;
    lon: number | null;
    gpsAccuracyM: number | null;
    gpsTimestamp: ISODateString | null;
  }[];
}

export interface SequenceDto {
  sequenceId: UUID;
  passId: UUID;
  sequenceNumber: number;
  mode: CaptureMode;
  status: SequenceStatus;
  segmentId: string | null;
  markerId: string | null;
  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;
  gpsTimestamp: ISODateString | null;
  issuedAt: ISODateString;
  completedAt: ISODateString | null;
  expectedCaptureIds: Record<CameraRole, UUID>;
  /** Resultado por cámara: permite saber qué fotos faltan aunque no se suban. */
  slotOutcomes: Record<CameraRole, SlotOutcome>;
}
export interface SequenceBatchRequest {
  sessionId: UUID;
  sequences: SequenceDto[];
}

/** Parte "metadata" (JSON en texto) del multipart de POST /api/v1/captures/upload; la parte "file" es el JPEG. */
export interface CaptureUploadMetadata {
  captureId: UUID;
  sequenceId: UUID;
  sessionId: UUID;
  passId: UUID;
  lateralCode: LateralCode;
  deviceId: UUID;
  cameraRole: CameraRole;
  cameraUserId: UUID;
  operatorUserId: UUID;
  capturedAt: ISODateString;
  width: number;
  height: number;
  sizeBytes: number;
  md5: string;
  quality: { status: QualityStatus; reasons: QualityReason[]; metrics: QualityMetrics | null; profileVersion: string };
  replacesCaptureId: UUID | null;
  /** Solo en repeticiones: contexto vigente cuando se pidió repetir (tabla retake_requests). */
  retakeContext: {
    requestedAt: ISODateString;
    segmentId: string | null;
    markerId: string | null;
    lat: number | null;
    lon: number | null;
    gpsAccuracyM: number | null;
    gpsTimestamp: ISODateString | null;
  } | null;
  appVersion: string;
}
export interface CaptureUploadResponse {
  captureId: UUID;
  status: 'SINCRONIZADO';
  duplicate: boolean;
}

export interface IncidentDto {
  incidentId: UUID;
  passId: UUID | null;
  sequenceId: UUID | null;
  captureId: UUID | null;
  deviceId: UUID | null;
  type: IncidentType;
  severity: 'INFO' | 'AVISO' | 'ERROR';
  detail: string;
  occurredAt: ISODateString;
  createdBy: 'SISTEMA' | 'OPERADOR';
}
export interface IncidentBatchRequest {
  sessionId: UUID;
  incidents: IncidentDto[];
}
export interface BatchResponse {
  accepted: number;
  duplicates: number;
}
