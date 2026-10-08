// src/domain/rules.ts — Reglas de negocio como funciones puras (RN-06, RN-10 a RN-13, RN-15, RN-21).
//
// QUÉ HACE: cada función recibe datos ya leídos (no toca SQLite ni la red) y devuelve una decisión.
// Así se prueban con Jest (__tests__/rules.test.ts) y los servicios las reutilizan sin duplicar lógica.

import type {
  CameraLinkStatus,
  CameraRole,
  CaptureMode,
  DeviceRole,
  Direction,
  LateralCode,
  MonitoringPass,
  PassStatus,
  SessionStatus,
} from './types';

export type RuleResult = { ok: true } | { ok: false; code: string };

const OK: RuleResult = { ok: true };
const fail = (code: string): RuleResult => ({ ok: false, code });

/** 7.12 — Estados del controlador que cuentan como "sesión de monitoreo abierta" (DRAFT no cuenta). */
export const OPEN_SESSION_STATUSES: readonly SessionStatus[] = ['PREPARING', 'READY', 'ACTIVE', 'PAUSED', 'CLOSING'];
export function isOpenSessionStatus(status: SessionStatus): boolean {
  return OPEN_SESSION_STATUSES.includes(status);
}

/** RN-12 — Solo puede haber una pasada abierta (READY, ACTIVE o PAUSED) por sesión. */
export const OPEN_PASS_STATUSES: readonly PassStatus[] = ['READY', 'ACTIVE', 'PAUSED'];
export function isOpenPassStatus(status: PassStatus): boolean {
  return OPEN_PASS_STATUSES.includes(status);
}

export interface DeviceHealth {
  batteryPct: number | null; // 0..100; null = desconocido (no bloquea)
  freeSpaceBytes: number | null;
}

export interface StartPassInput {
  links: Record<CameraRole, CameraLinkStatus>;
  shortTestPassed: boolean;
  lotId: string | null;
  rowId: string | null;
  lateral: LateralCode | null;
  markerId: string | null;
  devices: DeviceHealth[]; // controlador + cámaras
  minFreeSpaceBytes: number;
}

/** RN-10 (inicio de pasada). Desde CFG-7 la batería no bloquea: solo avisa (controllerRuntime.checkDeviceHealth). */
export function canStartPass(i: StartPassInput): RuleResult {
  if (i.links.CAMERA_1 !== 'CONECTADA' || i.links.CAMERA_2 !== 'CONECTADA') return fail('CAMARAS_NO_LISTAS');
  if (!i.shortTestPassed) return fail('PRUEBA_CORTA_PENDIENTE');
  if (!i.lotId || !i.rowId || !i.lateral || !i.markerId) return fail('CONTEXTO_INCOMPLETO');
  for (const d of i.devices) {
    if (d.freeSpaceBytes !== null && d.freeSpaceBytes < i.minFreeSpaceBytes) return fail('ESPACIO_BAJO');
  }
  return OK;
}

export interface ResumeInput {
  links: Record<CameraRole, CameraLinkStatus>;
  resyncInProgress: boolean;
  devices: DeviceHealth[];
  pauseFreeSpaceBytes: number;
}

/** RN-10 (reanudación): no repite la prueba corta, pero exige cámaras conectadas y sin RESYNC en curso. */
export function canResumePass(i: ResumeInput): RuleResult {
  if (i.links.CAMERA_1 !== 'CONECTADA' || i.links.CAMERA_2 !== 'CONECTADA') return fail('CAMARAS_NO_LISTAS');
  if (i.resyncInProgress) return fail('RESYNC_EN_CURSO');
  for (const d of i.devices) {
    if (d.freeSpaceBytes !== null && d.freeSpaceBytes < i.pauseFreeSpaceBytes) return fail('ESPACIO_CRITICO');
  }
  return OK;
}

/** RN-11 — No se emite una nueva orden mientras la anterior no tenga respuesta o no venza su espera. */
export function canIssueCommand(orderInFlight: boolean): RuleResult {
  return orderInFlight ? fail('ORDEN_EN_CURSO') : OK;
}

/**
 * RN-12 — Validación del lateral de una nueva pasada.
 * - LATERAL_B exige una LATERAL_A cerrada (COMPLETED o INCOMPLETE) de la misma hilera en la sesión.
 * - Repetir lateral exige una incidencia (se valida en la pantalla y en passService).
 * - Nunca dos pasadas abiertas a la vez.
 */
export function canCreatePass(
  passesOfSession: Pick<MonitoringPass, 'rowId' | 'lateralCode' | 'status'>[],
  rowId: string,
  lateral: LateralCode,
): RuleResult {
  if (passesOfSession.some((p) => isOpenPassStatus(p.status))) return fail('PASADA_ABIERTA');
  if (lateral === 'LATERAL_B') {
    const aClosed = passesOfSession.some(
      (p) => p.rowId === rowId && p.lateralCode === 'LATERAL_A' && (p.status === 'COMPLETED' || p.status === 'INCOMPLETE'),
    );
    if (!aClosed) return fail('LATERAL_A_PENDIENTE');
  }
  return OK;
}

/** passOrder = máximo de esa hilera en la sesión + 1 (RN-12). */
export function nextPassOrder(passesOfSession: Pick<MonitoringPass, 'rowId' | 'passOrder'>[], rowId: string): number {
  return passesOfSession.filter((p) => p.rowId === rowId).reduce((max, p) => Math.max(max, p.passOrder), 0) + 1;
}

/** ¿Es una repetición de lateral? (ya existe una pasada cerrada de ese lateral en esa hilera). */
export function isLateralRepeat(
  passesOfSession: Pick<MonitoringPass, 'rowId' | 'lateralCode' | 'status'>[],
  rowId: string,
  lateral: LateralCode,
): boolean {
  return passesOfSession.some((p) => p.rowId === rowId && p.lateralCode === lateral && !isOpenPassStatus(p.status));
}

/** RN-13 — Una hilera queda cubierta con pasadas cerradas en ambos laterales. */
export function isRowCovered(passesOfRow: Pick<MonitoringPass, 'lateralCode' | 'status'>[]): boolean {
  const closed = (l: LateralCode) =>
    passesOfRow.some((p) => p.lateralCode === l && (p.status === 'COMPLETED' || p.status === 'INCOMPLETE'));
  return closed('LATERAL_A') && closed('LATERAL_B');
}

/** RN-15 — La función del dispositivo solo cambia sin sesión abierta ni pendientes. */
export function canChangeDeviceRole(hasOpenSession: boolean, pendingTransfers: number, pendingSync: number): RuleResult {
  if (hasOpenSession || pendingTransfers > 0 || pendingSync > 0) return fail('CAMBIO_FUNCION_BLOQUEADO');
  return OK;
}

/** Aviso que PANT-08 confirma antes de cambiar la función (no bloquea). */
export type RoleChangeWarning = 'SINCRONIZACION_PENDIENTE' | 'CAMBIO_FUNCION_ERRORES_SINCRONIZACION';

export type RoleChangeBlockCode =
  | 'CAMBIO_FUNCION_SESION_ABIERTA'
  | 'CAMBIO_FUNCION_FOTOS_PENDIENTES'
  | 'CAMBIO_FUNCION_SINCRONIZACION_PENDIENTE'
  | 'CAMBIO_FUNCION_BLOQUEADO';

export type RoleChangeDecision =
  | { kind: 'SAME' }
  | { kind: 'ALLOWED'; warnings: RoleChangeWarning[] }
  | { kind: 'BLOCKED'; code: RoleChangeBlockCode };

export interface RoleChangeInput {
  /** Función guardada en el celular (null = todavía no eligió ninguna). */
  current: DeviceRole | null;
  /** Función que el operador eligió en PANT-08. */
  target: DeviceRole;
  /** 7.12 según la función actual. */
  hasOpenSession: boolean;
  /** Cámara: fotos que aún no llegan al controlador. */
  pendingTransfers: number;
  /** Controlador: elementos de sync_queue sin confirmar por el backend. */
  pendingSync: number;
  /** false mientras la sincronización con el backend no exista (Fase 4): la cola no se puede vaciar. */
  syncAvailable: boolean;
  /** Controlador: elementos con error definitivo (requieren revisión; no bloquean, se avisa). */
  syncErrors?: number;
}

/**
 * RN-15 en PANT-08 (ADR 0005). Decide qué pasa cuando el operador elige `target` después del login
 * o desde Ajustes:
 *  - SAME: es la función actual; siempre se puede continuar con ella (incluso con una sesión abierta).
 *  - BLOCKED: hay una sesión de monitoreo abierta o fotos por enviar al controlador (RN-15).
 *  - ALLOWED: se puede cambiar. Con la cola hacia el backend pendiente y SIN sincronización disponible se
 *    avisa (SINCRONIZACION_PENDIENTE): esos datos se conservan en SQLite y no se pierden al cambiar.
 * Con la sincronización disponible (Fase 4, syncAvailable = true) la cola pendiente BLOQUEA, como dice RN-15
 * (CAMBIO_FUNCION_SINCRONIZACION_PENDIENTE: primero «Sincronizar ahora»). Los elementos con error definitivo no
 * bloquean (nunca se vaciarían solos): se avisa y quedan guardados en el celular para revisarlos.
 */
export function decideRoleChange(i: RoleChangeInput): RoleChangeDecision {
  if (i.current === i.target) return { kind: 'SAME' };
  if (i.current === null) return { kind: 'ALLOWED', warnings: [] };
  if (i.hasOpenSession) return { kind: 'BLOCKED', code: 'CAMBIO_FUNCION_SESION_ABIERTA' };
  if (i.pendingTransfers > 0) return { kind: 'BLOCKED', code: 'CAMBIO_FUNCION_FOTOS_PENDIENTES' };
  const warnings: RoleChangeWarning[] = [];
  if (i.pendingSync > 0) {
    if (i.syncAvailable) return { kind: 'BLOCKED', code: 'CAMBIO_FUNCION_SINCRONIZACION_PENDIENTE' };
    warnings.push('SINCRONIZACION_PENDIENTE');
  }
  if ((i.syncErrors ?? 0) > 0) warnings.push('CAMBIO_FUNCION_ERRORES_SINCRONIZACION');
  return { kind: 'ALLOWED', warnings };
}

/**
 * CFG-3 (ADR 0004) — El LATERAL B se recorre en la dirección opuesta a la del último LATERAL A cerrado
 * (`requiredB`, calculada por domain/coverage.ts). Sin LATERAL A cerrado (requiredB = null) no hay restricción.
 */
export function validatePassDirection(lateral: LateralCode, direction: Direction, requiredB: Direction | null): RuleResult {
  if (lateral === 'LATERAL_B' && requiredB !== null && direction !== requiredB) return fail('DIRECCION_LATERAL_B');
  return OK;
}

// RN-19 (modificada en v0.4.5, ADR 0008): cerrar la sesión de usuario ya no se bloquea con una sesión de monitoreo
// abierta; la sesión queda guardada en el celular y se recupera al volver a entrar (src/ui/hooks/useLogout.ts).

/**
 * Contexto §25.1/25.2 — Reglas de interfaz del modo de captura.
 * MANUAL: el intervalo no participa (UI deshabilitada).
 * AUTOMATICO: el intervalo es obligatorio y dentro de límites.
 */
export function validateSessionMode(
  mode: CaptureMode,
  intervalMs: number | null,
  limits: { minIntervalMs: number; maxIntervalMs: number },
): RuleResult {
  if (mode === 'MANUAL') return OK;
  if (intervalMs === null || !Number.isFinite(intervalMs)) return fail('INTERVALO_REQUERIDO');
  if (intervalMs < limits.minIntervalMs || intervalMs > limits.maxIntervalMs) return fail('INTERVALO_FUERA_DE_RANGO');
  return OK;
}

/**
 * Contexto §25.2 — El cambio de marcador es SIEMPRE manual.
 * En AUTOMÁTICO solo se permite con la pasada pausada (para que ninguna captura caiga en medio del cambio).
 * En MANUAL se permite con la pasada activa o pausada, sin una orden en curso.
 */
export function canChangeMarker(mode: CaptureMode, passStatus: PassStatus, orderInFlight: boolean): RuleResult {
  if (passStatus !== 'ACTIVE' && passStatus !== 'PAUSED') return fail('PASADA_NO_ABIERTA');
  if (orderInFlight) return fail('ORDEN_EN_CURSO');
  if (mode === 'AUTOMATICO' && passStatus !== 'PAUSED') return fail('PAUSA_REQUERIDA');
  return OK;
}

/** Mediana de una lista de números (desfase de reloj, 14.9). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
