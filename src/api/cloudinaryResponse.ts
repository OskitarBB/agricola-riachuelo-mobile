// src/api/cloudinaryResponse.ts — Interpretación pura de la respuesta de Cloudinary (v2.0, sección 15.7).
// Sin red ni Expo: se prueba con Jest (Anexo E.8, __tests__/captureUploader.test.ts). La usa cloudinaryUpload.ts.
// Copia exacta del bloque 15.7.1 del maestro v2.0.
import { z } from 'zod';

import type { CloudinaryUploadResult } from './dto';

export type CloudinaryUploadOutcome =
  | { ok: true; result: CloudinaryUploadResult }
  | { ok: false; networkError: true }
  | { ok: false; networkError: false; status: number; message: string | null };

/** Campos de la respuesta de la Upload API de Cloudinary que la app usa; el resto se ignora. */
const cloudinaryResponseSchema = z.object({
  public_id: z.string().min(1),
  version: z.number().int().positive(),
  signature: z.string().min(1),
  bytes: z.number().int().positive(),
  format: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  etag: z.string().optional(),
  existing: z.boolean().optional(),
});

/** Forma de los errores de la Upload API: { "error": { "message": "…" } }. */
const cloudinaryErrorSchema = z.object({ error: z.object({ message: z.string() }) });

/**
 * Convierte la respuesta HTTP de Cloudinary en un resultado.
 * - 2xx con el esquema correcto y el mismo public_id del ticket → ok.
 * - 2xx con otra forma → message 'RESPUESTA_INVALIDA'; 2xx con otro public_id → 'PUBLIC_ID_DISTINTO'.
 * - Otro estado → message = texto de error de Cloudinary (o null si no viene).
 */
export function parseCloudinaryResponse(status: number, body: string, expectedPublicId: string): CloudinaryUploadOutcome {
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  if (status >= 200 && status < 300) {
    const parsed = cloudinaryResponseSchema.safeParse(json);
    if (!parsed.success) return { ok: false, networkError: false, status, message: 'RESPUESTA_INVALIDA' };
    const d = parsed.data;
    if (d.public_id !== expectedPublicId) return { ok: false, networkError: false, status, message: 'PUBLIC_ID_DISTINTO' };
    return {
      ok: true,
      result: {
        publicId: d.public_id,
        version: d.version,
        signature: d.signature,
        bytes: d.bytes,
        format: d.format ?? null,
        width: d.width ?? null,
        height: d.height ?? null,
        etag: d.etag ?? null,
        existing: d.existing ?? false,
      },
    };
  }
  const err = cloudinaryErrorSchema.safeParse(json);
  return { ok: false, networkError: false, status, message: err.success ? err.data.error.message : null };
}
