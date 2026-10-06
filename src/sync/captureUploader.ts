// src/sync/captureUploader.ts — Sincroniza UNA captura en tres pasos: ticket, subida directa a Cloudinary y
// confirmación en Django (v2.0, sección 15.7). Lógica pura con dependencias inyectadas: syncService.ts le pasa la
// base de datos (remote_uploads, captures, sync_queue), el cliente de la API y la función de subida.
// Copia del bloque 15.7.3 del maestro v2.0 (sin cambios de comportamiento; pruebas del Anexo E.8).
import type {
  ApiErrorCode,
  CaptureConfirmRequest,
  CaptureUploadMetadata,
  CaptureUploadResponse,
  CloudinaryUploadResult,
  UploadTicket,
  UploadTicketRequest,
  UploadTicketResponse,
} from '../api/dto';
import type { CloudinaryUploadOutcome } from '../api/cloudinaryResponse';
import { classifyCloudinaryError, classifySyncError, type SyncErrorClass } from './retry';

/** Resultado de una llamada a la API de Django (lo produce httpClient.ts). */
export type ApiCallResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; networkError: boolean; status?: number; code?: ApiErrorCode };

export type RemoteUploadStatus = 'SUBIDA' | 'CONFIRMADA' | 'DESCARTADA';

/** Fila de remote_uploads (12.1.1) vista por esta lógica. */
export interface StoredUpload {
  status: RemoteUploadStatus;
  result: CloudinaryUploadResult;
  reuploadCount: number;
}

export interface CaptureUploaderDeps {
  getStoredUpload(captureId: string): Promise<StoredUpload | null>;
  /** Escribe o reescribe remote_uploads con status SUBIDA (en la misma transacción que el intento de sync_queue). */
  saveUploaded(captureId: string, result: CloudinaryUploadResult, reuploadCount: number): Promise<void>;
  /** remote_uploads CONFIRMADA + captures SINCRONIZADO + sync_queue HECHO, en una transacción. */
  markConfirmed(captureId: string, duplicate: boolean): Promise<void>;
  /** El ticket dijo alreadyConfirmed: captures SINCRONIZADO + sync_queue HECHO (sin fila nueva en remote_uploads). */
  markAlreadyConfirmed(captureId: string): Promise<void>;
  /** remote_uploads DESCARTADA con el código; la captura vuelve a PENDIENTE_NUBE. */
  markDiscarded(captureId: string, code: string): Promise<void>;
  requestTicket(req: UploadTicketRequest): Promise<ApiCallResult<UploadTicketResponse>>;
  upload(upload: UploadTicket, fileUri: string): Promise<CloudinaryUploadOutcome>;
  confirm(req: CaptureConfirmRequest): Promise<ApiCallResult<CaptureUploadResponse>>;
}

/** Valores de CONFIG.sync (sección 17). */
export interface CaptureUploaderConfig {
  maxUploadBytes: number;
  maxReuploads: number;
  ticketMinRemainingMs: number;
  maxTicketRequests: number;
}

export type CaptureSyncStep = 'TICKET' | 'SUBIDA' | 'CONFIRMACION';

export type CaptureSyncOutcome =
  | { kind: 'HECHO'; uploaded: boolean; duplicate: boolean }
  | { kind: Exclude<SyncErrorClass, 'NUEVO_TICKET'>; step: CaptureSyncStep; code: string | null };

type UploadStep =
  | { kind: 'OK'; result: CloudinaryUploadResult }
  | { kind: 'YA_CONFIRMADA' }
  | { kind: 'FALLA'; outcome: CaptureSyncOutcome };

/** Pide ticket(s) y sube la foto. Un ticket casi vencido o rechazado por Cloudinary se reemplaza (hasta maxTicketRequests). */
async function ticketAndUpload(
  meta: CaptureUploadMetadata,
  fileUri: string,
  deps: CaptureUploaderDeps,
  cfg: CaptureUploaderConfig,
): Promise<UploadStep> {
  for (let i = 0; i < cfg.maxTicketRequests; i++) {
    const t = await deps.requestTicket({
      captureId: meta.captureId,
      sessionId: meta.sessionId,
      passId: meta.passId,
      sequenceId: meta.sequenceId,
      sizeBytes: meta.sizeBytes,
      md5: meta.md5,
      mimeType: 'image/jpeg',
    });
    if (!t.ok) {
      const cls = classifySyncError(t);
      const kind = cls === 'NUEVO_TICKET' || cls === 'REPETIR_SUBIDA' ? 'REINTENTAR' : cls;
      return { kind: 'FALLA', outcome: { kind, step: 'TICKET', code: t.code ?? null } };
    }
    if (t.data.alreadyConfirmed) return { kind: 'YA_CONFIRMADA' };
    const upload = t.data.upload;
    if (upload === null) return { kind: 'FALLA', outcome: { kind: 'DEFINITIVO', step: 'TICKET', code: 'TICKET_INVALIDO' } };
    if (meta.sizeBytes > upload.maxBytes) {
      return { kind: 'FALLA', outcome: { kind: 'DEFINITIVO', step: 'SUBIDA', code: 'FOTO_DEMASIADO_GRANDE' } };
    }
    // Vigencia medida con relojes del servidor (expiresAt y serverTime): no depende de la hora del celular.
    const remainingMs = Date.parse(upload.expiresAt) - Date.parse(t.data.serverTime);
    if (!(remainingMs >= cfg.ticketMinRemainingMs)) continue; // casi vencido o fechas inválidas: pedir otro
    const out = await deps.upload(upload, fileUri);
    if (out.ok) return { kind: 'OK', result: out.result };
    const { cls, code } = classifyCloudinaryError(out);
    if (cls === 'NUEVO_TICKET') continue;
    return { kind: 'FALLA', outcome: { kind: cls, step: 'SUBIDA', code } };
  }
  return { kind: 'FALLA', outcome: { kind: 'REINTENTAR', step: 'TICKET', code: 'TICKETS_AGOTADOS' } };
}

/**
 * Sincroniza una captura de evidencia (elemento CAPTURE de sync_queue).
 * - Si ya está CONFIRMADA en remote_uploads: HECHO sin llamadas.
 * - Si está SUBIDA: solo confirma (no vuelve a subir: RF-50, RF-51).
 * - Si no hay fila o está DESCARTADA: ticket → subida → guarda SUBIDA → confirma.
 * El llamador traduce el resultado a sync_queue y captures según 15.5.
 */
export async function syncCapture(
  meta: CaptureUploadMetadata,
  fileUri: string,
  deps: CaptureUploaderDeps,
  cfg: CaptureUploaderConfig,
): Promise<CaptureSyncOutcome> {
  if (meta.sizeBytes > cfg.maxUploadBytes) return { kind: 'DEFINITIVO', step: 'SUBIDA', code: 'FOTO_DEMASIADO_GRANDE' };
  let stored = await deps.getStoredUpload(meta.captureId);
  if (stored !== null && stored.status === 'CONFIRMADA') return { kind: 'HECHO', uploaded: false, duplicate: true };
  let uploaded = false;
  if (stored === null || stored.status === 'DESCARTADA') {
    const reuploadCount = stored === null ? 0 : stored.reuploadCount + 1;
    if (reuploadCount > cfg.maxReuploads) {
      return { kind: 'DEFINITIVO', step: 'SUBIDA', code: 'REINTENTOS_DE_SUBIDA_AGOTADOS' };
    }
    const step = await ticketAndUpload(meta, fileUri, deps, cfg);
    if (step.kind === 'YA_CONFIRMADA') {
      await deps.markAlreadyConfirmed(meta.captureId);
      return { kind: 'HECHO', uploaded: false, duplicate: true };
    }
    if (step.kind === 'FALLA') return step.outcome;
    await deps.saveUploaded(meta.captureId, step.result, reuploadCount);
    stored = { status: 'SUBIDA', result: step.result, reuploadCount };
    uploaded = true;
  }
  const r = stored.result;
  const res = await deps.confirm({
    metadata: meta,
    cloudinary: {
      publicId: r.publicId,
      version: r.version,
      signature: r.signature,
      bytes: r.bytes,
      format: r.format,
      width: r.width,
      height: r.height,
      etag: r.etag,
    },
  });
  if (res.ok) {
    await deps.markConfirmed(meta.captureId, res.data.duplicate);
    return { kind: 'HECHO', uploaded, duplicate: res.data.duplicate };
  }
  const cls = classifySyncError(res);
  if (cls === 'REPETIR_SUBIDA') await deps.markDiscarded(meta.captureId, res.code ?? 'UPLOAD_REJECTED');
  return { kind: cls === 'NUEVO_TICKET' ? 'REINTENTAR' : cls, step: 'CONFIRMACION', code: res.code ?? null };
}
