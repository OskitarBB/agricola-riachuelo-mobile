// src/api/dto.ts — Contrato con la plataforma Django /api/v1 (maestro v2.0 §15.3 y docs/INTEGRACION_APP.md).
//
// QUÉ HACE: tipos de petición y respuesta de cada endpoint. El cliente real (httpClient + authApi,
// bootstrapApi, syncApi, uploadApi) y el backend simulado (src/api/mock) implementan EXACTAMENTE estos tipos,
// así cambiar de simulado a real es solo cambiar EXPO_PUBLIC_USE_MOCK_API (sin tocar pantallas).
//
// Arquitectura v3.0 (D-24 a D-33): Django guarda los datos en Supabase y las fotos van a Cloudinary con un ticket
// firmado por Django. La app NUNCA habla con Supabase ni conoce secretos de Cloudinary (R-18, R-21).
// JSON en camelCase y fechas ISO-8601 UTC. Agregar campos al contrato sí; quitar o renombrar no (celulares en campo).

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
  | 'UPLOAD_SIGNATURE_INVALID' // v2.0: la firma de la respuesta de Cloudinary no es válida
  | 'UPLOAD_NOT_FOUND' // v2.0: Django no encuentra en Cloudinary el recurso informado
  | 'UPLOAD_MISMATCH' // v2.0: el recurso de Cloudinary no coincide con la captura (bytes o public_id)
  | 'NOT_FOUND' // supuesto del servidor (W-04): GET /captures/{id} inexistente
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
/** 201 la primera vez, 200 en un reenvío. */
export interface SessionUpsertResponse {
  sessionId: UUID;
  status: Exclude<SessionStatus, 'SYNCED'>;
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
export interface PassUpsertResponse {
  passId: UUID;
  status: PassStatus;
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

/** Motivos de calidad que acepta el servidor (QUALITY_REASONS de api/v1/serializers.py). */
export type ServerQualityReason = Exclude<QualityReason, 'CAMARA_EN_MOVIMIENTO'>;

/**
 * Metadatos de una captura. Mismos campos que en la v1.0 (parte "metadata" del multipart); desde la v2.0
 * viajan en el campo `metadata` de CaptureConfirmRequest (POST /api/v1/captures/upload, JSON).
 */
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
  quality: {
    status: Exclude<QualityStatus, 'CAPTURED'>;
    reasons: ServerQualityReason[];
    metrics: QualityMetrics | null;
    profileVersion: string;
  };
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

// ------------------------------------------------------------- subida directa a Cloudinary (v2.0, sección 15.7)
/** Cuerpo de POST /api/v1/captures/{captureId}/upload-ticket. */
export interface UploadTicketRequest {
  captureId: UUID;
  sessionId: UUID;
  passId: UUID;
  sequenceId: UUID;
  sizeBytes: number;
  md5: string;
  mimeType: 'image/jpeg';
}
/** Datos para subir UNA foto a Cloudinary. La app envía `fields` tal cual, como parámetros del multipart. */
export interface UploadTicket {
  /** https://api.cloudinary.com/v1_1/<cloud_name>/image/upload (en dev: el Cloudinary simulado de la laptop). */
  url: string;
  /** api_key, timestamp, signature, public_id, type, overwrite (y lo que Django firme). La app no los interpreta. */
  fields: Record<string, string>;
  /** El mismo public_id que va en `fields`; la app lo usa para comprobar la respuesta. */
  publicId: string;
  /** timestamp firmado + 1 hora (vigencia de la firma en Cloudinary). */
  expiresAt: ISODateString;
  /** Límite de tamaño aceptado (plan de Cloudinary). */
  maxBytes: number;
}
export interface UploadTicketResponse {
  captureId: UUID;
  /** true: Django ya tiene esta captura confirmada con el mismo md5 y tamaño; no se sube ni se confirma. */
  alreadyConfirmed: boolean;
  /** null solo cuando alreadyConfirmed = true. */
  upload: UploadTicket | null;
  /** Hora del servidor al emitir el ticket: la vigencia se mide contra ella, no contra el reloj del celular. */
  serverTime: ISODateString;
}
/** Lo que la app guarda de la respuesta de Cloudinary (tabla remote_uploads) y reenvía a Django. */
export interface CloudinaryUploadResult {
  publicId: string;
  version: number;
  /** Firma de la respuesta (public_id + version) calculada por Cloudinary; Django la verifica. */
  signature: string;
  bytes: number;
  format: string | null;
  width: number | null;
  height: number | null;
  etag: string | null;
  /** true si el public_id ya existía (overwrite = false) y Cloudinary devolvió el recurso existente. */
  existing: boolean;
}
/** Cuerpo de POST /api/v1/captures/upload desde la v2.0 (JSON). */
export interface CaptureConfirmRequest {
  metadata: CaptureUploadMetadata;
  cloudinary: Omit<CloudinaryUploadResult, 'existing'>;
}
/** GET /captures/{captureId} (diagnóstico). Nunca incluye URL de la foto ni resultados de la IA (§28.10). */
export interface CaptureStatusResponse {
  captureId: UUID;
  status: 'SINCRONIZADO';
  sessionId: UUID;
  passId: UUID;
  sequenceId: UUID;
  sizeBytes: number;
  md5: string;
  confirmedAt: ISODateString;
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

// ------------------------------------------------------------- «Ubicar plaga» (plataforma v1.3, ADR 0009)
// GET /mobile/pest-reports?days=N → PestReportsResponse. Los tipos viven en src/domain/pests.ts (los usa la lógica
// pura de distancia y orden); aquí se re-exportan para que el contrato completo se lea en un solo archivo.
export type { FarmLayers, FarmLot, FarmPoint, FarmRow, PestReport, PestReportsResponse } from '../domain/pests';
