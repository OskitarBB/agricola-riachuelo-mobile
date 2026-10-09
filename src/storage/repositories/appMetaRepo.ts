// src/storage/repositories/appMetaRepo.ts — Tabla app_meta (clave/valor no secreto).
//
// QUÉ HACE: guarda datos de configuración del celular que no son secretos: device_id, device_role,
// catalog_version, bootstrap_at, offline_failed_attempts, offline_locked_until, short_test_pending, etc.
// Claves agregadas en esta versión (Supuesto S-05): ui_sounds, ui_haptics (preferencias de interfaz).
// Fase 4: quality_profile_json (perfil publicado en el bootstrap, se reaplica al arrancar), server_clock_offset_ms
// (hora del servidor − hora del celular, para medir vencimientos de tokens) y last_sync (resultado de la última
// sincronización: fecha, código y conteos; sin datos sensibles).
// v0.5.0 (ADR 0009): pest_reports_json — última lista de «Ubicar plaga» (alertas con ubicación y capas del fundo) para
// verla sin internet en el campo; se reemplaza en cada actualización (todos los usuarios de la app ven la misma lista).
// v0.5.1: deleted_cursor — cursor de GET /mobile/deleted-captures (fotos y sesiones borradas por el administrador).

import { getDb, type Db } from '../db';

export type MetaKey =
  | 'device_id'
  | 'device_role'
  | 'catalog_version'
  | 'bootstrap_at'
  | 'config_version'
  | 'quality_profile_version'
  | 'quality_profile_json'
  | 'offline_failed_attempts'
  | 'offline_locked_until'
  | 'short_test_pending'
  | 'last_online_user_id'
  | 'server_clock_offset_ms'
  | 'last_sync'
  | 'ui_sounds'
  | 'ui_haptics'
  | 'pest_reports_json'
  | 'deleted_cursor';

export async function getMeta(key: MetaKey, db: Db = getDb()): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM app_meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setMeta(key: MetaKey, value: string | null, db: Db = getDb()): Promise<void> {
  await db.runAsync('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

export async function deleteMeta(key: MetaKey, db: Db = getDb()): Promise<void> {
  await db.runAsync('DELETE FROM app_meta WHERE key = ?', [key]);
}

export async function getMetaJson<T>(key: MetaKey, db: Db = getDb()): Promise<T | null> {
  const raw = await getMeta(key, db);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setMetaJson(key: MetaKey, value: unknown, db: Db = getDb()): Promise<void> {
  await setMeta(key, JSON.stringify(value), db);
}
