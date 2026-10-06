// src/api/mock/mockCloudinary.ts — Cloudinary SIMULADO para el backend simulado (maestro v2.0 §15.6).
//
// QUÉ HACE: reemplaza a uploadToCloudinary cuando ENV.useMockApi es verdadero. No sube nada: guarda publicId y
// bytes en memoria y responde con la forma de la Upload API (15.4): { public_id, version, signature, bytes, … },
// con existing: true si el public_id ya estaba (overwrite = false). Permite simular los errores de 15.7 regla 7:
// "Stale request", "Invalid Signature", "File size too large", 503 y tiempo agotado (red).
// Solo lee el TAMAÑO del archivo (no su contenido) para devolver `bytes` como lo haría Cloudinary.

import { File } from 'expo-file-system';

import { parseCloudinaryResponse, type CloudinaryUploadOutcome } from '../cloudinaryResponse';
import type { UploadTicket } from '../dto';

export type MockCloudinaryFailure = 'STALE' | 'INVALID_SIGNATURE' | 'TOO_LARGE' | 'UNAVAILABLE' | 'TIMEOUT';

const stored = new Map<string, { bytes: number; version: number }>();
let pendingFailures: MockCloudinaryFailure[] = [];

/** Las próximas `times` subidas fallan con `kind` (herramienta de prueba en Expo Go). */
export function setMockCloudinaryFailure(kind: MockCloudinaryFailure | null, times = 1): void {
  pendingFailures = kind ? Array.from({ length: Math.max(1, times) }, () => kind) : [];
}

function fileSize(uri: string): number {
  try {
    const f = new File(uri);
    return f.exists ? f.size : 0;
  } catch {
    return 0;
  }
}

function errorBody(message: string): string {
  return JSON.stringify({ error: { message } });
}

export async function mockUploadToCloudinary(upload: UploadTicket, fileUri: string): Promise<CloudinaryUploadOutcome> {
  await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
  const failure = pendingFailures.shift();
  if (failure === 'TIMEOUT') return { ok: false, networkError: true };
  if (failure === 'UNAVAILABLE') return parseCloudinaryResponse(503, '', upload.publicId);
  if (failure === 'STALE')
    return parseCloudinaryResponse(400, errorBody('Stale request - reported time is 1 which is out of the allowed range'), upload.publicId);
  if (failure === 'INVALID_SIGNATURE')
    return parseCloudinaryResponse(401, errorBody('Invalid Signature 0000. String to sign - simulated.'), upload.publicId);
  if (failure === 'TOO_LARGE')
    return parseCloudinaryResponse(400, errorBody('File size too large. Got 12000000. Maximum is 10485760.'), upload.publicId);

  const publicId = upload.fields.public_id ?? upload.publicId;
  const prev = stored.get(publicId);
  // El ticket simulado trae el tamaño esperado (x_size_bytes) por si el archivo no se puede medir.
  const bytes = prev?.bytes ?? (fileSize(fileUri) || Number(upload.fields.x_size_bytes) || 1);
  const version = prev?.version ?? Math.floor(Date.now() / 1000);
  if (!prev) stored.set(publicId, { bytes, version });
  const body = JSON.stringify({
    public_id: publicId,
    version,
    signature: `mock-${version}`,
    bytes,
    format: 'jpg',
    type: 'authenticated',
    existing: prev !== undefined,
  });
  return parseCloudinaryResponse(200, body, upload.publicId);
}
