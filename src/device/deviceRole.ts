// src/device/deviceRole.ts — Función del celular: CONTROLADOR, CÁMARA 1 o CÁMARA 2 (maestro §7.9, D-08).
//
// QUÉ HACE: guarda la función en app_meta.device_role (persiste entre reinicios) y valida el cambio
// con RN-15 (sin sesión de monitoreo abierta ni transferencias/sincronizaciones pendientes).
// ADR 0005: loadRoleChangeContext() reúne lo que PANT-08 necesita para decidir con
// decideRoleChange(); mientras la sincronización (Fase 4) no exista, la cola pendiente solo avisa.

import { canChangeDeviceRole, type RuleResult } from '../domain/rules';
import type { DeviceRole } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';
import { getMeta, setMeta } from '../storage/repositories/appMetaRepo';
import { getOpenContext } from '../storage/repositories/cameraContextRepo';
import { countPendingTransfers } from '../storage/repositories/captureRepo';
import { getCurrentSession } from '../storage/repositories/sessionRepo';
import { countPendingSync } from '../storage/repositories/syncQueueRepo';
import { isSyncImplemented } from '../sync/syncService';

export async function loadDeviceRole(): Promise<DeviceRole | null> {
  const v = await getMeta('device_role');
  return v === 'CONTROLADOR' || v === 'CAMERA_1' || v === 'CAMERA_2' ? v : null;
}

/** 7.12: ¿este celular tiene una sesión de monitoreo abierta según su función? */
export async function hasOpenMonitoringSession(role: DeviceRole | null): Promise<boolean> {
  if (!role) return false;
  if (role === 'CONTROLADOR') return (await getCurrentSession(false)) !== null;
  return (await getOpenContext()) !== null;
}

/** Datos de este celular que deciden si se puede cambiar de función (RN-15). */
export interface RoleChangeContext {
  hasOpenSession: boolean;
  pendingTransfers: number;
  pendingSync: number;
  syncAvailable: boolean;
}

export async function loadRoleChangeContext(current: DeviceRole | null): Promise<RoleChangeContext> {
  const syncAvailable = isSyncImplemented();
  if (!current) return { hasOpenSession: false, pendingTransfers: 0, pendingSync: 0, syncAvailable };
  return {
    hasOpenSession: await hasOpenMonitoringSession(current),
    pendingTransfers: current === 'CONTROLADOR' ? 0 : await countPendingTransfers(),
    pendingSync: current === 'CONTROLADOR' ? await countPendingSync() : 0,
    syncAvailable,
  };
}

/** ¿Se puede salir de la función actual? (sin sesión abierta ni fotos por enviar; la cola de nube solo cuenta con Fase 4). */
export async function canChangeRole(current: DeviceRole | null): Promise<RuleResult> {
  if (!current) return { ok: true };
  const c = await loadRoleChangeContext(current);
  return canChangeDeviceRole(c.hasOpenSession, c.pendingTransfers, c.syncAvailable ? c.pendingSync : 0);
}

export async function saveDeviceRole(role: DeviceRole): Promise<void> {
  await setMeta('device_role', role);
  logEvent('INFO', 'DEVICE', 'ROLE_SET', { role });
}
