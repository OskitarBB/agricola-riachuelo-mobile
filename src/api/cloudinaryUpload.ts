// src/api/cloudinaryUpload.ts — Subida directa de una foto a Cloudinary con el ticket firmado por Django (v2.0, 15.7).
// Único archivo de la app que habla con Cloudinary. No calcula firmas ni conoce el API secret (R-18, R-21).
//
// Adaptación al SDK 57 (el maestro v2.0 usa createUploadTask de expo-file-system/legacy del SDK 54): se usa la API
// nueva File.upload() de expo-file-system, que también envía el archivo de forma NATIVA (no pasa por la memoria de
// JavaScript, D-22) y acepta un AbortSignal para el tiempo agotado. Mismo comportamiento que el bloque 15.7.2:
//  - multipart con `file` + los `fields` del ticket TAL CUAL (no se agregan, quitan ni reordenan: invalidaría la firma);
//  - SIN cabeceras Authorization ni X-Device-Id (Cloudinary no es la API del proyecto);
//  - el original sin recomprimir (RN-24);
//  - tiempo agotado → error de red (la cola reintenta con el mismo public_id: overwrite = false lo hace idempotente).
// En desarrollo sin CLOUDINARY_URL, ticket.url apunta al Cloudinary SIMULADO de la laptop (misma firma del SDK).

import { File, UploadType } from 'expo-file-system';

import { parseCloudinaryResponse, type CloudinaryUploadOutcome } from './cloudinaryResponse';
import type { UploadTicket } from './dto';

export interface UploadProgressInfo {
  bytesSent: number;
  totalBytes: number;
}

/**
 * Sube el archivo original (sin recomprimir, RN-24) con los campos del ticket, tal cual llegan.
 * timeoutMs = CONFIG.sync.uploadRequestTimeoutMs; si se supera, la subida se cancela y se informa como error de red.
 */
export async function uploadToCloudinary(
  upload: UploadTicket,
  fileUri: string,
  timeoutMs: number,
  onProgress?: (p: UploadProgressInfo) => void,
): Promise<CloudinaryUploadOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await new File(fileUri).upload(upload.url, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
      parameters: { ...upload.fields },
      // iOS: sesión en primer plano (R-19). El resultado se necesita en JavaScript para guardar remote_uploads.
      sessionType: 'foreground',
      onProgress: onProgress ? (p) => onProgress({ bytesSent: p.bytesSent, totalBytes: p.totalBytes }) : undefined,
      signal: controller.signal,
    });
    return parseCloudinaryResponse(res.status, res.body, upload.publicId);
  } catch {
    // Sin conexión, conexión cortada, cancelada por tiempo agotado o archivo no legible.
    return { ok: false, networkError: true };
  } finally {
    clearTimeout(timer);
  }
}
