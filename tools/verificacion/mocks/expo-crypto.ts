// tools/verificacion/mocks/expo-crypto.ts — expo-crypto con node:crypto (solo pruebas de verificación).
import { createHash, randomBytes, randomUUID as uuid } from 'node:crypto';
export const randomUUID = (): string => uuid();
export const getRandomBytes = (n: number): Uint8Array => new Uint8Array(randomBytes(n));
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256', MD5: 'MD5', SHA1: 'SHA-1' } as const;
export const CryptoEncoding = { HEX: 'hex', BASE64: 'base64' } as const;
export async function digestStringAsync(alg: string, data: string, opts?: { encoding?: string }): Promise<string> {
  const a = alg.replace('-', '').toLowerCase();
  return createHash(a === 'sha256' ? 'sha256' : a).update(data).digest(opts?.encoding === 'base64' ? 'base64' : 'hex');
}
