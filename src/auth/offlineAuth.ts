// src/auth/offlineAuth.ts — Verificador local para iniciar sesión sin internet (RN-03, RN-20). Maestro Anexo C.1.
//
// QUÉ HACE: tras un login CON internet se deriva un verificador PBKDF2-HMAC-SHA256 de la contraseña
// (sal aleatoria de 16 bytes, N iteraciones, 32 bytes) y se guarda en SecureStore ("auth.offlineVerifier").
// La contraseña NUNCA se guarda. Sin internet, se vuelve a derivar y se compara en tiempo constante.

import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';

import type { AccountStatus, UserRole } from '../domain/types';
import { MOBILE_ALLOWED_ROLES } from '../domain/types';

export interface OfflineVerifier {
  v: 1;
  userId: string;
  email: string; // normalizado: trim + minúsculas
  saltB64: string;
  iterations: number;
  hashB64: string; // PBKDF2-HMAC-SHA256, 32 bytes
}

/** Datos no secretos del último login online (SQLite, tabla app_meta / users_cache). */
export interface OfflineAuthRecord {
  userId: string;
  email: string;
  roles: UserRole[];
  accountStatus: AccountStatus;
  mustChangePassword: boolean;
  lastOnlineAuthAt: string; // ISO
  failedAttempts: number;
  lockedUntil: string | null; // ISO
}

export type OfflineDenyReason =
  | 'SIN_VERIFICADOR'
  | 'OTRO_USUARIO'
  | 'VENCIDO'
  | 'BLOQUEADO_TEMPORAL'
  | 'CUENTA_NO_ACTIVA'
  | 'ROL_NO_PERMITIDO'
  | 'CAMBIO_CONTRASENA_PENDIENTE';

export type OfflineDecision = { allowed: true } | { allowed: false; reason: OfflineDenyReason; until?: string };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('base64 inválido');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, new TextEncoder().encode(password), salt, { c: iterations, dkLen: 32 });
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Crear SOLO tras un login online exitoso con mustChangePassword = false (RN-04). */
export async function createVerifier(
  password: string,
  user: { userId: string; email: string },
  iterations: number,
  randomBytes: (n: number) => Uint8Array, // en la app: Crypto.getRandomBytes
): Promise<OfflineVerifier> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, iterations);
  return {
    v: 1,
    userId: user.userId,
    email: normalizeEmail(user.email),
    saltB64: bytesToBase64(salt),
    iterations,
    hashB64: bytesToBase64(hash),
  };
}

export async function verifyPassword(password: string, verifier: OfflineVerifier): Promise<boolean> {
  const hash = await derive(password, base64ToBytes(verifier.saltB64), verifier.iterations);
  return constantTimeEqual(hash, base64ToBytes(verifier.hashB64));
}

/** Reglas previas a pedir la verificación (no revela si la contraseña es correcta). */
export function canAttemptOfflineLogin(
  record: OfflineAuthRecord | null,
  verifier: OfflineVerifier | null,
  email: string,
  now: Date,
  cfg: { offlineLoginMaxDays: number },
): OfflineDecision {
  if (!record || !verifier) return { allowed: false, reason: 'SIN_VERIFICADOR' };
  if (normalizeEmail(email) !== verifier.email || record.userId !== verifier.userId) {
    return { allowed: false, reason: 'OTRO_USUARIO' };
  }
  if (record.lockedUntil && new Date(record.lockedUntil).getTime() > now.getTime()) {
    return { allowed: false, reason: 'BLOQUEADO_TEMPORAL', until: record.lockedUntil };
  }
  if (record.accountStatus !== 'ACTIVO') return { allowed: false, reason: 'CUENTA_NO_ACTIVA' };
  if (!record.roles.some((r) => MOBILE_ALLOWED_ROLES.includes(r))) return { allowed: false, reason: 'ROL_NO_PERMITIDO' };
  if (record.mustChangePassword) return { allowed: false, reason: 'CAMBIO_CONTRASENA_PENDIENTE' };
  const until = new Date(new Date(record.lastOnlineAuthAt).getTime() + cfg.offlineLoginMaxDays * 86_400_000);
  if (now.getTime() > until.getTime()) return { allowed: false, reason: 'VENCIDO', until: until.toISOString() };
  return { allowed: true };
}

export function registerFailedOfflineAttempt(
  record: OfflineAuthRecord,
  now: Date,
  cfg: { offlineMaxFailedAttempts: number; offlineLockoutMinutes: number },
): OfflineAuthRecord {
  const failedAttempts = record.failedAttempts + 1;
  if (failedAttempts >= cfg.offlineMaxFailedAttempts) {
    const lockedUntil = new Date(now.getTime() + cfg.offlineLockoutMinutes * 60_000).toISOString();
    return { ...record, failedAttempts: 0, lockedUntil };
  }
  return { ...record, failedAttempts };
}

export function registerSuccessfulOfflineLogin(record: OfflineAuthRecord): OfflineAuthRecord {
  return { ...record, failedAttempts: 0, lockedUntil: null };
}

export function offlineValidUntil(lastOnlineAuthAt: string, offlineLoginMaxDays: number): string {
  return new Date(new Date(lastOnlineAuthAt).getTime() + offlineLoginMaxDays * 86_400_000).toISOString();
}
