// src/device/deviceRole.ts — Función del celular: CONTROLADOR, CÁMARA 1 o CÁMARA 2 (maestro §7.9, D-08).
//
// QUÉ HACE: guarda la función en app_meta.device_role (persiste entre reinicios) y valida el cambio
// con RN-15 (sin sesión de monitoreo abierta ni transferencias/sincronizaciones pendientes).

import { canChangeDeviceRole, type RuleResult } from '../domain/rules';
import type { DeviceRole } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';
import { getMeta, setMeta } from '../storage/repositories/appMetaRepo';
import { getOpenContext } from '../storage/repositories/cameraContextRepo';
import { countPendingTransfers } from '../storage/repositories/captureRepo';
import { getCurrentSession } from '../storage/repositories/sessionRepo';
import { countPendingSync } from '../storage/repositories/syncQueueRepo';

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

export async function canChangeRole(current: DeviceRole | null): Promise<RuleResult> {
  if (!current) return { ok: true };
  const open = await hasOpenMonitoringSession(current);
  const pendingTransfers = current === 'CONTROLADOR' ? 0 : await countPendingTransfers();
  const pendingSync = current === 'CONTROLADOR' ? await countPendingSync() : 0;
  return canChangeDeviceRole(open, pendingTransfers, pendingSync);
}

export async function saveDeviceRole(role: DeviceRole): Promise<void> {
  await setMeta('device_role', role);
  logEvent('INFO', 'DEVICE', 'ROLE_SET', { role });
}
