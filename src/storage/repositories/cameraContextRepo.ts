// src/storage/repositories/cameraContextRepo.ts — Sesión a la que está unida una CÁMARA (tabla camera_context).
//
// QUÉ HACE: guarda los datos del QR (host y puertos) para reconectar, la configuración recibida en
// PAIRED y el último SESSION_CONTEXT. Un contexto está "abierto" mientras closed_at sea NULL (7.12).
// El token del QR NO va aquí: va en SecureStore (pairing.token).

import type { CameraContext, CameraRole } from '../../domain/types';
import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

interface Row {
  session_id: string;
  controller_device_id: string;
  role: CameraRole;
  controller_host: string;
  control_port: number;
  file_port: number;
  paired_at: string;
  config_json: string;
  context_json: string | null;
  closed_at: string | null;
  updated_at: string;
}

function toDomain(r: Row): CameraContext {
  return {
    sessionId: r.session_id,
    controllerDeviceId: r.controller_device_id,
    role: r.role,
    controllerHost: r.controller_host,
    controlPort: r.control_port,
    filePort: r.file_port,
    pairedAt: r.paired_at,
    configJson: r.config_json,
    contextJson: r.context_json,
    closedAt: r.closed_at,
    updatedAt: r.updated_at,
  };
}

export async function getOpenContext(db: Db = getDb()): Promise<CameraContext | null> {
  const r = await db.getFirstAsync<Row>(
    'SELECT * FROM camera_context WHERE closed_at IS NULL ORDER BY paired_at DESC LIMIT 1',
    [],
  );
  return r ? toDomain(r) : null;
}

export async function getContext(sessionId: string, db: Db = getDb()): Promise<CameraContext | null> {
  const r = await db.getFirstAsync<Row>('SELECT * FROM camera_context WHERE session_id = ?', [sessionId]);
  return r ? toDomain(r) : null;
}

export async function upsertContext(c: CameraContext, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO camera_context (session_id, controller_device_id, role, controller_host, control_port, file_port, paired_at,
       config_json, context_json, closed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET controller_device_id = excluded.controller_device_id, role = excluded.role,
       controller_host = excluded.controller_host, control_port = excluded.control_port, file_port = excluded.file_port,
       config_json = excluded.config_json, closed_at = NULL, updated_at = excluded.updated_at`,
    [
      c.sessionId,
      c.controllerDeviceId,
      c.role,
      c.controllerHost,
      c.controlPort,
      c.filePort,
      c.pairedAt,
      c.configJson,
      c.contextJson,
      c.closedAt,
      nowIso(),
    ],
  );
}

export async function setContextJson(sessionId: string, contextJson: string, db: Db = getDb()): Promise<void> {
  await db.runAsync('UPDATE camera_context SET context_json = ?, updated_at = ? WHERE session_id = ?', [
    contextJson,
    nowIso(),
    sessionId,
  ]);
}

export async function closeContext(sessionId: string, db: Db = getDb()): Promise<void> {
  const now = nowIso();
  await db.runAsync('UPDATE camera_context SET closed_at = ?, updated_at = ? WHERE session_id = ? AND closed_at IS NULL', [
    now,
    now,
    sessionId,
  ]);
}

/** Controlador de cada sesión conocida (para enviar fotos solo a su controlador, RN-22). */
export async function listContexts(db: Db = getDb()): Promise<CameraContext[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM camera_context ORDER BY paired_at DESC', []);
  return rows.map(toDomain);
}
