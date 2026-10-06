// src/storage/repositories/sessionRepo.ts — Sesiones de monitoreo y celulares de cámara por sesión.
//
// QUÉ HACE: lee y escribe monitoring_sessions y session_devices (solo en el CONTROLADOR).
// La lógica de qué cambio de estado es válido NO está aquí: está en src/controller/sessionService.ts
// (que llama a assertTransition antes de escribir).

import type {
  CameraLinkStatus,
  CameraRole,
  CaptureMode,
  MonitoringSession,
  Platform,
  RemoteSyncStatus,
  SessionDevice,
  SessionStatus,
} from '../../domain/types';
import { OPEN_SESSION_STATUSES } from '../../domain/rules';
import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

interface SessionRow {
  session_id: string;
  operator_user_id: string;
  controller_device_id: string;
  status: SessionStatus;
  mode: CaptureMode;
  interval_ms: number;
  pairing_token_hash: string | null;
  short_test_passed_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  app_version: string;
  config_version: string;
  quality_profile_version: string;
  remote_sync_status: RemoteSyncStatus;
  created_at: string;
  updated_at: string;
}

function toDomain(r: SessionRow): MonitoringSession {
  return {
    sessionId: r.session_id,
    operatorUserId: r.operator_user_id,
    controllerDeviceId: r.controller_device_id,
    status: r.status,
    mode: r.mode,
    intervalMs: r.interval_ms,
    pairingTokenHash: r.pairing_token_hash,
    shortTestPassedAt: r.short_test_passed_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    appVersion: r.app_version,
    configVersion: r.config_version,
    qualityProfileVersion: r.quality_profile_version,
    remoteSyncStatus: r.remote_sync_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function insertSession(s: MonitoringSession, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO monitoring_sessions (session_id, operator_user_id, controller_device_id, status, mode, interval_ms,
      pairing_token_hash, short_test_passed_at, started_at, ended_at, app_version, config_version, quality_profile_version,
      remote_sync_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.sessionId,
      s.operatorUserId,
      s.controllerDeviceId,
      s.status,
      s.mode,
      s.intervalMs,
      s.pairingTokenHash,
      s.shortTestPassedAt,
      s.startedAt,
      s.endedAt,
      s.appVersion,
      s.configVersion,
      s.qualityProfileVersion,
      s.remoteSyncStatus,
      s.createdAt,
      s.updatedAt,
    ],
  );
}

export async function getSession(sessionId: string, db: Db = getDb()): Promise<MonitoringSession | null> {
  const r = await db.getFirstAsync<SessionRow>('SELECT * FROM monitoring_sessions WHERE session_id = ?', [sessionId]);
  return r ? toDomain(r) : null;
}

/** Sesión abierta (7.12) o borrador del controlador, la más reciente. */
export async function getCurrentSession(includeDraft = true, db: Db = getDb()): Promise<MonitoringSession | null> {
  const statuses = includeDraft ? ['DRAFT', ...OPEN_SESSION_STATUSES] : [...OPEN_SESSION_STATUSES];
  const marks = statuses.map(() => '?').join(',');
  const r = await db.getFirstAsync<SessionRow>(
    `SELECT * FROM monitoring_sessions WHERE status IN (${marks}) ORDER BY created_at DESC LIMIT 1`,
    statuses,
  );
  return r ? toDomain(r) : null;
}

export async function updateSession(
  sessionId: string,
  patch: Partial<
    Pick<MonitoringSession, 'status' | 'pairingTokenHash' | 'shortTestPassedAt' | 'startedAt' | 'endedAt' | 'remoteSyncStatus'>
  >,
  db: Db = getDb(),
): Promise<void> {
  const map: Record<string, string> = {
    status: 'status',
    pairingTokenHash: 'pairing_token_hash',
    shortTestPassedAt: 'short_test_passed_at',
    startedAt: 'started_at',
    endedAt: 'ended_at',
    remoteSyncStatus: 'remote_sync_status',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in map)) continue;
    sets.push(`${map[k]} = ?`);
    params.push((v ?? null) as string | null);
  }
  sets.push('updated_at = ?');
  params.push(nowIso(), sessionId);
  await db.runAsync(`UPDATE monitoring_sessions SET ${sets.join(', ')} WHERE session_id = ?`, params);
}

/** Solo un borrador DRAFT se elimina (no tiene datos dependientes; maestro §12.5). */
export async function deleteDraft(sessionId: string, db: Db = getDb()): Promise<void> {
  await db.runAsync("DELETE FROM monitoring_sessions WHERE session_id = ? AND status = 'DRAFT'", [sessionId]);
}

export async function listSessionsByStatus(statuses: SessionStatus[], db: Db = getDb()): Promise<MonitoringSession[]> {
  if (statuses.length === 0) return [];
  const marks = statuses.map(() => '?').join(',');
  const rows = await db.getAllAsync<SessionRow>(
    `SELECT * FROM monitoring_sessions WHERE status IN (${marks}) ORDER BY created_at DESC`,
    statuses,
  );
  return rows.map(toDomain);
}

export async function listSyncedSessionIds(db: Db = getDb()): Promise<string[]> {
  const rows = await db.getAllAsync<{ session_id: string }>(
    "SELECT session_id FROM monitoring_sessions WHERE status = 'SYNCED'",
    [],
  );
  return rows.map((r) => r.session_id);
}

// ------------------------------------------------------------------ session_devices

interface DeviceRow {
  session_id: string;
  role: CameraRole;
  device_id: string;
  user_id: string;
  platform: Platform;
  model: string;
  os_version: string;
  app_version: string;
  paired_at: string;
  last_seen_at: string | null;
  link_status: CameraLinkStatus;
  battery_level: number | null;
  free_space_bytes: number | null;
  pending_transfers: number;
  clock_offset_ms: number | null;
  released: number;
}

function deviceToDomain(r: DeviceRow): SessionDevice {
  return {
    sessionId: r.session_id,
    role: r.role,
    deviceId: r.device_id,
    userId: r.user_id,
    platform: r.platform,
    model: r.model,
    osVersion: r.os_version,
    appVersion: r.app_version,
    pairedAt: r.paired_at,
    lastSeenAt: r.last_seen_at,
    linkStatus: r.link_status,
    released: r.released === 1,
    batteryLevel: r.battery_level,
    freeSpaceBytes: r.free_space_bytes,
    pendingTransfers: r.pending_transfers,
    clockOffsetMs: r.clock_offset_ms,
  };
}

export async function listSessionDevices(sessionId: string, db: Db = getDb()): Promise<SessionDevice[]> {
  const rows = await db.getAllAsync<DeviceRow>('SELECT * FROM session_devices WHERE session_id = ? ORDER BY paired_at', [
    sessionId,
  ]);
  return rows.map(deviceToDomain);
}

export async function getSessionDevice(sessionId: string, deviceId: string, db: Db = getDb()): Promise<SessionDevice | null> {
  const r = await db.getFirstAsync<DeviceRow>('SELECT * FROM session_devices WHERE session_id = ? AND device_id = ?', [
    sessionId,
    deviceId,
  ]);
  return r ? deviceToDomain(r) : null;
}

/** Guarda o actualiza el celular de un rol (released = 0, enlace CONECTADA) — maestro §14.6 paso 4. */
export async function upsertSessionDevice(d: SessionDevice, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO session_devices (session_id, role, device_id, user_id, platform, model, os_version, app_version, paired_at,
       last_seen_at, link_status, battery_level, free_space_bytes, pending_transfers, clock_offset_ms, released)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, device_id) DO UPDATE SET role = excluded.role, user_id = excluded.user_id,
       platform = excluded.platform, model = excluded.model, os_version = excluded.os_version, app_version = excluded.app_version,
       last_seen_at = excluded.last_seen_at, link_status = excluded.link_status, battery_level = excluded.battery_level,
       free_space_bytes = excluded.free_space_bytes, pending_transfers = excluded.pending_transfers, released = excluded.released`,
    [
      d.sessionId,
      d.role,
      d.deviceId,
      d.userId,
      d.platform,
      d.model,
      d.osVersion,
      d.appVersion,
      d.pairedAt,
      d.lastSeenAt,
      d.linkStatus,
      d.batteryLevel,
      d.freeSpaceBytes,
      d.pendingTransfers,
      d.clockOffsetMs,
      d.released ? 1 : 0,
    ],
  );
}

export async function updateDeviceLink(
  sessionId: string,
  deviceId: string,
  patch: Partial<
    Pick<SessionDevice, 'linkStatus' | 'lastSeenAt' | 'batteryLevel' | 'freeSpaceBytes' | 'pendingTransfers' | 'clockOffsetMs'>
  >,
  db: Db = getDb(),
): Promise<void> {
  const map: Record<string, string> = {
    linkStatus: 'link_status',
    lastSeenAt: 'last_seen_at',
    batteryLevel: 'battery_level',
    freeSpaceBytes: 'free_space_bytes',
    pendingTransfers: 'pending_transfers',
    clockOffsetMs: 'clock_offset_ms',
  };
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in map)) continue;
    sets.push(`${map[k]} = ?`);
    params.push((v ?? null) as string | number | null);
  }
  if (sets.length === 0) return;
  params.push(sessionId, deviceId);
  await db.runAsync(`UPDATE session_devices SET ${sets.join(', ')} WHERE session_id = ? AND device_id = ?`, params);
}

/** Libera el rol de una cámara (RN-16) para reemplazarla por otro celular. */
export async function releaseRole(sessionId: string, role: CameraRole, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    "UPDATE session_devices SET released = 1, link_status = 'DESCONECTADA' WHERE session_id = ? AND role = ? AND released = 0",
    [sessionId, role],
  );
}

/** Al restaurar una sesión (8.10) todas sus cámaras pasan a DESCONECTADA hasta su PAIR_REQUEST. */
export async function markAllDisconnected(sessionId: string, db: Db = getDb()): Promise<void> {
  await db.runAsync("UPDATE session_devices SET link_status = 'DESCONECTADA' WHERE session_id = ?", [sessionId]);
}

// ------------------------------------------------------------------ sincronización (Fase 4)

/** Estado de la sesión respecto de la plataforma (no cambia `status`). */
export async function setSessionRemoteStatus(sessionId: string, status: RemoteSyncStatus, db: Db = getDb()): Promise<void> {
  await db.runAsync('UPDATE monitoring_sessions SET remote_sync_status = ?, updated_at = ? WHERE session_id = ?', [
    status,
    nowIso(),
    sessionId,
  ]);
}

/**
 * CLOSED → SYNCED (§15.5 paso 6): todos los elementos de la cola están HECHO. Marca SINCRONIZADO la sesión, sus pasadas,
 * secuencias e incidencias en una transacción (la llama syncService dentro de inTransaction).
 */
export async function markSessionSynced(sessionId: string, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync(
    "UPDATE monitoring_sessions SET status = 'SYNCED', remote_sync_status = 'SINCRONIZADO', updated_at = ? WHERE session_id = ? AND status = 'CLOSED'",
    [now, sessionId],
  );
  await db.runAsync("UPDATE monitoring_passes SET remote_sync_status = 'SINCRONIZADO', updated_at = ? WHERE session_id = ?", [
    now,
    sessionId,
  ]);
  await db.runAsync("UPDATE capture_sequences SET remote_sync_status = 'SINCRONIZADO' WHERE session_id = ?", [sessionId]);
  await db.runAsync("UPDATE incidents SET remote_sync_status = 'SINCRONIZADO' WHERE session_id = ?", [sessionId]);
}
