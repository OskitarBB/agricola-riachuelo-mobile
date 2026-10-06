// src/api/uploadApi.ts — Ticket de subida y confirmación de capturas en Django (maestro v2.0 §15.2 y §15.7).
//
// QUÉ HACE (todas las funciones devuelven ApiCallResult; nunca lanzan):
//  - requestTicket():  POST /captures/{captureId}/upload-ticket  → parámetros firmados para subir UNA foto.
//  - confirm():        POST /captures/upload (JSON)               → metadatos + resultado de Cloudinary (v2.0).
//  - uploadMultipart(): POST /captures/upload (multipart file + metadata) → forma v1 que Django todavía acepta con
//    API_SUBIDA_MULTIPART=true (ADR-W-003 de la plataforma). Se usa solo si CONFIG.sync.uploadMode = 'MULTIPART'.
//  - captureStatus():  GET /captures/{captureId}                  → diagnóstico (sin URL ni resultados de IA).
// El archivo de la foto NUNCA pasa por aquí en v2.0: lo sube cloudinaryUpload.ts directo a Cloudinary.

import { File, UploadType } from 'expo-file-system';

import type {
  CaptureConfirmRequest,
  CaptureStatusResponse,
  CaptureUploadMetadata,
  CaptureUploadResponse,
  UploadTicketRequest,
  UploadTicketResponse,
} from './dto';
import { apiBaseUrl, apiCall, apiHeaders, errorFromResponse, toCallResult, type ApiCallResult } from './httpClient';
import type { UploadProgressInfo } from './cloudinaryUpload';

export interface UploadApi {
  requestTicket(
    req: UploadTicketRequest,
    token: string,
    deviceId: string,
    timeoutMs: number,
  ): Promise<ApiCallResult<UploadTicketResponse>>;
  confirm(req: CaptureConfirmRequest, token: string, deviceId: string, timeoutMs: number): Promise<ApiCallResult<CaptureUploadResponse>>;
  uploadMultipart(
    fileUri: string,
    meta: CaptureUploadMetadata,
    token: string,
    deviceId: string,
    timeoutMs: number,
    onProgress?: (p: UploadProgressInfo) => void,
  ): Promise<ApiCallResult<CaptureUploadResponse>>;
  captureStatus(captureId: string, token: string, deviceId: string): Promise<ApiCallResult<CaptureStatusResponse>>;
}

export const realUploadApi: UploadApi = {
  requestTicket: (req, token, deviceId, timeoutMs) =>
    apiCall<UploadTicketResponse>(`/captures/${req.captureId}/upload-ticket`, {
      method: 'POST',
      body: req,
      accessToken: token,
      deviceId,
      timeoutMs,
    }),
  confirm: (req, token, deviceId, timeoutMs) =>
    apiCall<CaptureUploadResponse>('/captures/upload', { method: 'POST', body: req, accessToken: token, deviceId, timeoutMs }),
  uploadMultipart: async (fileUri, meta, token, deviceId, timeoutMs, onProgress) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await new File(fileUri).upload(`${apiBaseUrl()}/captures/upload`, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'image/jpeg',
        parameters: { metadata: JSON.stringify(meta) },
        headers: apiHeaders({ accessToken: token, deviceId }),
        sessionType: 'foreground',
        onProgress: onProgress ? (p) => onProgress({ bytesSent: p.bytesSent, totalBytes: p.totalBytes }) : undefined,
        signal: controller.signal,
      });
      if (res.status >= 200 && res.status < 300) {
        try {
          return { ok: true, status: res.status, data: JSON.parse(res.body) as CaptureUploadResponse };
        } catch {
          return { ok: false, networkError: false, status: res.status, code: undefined, message: 'RESPUESTA_NO_JSON' };
        }
      }
      return toCallResult<CaptureUploadResponse>(errorFromResponse(res.status, res.body));
    } catch {
      return { ok: false, networkError: true };
    } finally {
      clearTimeout(timer);
    }
  },
  captureStatus: (captureId, token, deviceId) =>
    apiCall<CaptureStatusResponse>(`/captures/${captureId}`, { accessToken: token, deviceId }),
};
