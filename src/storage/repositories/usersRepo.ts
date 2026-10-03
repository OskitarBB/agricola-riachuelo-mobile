// src/storage/repositories/usersRepo.ts — Tabla users_cache (datos NO secretos del último login).
//
// QUÉ HACE: guarda el perfil del usuario que inició sesión con internet en este celular. Se usa para
// el login sin internet (RN-03), para la cabecera y para el PAIR_REQUEST de las cámaras.
// La contraseña y los tokens NUNCA se guardan aquí (van en SecureStore o no se guardan).

import type { AccountStatus, UserProfile, UserRole } from '../../domain/types';
import { nowIso } from '../../domain/time';
import { getDb, type Db } from '../db';

interface UserRow {
  user_id: string;
  email: string;
  full_name: string;
  roles_json: string;
  account_status: AccountStatus;
  must_change_password: number;
  last_online_auth_at: string | null;
}

export interface CachedUser extends UserProfile {
  lastOnlineAuthAt: string | null;
}

function toDomain(r: UserRow): CachedUser {
  let roles: UserRole[] = [];
  try {
    roles = JSON.parse(r.roles_json) as UserRole[];
  } catch {
    roles = [];
  }
  return {
    id: r.user_id,
    email: r.email,
    fullName: r.full_name,
    roles,
    status: r.account_status,
    mustChangePassword: r.must_change_password === 1,
    lastOnlineAuthAt: r.last_online_auth_at,
  };
}

export async function upsertUser(user: UserProfile, lastOnlineAuthAt: string | null, db: Db = getDb()): Promise<void> {
  await db.runAsync(
    `INSERT INTO users_cache (user_id, email, full_name, roles_json, account_status, must_change_password, last_online_auth_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, full_name = excluded.full_name,
       roles_json = excluded.roles_json, account_status = excluded.account_status,
       must_change_password = excluded.must_change_password,
       last_online_auth_at = COALESCE(excluded.last_online_auth_at, users_cache.last_online_auth_at),
       updated_at = excluded.updated_at`,
    [
      user.id,
      user.email.trim().toLowerCase(),
      user.fullName,
      JSON.stringify(user.roles),
      user.status,
      user.mustChangePassword ? 1 : 0,
      lastOnlineAuthAt,
      nowIso(),
    ],
  );
}

export async function getUser(userId: string, db: Db = getDb()): Promise<CachedUser | null> {
  const r = await db.getFirstAsync<UserRow>('SELECT * FROM users_cache WHERE user_id = ?', [userId]);
  return r ? toDomain(r) : null;
}

export async function setMustChangePassword(userId: string, value: boolean, db: Db = getDb()): Promise<void> {
  await db.runAsync('UPDATE users_cache SET must_change_password = ?, updated_at = ? WHERE user_id = ?', [
    value ? 1 : 0,
    nowIso(),
    userId,
  ]);
}
