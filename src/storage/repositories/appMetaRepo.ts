// src/storage/repositories/appMetaRepo.ts — Tabla app_meta (clave/valor no secreto).
//
// QUÉ HACE: guarda datos de configuración del celular que no son secretos: device_id, device_role,
// catalog_version, bootstrap_at, offline_failed_attempts, offline_locked_until, short_test_pending, etc.
// Claves agregadas en esta versión (Supuesto S-05): ui_sounds, ui_haptics (preferencias de interfaz).

import { getDb, type Db } from '../db';

export type MetaKey =
  | 'device_id'
  | 'device_role'
  | 'catalog_version'
  | 'bootstrap_at'
  | 'config_version'
  | 'quality_profile_version'
  | 'offline_failed_attempts'
  | 'offline_locked_until'
  | 'short_test_pending'
  | 'last_online_user_id'
  | 'ui_sounds'
  | 'ui_haptics';

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
