// src/auth/tokenStore.ts — Tokens de acceso/renovación en SecureStore (maestro §7.4, §7.8, §12.3).
//
// QUÉ HACE: guarda, lee y borra el par de tokens y el modo de acceso. Nunca los escribe en logs.

import type { TokenBundle } from '../api/dto';
import type { AuthMode } from '../domain/types';
import { SECURE_KEYS, secureDelete, secureDeleteMany, secureGet, secureSet } from '../storage/secureStore';

/** Orden al guardar (maestro §0.5): primero los tokens, al final el usuario y el modo. */
export async function saveTokens(t: TokenBundle, userId: string): Promise<void> {
  await secureSet(SECURE_KEYS.accessToken, t.accessToken);
  await secureSet(SECURE_KEYS.accessTokenExpiresAt, t.accessTokenExpiresAt);
  await secureSet(SECURE_KEYS.refreshToken, t.refreshToken);
  await secureSet(SECURE_KEYS.refreshTokenExpiresAt, t.refreshTokenExpiresAt);
  await secureSet(SECURE_KEYS.userId, userId);
  await secureSet(SECURE_KEYS.mode, 'ONLINE');
}

export async function loadTokens(): Promise<TokenBundle | null> {
  const [accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt] = await Promise.all([
    secureGet(SECURE_KEYS.accessToken),
    secureGet(SECURE_KEYS.accessTokenExpiresAt),
    secureGet(SECURE_KEYS.refreshToken),
    secureGet(SECURE_KEYS.refreshTokenExpiresAt),
  ]);
  if (!accessToken || !accessTokenExpiresAt || !refreshToken || !refreshTokenExpiresAt) return null;
  return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt };
}

/** Cerrar sesión: borra tokens (el verificador sin internet se conserva; 7.8). */
export async function clearTokens(): Promise<void> {
  await secureDeleteMany([
    SECURE_KEYS.accessToken,
    SECURE_KEYS.accessTokenExpiresAt,
    SECURE_KEYS.refreshToken,
    SECURE_KEYS.refreshTokenExpiresAt,
    SECURE_KEYS.userId,
    SECURE_KEYS.mode,
  ]);
}

export async function setAuthMode(mode: AuthMode, userId: string): Promise<void> {
  await secureSet(SECURE_KEYS.userId, userId);
  await secureSet(SECURE_KEYS.mode, mode);
}

export async function loadAuthPointer(): Promise<{ userId: string | null; mode: AuthMode | null }> {
  const [userId, mode] = await Promise.all([secureGet(SECURE_KEYS.userId), secureGet(SECURE_KEYS.mode)]);
  return { userId, mode: mode === 'ONLINE' || mode === 'OFFLINE' ? mode : null };
}

export async function loadVerifierJson(): Promise<string | null> {
  return secureGet(SECURE_KEYS.offlineVerifier);
}

export async function saveVerifierJson(json: string): Promise<void> {
  await secureSet(SECURE_KEYS.offlineVerifier, json);
}

export async function deleteVerifier(): Promise<void> {
  await secureDelete(SECURE_KEYS.offlineVerifier);
}
