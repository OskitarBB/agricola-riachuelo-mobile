// src/domain/rules.ts — Reglas de negocio como funciones puras (RN-06, RN-10 a RN-13, RN-15, RN-19, RN-21).
//
// QUÉ HACE: cada función recibe datos ya leídos (no toca SQLite ni la red) y devuelve una decisión.
// Así se prueban con Jest (__tests__/rules.test.ts) y los servicios las reutilizan sin duplicar lógica.

import type { CameraLinkStatus, CameraRole, CaptureMode, LateralCode, MonitoringPass, PassStatus, SessionStatus } from './types';

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
  minBatteryPct: number;
  minFreeSpaceBytes: number;
}

/** RN-10 (inicio de pasada). */
export function canStartPass(i: StartPassInput): RuleResult {
  if (i.links.CAMERA_1 !== 'CONECTADA' || i.links.CAMERA_2 !== 'CONECTADA') return fail('CAMARAS_NO_LISTAS');
  if (!i.shortTestPassed) return fail('PRUEBA_CORTA_PENDIENTE');
  if (!i.lotId || !i.rowId || !i.lateral || !i.markerId) return fail('CONTEXTO_INCOMPLETO');
  for (const d of i.devices) {
    if (d.batteryPct !== null && d.batteryPct < i.minBatteryPct) return fail('BATERIA_BAJA');
    if (d.freeSpaceBytes !== null && d.freeSpaceBytes < i.minFreeSpaceBytes) return fail('ESPACIO_BAJO');
  }
  return OK;
}

export interface ResumeInput {
  links: Record<CameraRole, CameraLinkStatus>;
  resyncInProgress: boolean;
  devices: DeviceHealth[];
  pauseBatteryPct: number;
  pauseFreeSpaceBytes: number;
}

/** RN-10 (reanudación): no repite la prueba corta, pero exige cámaras conectadas y sin RESYNC en curso. */
export function canResumePass(i: ResumeInput): RuleResult {
  if (i.links.CAMERA_1 !== 'CONECTADA' || i.links.CAMERA_2 !== 'CONECTADA') return fail('CAMARAS_NO_LISTAS');
  if (i.resyncInProgress) return fail('RESYNC_EN_CURSO');
  for (const d of i.devices) {
    if (d.batteryPct !== null && d.batteryPct < i.pauseBatteryPct) return fail('BATERIA_CRITICA');
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

/** RN-19 — No se cierra la sesión de usuario con una sesión de monitoreo abierta. */
export function canLogout(hasOpenSession: boolean): RuleResult {
  return hasOpenSession ? fail('SESION_ABIERTA_IMPIDE_SALIR') : OK;
}

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
