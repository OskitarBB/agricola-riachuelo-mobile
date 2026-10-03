// src/storage/secureStore.ts — Acceso tipado a SecureStore (maestro §12.3).
//
// QUÉ HACE: guarda SOLO secretos o datos sensibles pequeños (≤ 2048 bytes por valor; claves con letras,
// números, ".", "-" y "_"). Tokens, verificador sin internet y token del QR van aquí; nunca en SQLite,
// logs ni diagnósticos (regla R-10).

import * as SecureStore from 'expo-secure-store';

export const SECURE_KEYS = {
  deviceId: 'device.id',
  userId: 'auth.userId',
  accessToken: 'auth.accessToken',
  accessTokenExpiresAt: 'auth.accessTokenExpiresAt',
  refreshToken: 'auth.refreshToken',
  refreshTokenExpiresAt: 'auth.refreshTokenExpiresAt',
  offlineVerifier: 'auth.offlineVerifier',
  mode: 'auth.mode',
  pairingToken: 'pairing.token',
} as const;

export type SecureKey = (typeof SECURE_KEYS)[keyof typeof SECURE_KEYS];

const MAX_VALUE_BYTES = 2048;

export async function secureGet(key: SecureKey): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function secureSet(key: SecureKey, value: string): Promise<void> {
  // Un JWT de más de 2 KB no cabe (pregunta Q-06 para el backend).
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
    throw new Error(`Valor demasiado grande para SecureStore (${key})`);
  }
  await SecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: SecureKey): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Si no existía, no hay nada que borrar.
  }
}

export async function secureDeleteMany(keys: SecureKey[]): Promise<void> {
  for (const k of keys) await secureDelete(k);
}
