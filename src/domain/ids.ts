// src/domain/ids.ts — Generación de identificadores (R-13: IDs con Crypto.randomUUID()).
//
// QUÉ HACE: centraliza la creación de UUID y tokens aleatorios. El dominio recibe la función por
// inyección (setIdProvider) para que las pruebas unitarias no dependan de módulos nativos de Expo.

export type IdProvider = () => string;

let provider: IdProvider = fallbackUuid;

/** Inyecta el generador real (expo-crypto) al arrancar la app: setIdProvider(Crypto.randomUUID). */
export function setIdProvider(p: IdProvider): void {
  provider = p;
}

/** Nuevo UUID v4 en minúsculas. */
export function newId(): string {
  return provider().toLowerCase();
}

/** Respaldo SOLO para pruebas o si el módulo nativo no está disponible (no criptográficamente fuerte). */
function fallbackUuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

/** Bytes → base64url sin relleno (token del QR, maestro §14.2). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63] + alphabet[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + alphabet[(n >> 6) & 63];
  }
  return out;
}
