// src/domain/types.ts — Contrato de tipos del dominio (versión 1 + ajustes de interfaz CFG-2).
//
// QUÉ HACE: define los tipos que comparten TODAS las capas (pantallas, servicios, protocolo, base de datos y API).
// Es TypeScript puro: no importa React, Expo ni otras capas (regla de dependencias, maestro §6.1).
//
// CAMBIO RESPECTO DEL MAESTRO v1.0 (pendiente de reflejar en su sección 11):
//  - CaptureMode ya NO incluye 'MIXTO' (contexto §25.1: el modo mixto se eliminó de la interfaz).
//    La base de datos conserva 'MIXTO' en su CHECK solo por compatibilidad con el esquema publicado.
//  - QualityReason agrega 'CAMARA_EN_MOVIMIENTO' (Supuesto S-03): en modo AUTOMÁTICO la cámara no
//    dispara si el celular no está quieto dentro de capture.stability.maxWaitMs.

/** Fecha y hora ISO-8601 en UTC con milisegundos, p. ej. "2026-11-09T14:32:05.120Z" (Date.prototype.toISOString). */
export type ISODateString = string;
/** UUID v4 en minúsculas generado con Crypto.randomUUID(). */
export type UUID = string;

// ---------------------------------------------------------------- usuarios y cuentas
export type UserRole = 'ADMINISTRADOR' | 'OPERADOR_CAMPO' | 'ESPECIALISTA_FITOSANITARIO' | 'SUPERVISOR';
/**
 * Roles de usuario que pueden ENTRAR a la app móvil (los demás solo usan la web). v0.5.0 (ADR 0009): el especialista
 * fitosanitario entra solo a «Ubicar plaga»; el monitoreo y la sincronización siguen siendo de FIELD_ROLES.
 */
export const MOBILE_ALLOWED_ROLES: readonly UserRole[] = ['OPERADOR_CAMPO', 'ADMINISTRADOR', 'ESPECIALISTA_FITOSANITARIO'];
/** Roles que hacen trabajo de campo: función del celular (controlador/cámara), monitoreo y sincronización. */
export const FIELD_ROLES: readonly UserRole[] = ['OPERADOR_CAMPO', 'ADMINISTRADOR'];

/** ¿El usuario puede monitorear (elegir función, emitir y sincronizar)? El especialista solo ve «Ubicar plaga». */
export function canDoFieldWork(roles: readonly string[] | null | undefined): boolean {
  return !!roles && roles.some((r) => (FIELD_ROLES as readonly string[]).includes(r));
}
export type AccountStatus = 'PENDIENTE_APROBACION' | 'ACTIVO' | 'RECHAZADO' | 'BLOQUEADO';

export interface UserProfile {
  id: UUID;
  fullName: string;
  email: string;
  roles: UserRole[];
  status: AccountStatus;
  mustChangePassword: boolean;
}

export type AuthMode = 'ONLINE' | 'OFFLINE';
export type AuthStatus = 'SIN_SESION' | 'CAMBIO_CONTRASENA_REQUERIDO' | 'AUTENTICADO';

export interface AuthState {
  status: AuthStatus;
  mode: AuthMode | null;
  user: UserProfile | null;
  /** Último login o renovación validados por el backend. */
  lastOnlineAuthAt: ISODateString | null;
  /** Límite para volver a entrar sin internet (lastOnlineAuthAt + offlineLoginMaxDays). */
  offlineValidUntil: ISODateString | null;
}

// ---------------------------------------------------------------- dispositivo
export type DeviceRole = 'CONTROLADOR' | 'CAMERA_1' | 'CAMERA_2';
export type CameraRole = Exclude<DeviceRole, 'CONTROLADOR'>;
export const CAMERA_ROLES: readonly CameraRole[] = ['CAMERA_1', 'CAMERA_2'];
export type Platform = 'android' | 'ios';

export interface DeviceIdentity {
  /** Generado una sola vez por instalación y guardado en SecureStore + app_meta. */
  deviceId: UUID;
  platform: Platform;
  model: string;
  osVersion: string;
  appVersion: string;
  buildNumber: string;
}

// ---------------------------------------------------------------- catálogos de campo (bootstrap)
export interface Lot {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
export interface FieldRow {
  id: string;
  lotId: string;
  number: number;
  plantCount: number;
  active: boolean;
}
export interface Segment {
  id: string;
  rowId: string;
  code: string;
  startPlant: number;
  endPlant: number;
  isPilot: boolean;
}
export type MarkerPosition = 'INICIO' | 'FIN' | 'INTERMEDIO';
export interface Marker {
  id: string;
  rowId: string;
  segmentId: string | null;
  code: string;
  description: string | null;
  position: MarkerPosition;
  lat: number | null;
  lon: number | null;
}

// ---------------------------------------------------------------- recorrido
export type LateralCode = 'LATERAL_A' | 'LATERAL_B';
/** MANUAL: dispara el operador. AUTOMATICO: dispara el temporizador del controlador (MIXTO eliminado). */
export type CaptureMode = 'MANUAL' | 'AUTOMATICO';
/** Sentido de avance respecto de la numeración de plantas de la hilera. */
export type Direction = 'ASCENDENTE' | 'DESCENDENTE';
export type SessionStatus = 'DRAFT' | 'PREPARING' | 'READY' | 'ACTIVE' | 'PAUSED' | 'CLOSING' | 'CLOSED' | 'SYNCED';
export type PassStatus = 'READY' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'INCOMPLETE';
export type SequenceStatus = 'CREATED' | 'COMMAND_SENT' | 'PARTIAL' | 'COMPLETE' | 'INCOMPLETE' | 'CANCELLED';
export type QualityStatus =
  'CAPTURED' | 'UTILIZABLE' | 'REPETIR_NITIDEZ' | 'REPETIR_EXPOSICION' | 'ERROR_CAMARA' | 'PENDIENTE_REVISION_TECNICA';
export type LocalTransferStatus = 'PENDIENTE_LOCAL' | 'TRANSFIRIENDO_LOCAL' | 'RECIBIDA_CONTROLADOR' | 'ERROR_LOCAL';
export type RemoteSyncStatus = 'PENDIENTE_NUBE' | 'SUBIENDO' | 'SINCRONIZADO' | 'ERROR_SINCRONIZACION';
export type CameraLinkStatus = 'DESCONECTADA' | 'EMPAREJANDO' | 'CONECTADA' | 'INESTABLE' | 'PERDIDA';

export interface GpsFix {
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** Hora de la lectura del GPS (no la hora de la secuencia). */
  timestamp: ISODateString;
}

export interface MonitoringSession {
  sessionId: UUID;
  operatorUserId: UUID;
  controllerDeviceId: UUID;
  status: SessionStatus;
  mode: CaptureMode;
  intervalMs: number;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
  appVersion: string;
  configVersion: string;
  qualityProfileVersion: string;
  /** Hash SHA-256 del token del QR vigente (el token no se guarda en SQLite). */
  pairingTokenHash: string | null;
  shortTestPassedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  remoteSyncStatus: RemoteSyncStatus;
}

export interface SessionDevice {
  sessionId: UUID;
  role: CameraRole;
  deviceId: UUID;
  userId: UUID;
  platform: Platform;
  model: string;
  osVersion: string;
  appVersion: string;
  pairedAt: ISODateString;
  lastSeenAt: ISODateString | null;
  linkStatus: CameraLinkStatus;
  /** true cuando el operador liberó el rol para reemplazar el celular (PANT-13). */
  released: boolean;
  batteryLevel: number | null;
  freeSpaceBytes: number | null;
  pendingTransfers: number;
  /** Diferencia estimada reloj cámara − reloj controlador (ms). */
  clockOffsetMs: number | null;
}

export interface MonitoringPass {
  passId: UUID;
  sessionId: UUID;
  lotId: string;
  rowId: string;
  lateralCode: LateralCode;
  /** Orden de creación de las pasadas de esa hilera en la sesión: 1, 2, 3… (una repetición toma el siguiente). */
  passOrder: number;
  direction: Direction;
  startMarkerId: string | null;
  endMarkerId: string | null;
  currentSegmentId: string | null;
  currentMarkerId: string | null;
  status: PassStatus;
  startedAt: ISODateString | null;
  endedAt: ISODateString | null;
  sequencesTotal: number;
  sequencesComplete: number;
  sequencesIncomplete: number;
  remoteSyncStatus: RemoteSyncStatus;
}

/** Resultado de cada cámara dentro de una secuencia. */
export type SlotOutcome =
  'PENDIENTE' | 'OK_PENDIENTE_ARCHIVO' | 'OK_RECIBIDA' | 'RECHAZADA_CALIDAD' | 'ERROR_CAMARA' | 'SIN_RESPUESTA';

export interface SequenceSlot {
  role: CameraRole;
  /** captureId vigente para este rol (cambia si se repite la toma). */
  captureId: UUID;
  outcome: SlotOutcome;
}

export interface CaptureSequence {
  sequenceId: UUID;
  passId: UUID;
  sessionId: UUID;
  sequenceNumber: number;
  mode: CaptureMode;
  status: SequenceStatus;
  lotId: string;
  rowId: string;
  segmentId: string | null;
  markerId: string | null;
  gps: GpsFix | null;
  gpsAgeMs: number | null;
  issuedAt: ISODateString;
  expiresAt: ISODateString;
  completedAt: ISODateString | null;
  slots: Record<CameraRole, SequenceSlot>;
  remoteSyncStatus: RemoteSyncStatus;
}

export type QualityReason =
  | 'EXPOSICION_OSCURA'
  | 'EXPOSICION_SATURADA'
  | 'NITIDEZ_BAJA'
  | 'ARCHIVO_INVALIDO'
  | 'FALLO_CAMARA'
  | 'TIEMPO_AGOTADO'
  | 'CAMARA_EN_MOVIMIENTO';

export interface QualityMetrics {
  luminanceMean: number;
  darkRatio: number;
  brightRatio: number;
  /** Máximo de la varianza del Laplaciano entre las regiones analizadas (-1 si no se midió). */
  laplacianVariance: number;
  analyzedRegions: number;
  durationMs: number;
}

export interface QualityResult {
  status: Exclude<QualityStatus, 'CAPTURED'>;
  reasons: QualityReason[];
  metrics: QualityMetrics | null;
  profileVersion: string;
}

/** Una captura de evidencia (isTest = false) cumple RN-05. Las de prueba corta (isTest = true) no tienen pasada ni lateral. */
export interface Capture {
  captureId: UUID;
  sequenceId: UUID;
  sessionId: UUID;
  passId: UUID | null;
  lateralCode: LateralCode | null;
  isTest: boolean;
  deviceId: UUID;
  cameraRole: CameraRole;
  /** Usuario con sesión iniciada en la cámara que tomó la foto. */
  userId: UUID;
  capturedAt: ISODateString;
  filePath: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  md5: string | null;
  qualityStatus: QualityStatus;
  qualityProfileVersion: string;
  replacesCaptureId: UUID | null;
  localTransferStatus: LocalTransferStatus;
  /** Solo en el controlador; null en las cámaras. */
  remoteSyncStatus: RemoteSyncStatus | null;
  transferAttempts: number;
  syncAttempts: number;
  lastError: string | null;
  /** Fecha en que se liberó el archivo por retención (la fila se conserva). */
  fileDeletedAt: ISODateString | null;
}

/**
 * Repetición pedida por el operador (controlador). Guarda el contexto vigente en el momento de repetir:
 * la secuencia conserva su contexto original y la foto repetida se sincroniza con este (RN-07).
 */
export interface RetakeRequest {
  captureId: UUID;
  sequenceId: UUID;
  passId: UUID;
  cameraRole: CameraRole;
  replacesCaptureId: UUID;
  requestedAt: ISODateString;
  segmentId: string | null;
  markerId: string | null;
  gps: GpsFix | null;
  gpsAgeMs: number | null;
}

/** Cambio de marcador o segmento durante una pasada (controlador). Siempre manual (contexto §25.2). */
export interface MarkerChange {
  markerChangeId: UUID;
  passId: UUID;
  markerId: string | null;
  segmentId: string | null;
  changedAt: ISODateString;
  gps: GpsFix | null;
}

/** Sesión a la que está unida una cámara (tabla camera_context). */
export interface CameraContext {
  sessionId: UUID;
  controllerDeviceId: UUID;
  role: CameraRole;
  controllerHost: string;
  controlPort: number;
  filePort: number;
  pairedAt: ISODateString;
  /** JSON de PAIRED.config (se valida con zod al leerlo). */
  configJson: string;
  /** JSON del último SESSION_CONTEXT. */
  contextJson: string | null;
  closedAt: ISODateString | null;
  updatedAt: ISODateString;
}

export type IncidentType =
  | 'CALIDAD'
  | 'DESCONEXION'
  | 'BATERIA'
  | 'TEMPERATURA'
  | 'ESPACIO'
  | 'GPS'
  | 'TRANSFERENCIA'
  | 'SINCRONIZACION'
  | 'SOPORTE'
  | 'OPERADOR'
  | 'OTRO';

export type IncidentSeverity = 'INFO' | 'AVISO' | 'ERROR';

export interface Incident {
  incidentId: UUID;
  sessionId: UUID;
  passId: UUID | null;
  sequenceId: UUID | null;
  captureId: UUID | null;
  deviceId: UUID | null;
  type: IncidentType;
  severity: IncidentSeverity;
  detail: string;
  occurredAt: ISODateString;
  createdBy: 'SISTEMA' | 'OPERADOR';
}

// ------------------------------------------------ CFG-3: ciclos de monitoreo y áreas no hechas (migración 002, ADR 0004)
// Código latente: las tablas existen (migración 002) y las funciones puras se prueban (__tests__/coverage.test.ts),
// pero las pantallas todavía no lo usan; el ciclo vigente lo publicará la plataforma en el bootstrap.

/** Ronda de monitoreo: lo terminado se bloquea dentro del ciclo; un ciclo nuevo libera todo. */
export interface MonitoringCycle {
  cycleId: UUID;
  number: number;
  startedAt: ISODateString;
  startedByUserId: UUID | null;
  note: string | null;
}

export type UncoveredKind = 'LOTE' | 'HILERA' | 'LATERAL';

export type UncoveredReason =
  | 'CLIMA'
  | 'FALTA_TIEMPO'
  | 'RIEGO_O_APLICACION'
  | 'LABORES_CULTIVO'
  | 'FALLA_EQUIPO'
  | 'ACCESO_BLOQUEADO'
  | 'INDICACION_SUPERVISOR'
  | 'OTRO';

/** Lote, hilera o lateral planificado que no se hizo, con su motivo (tabla uncovered_areas). */
export interface UncoveredArea {
  areaId: UUID;
  sessionId: UUID;
  cycleId: UUID | null;
  kind: UncoveredKind;
  lotId: string;
  rowId: string | null;
  lateralCode: LateralCode | null;
  reason: UncoveredReason;
  note: string | null;
  userId: UUID | null;
  createdAt: ISODateString;
  remoteSyncStatus: RemoteSyncStatus;
}
