// src/api/syncApi.ts — Endpoints de sincronización con Spring Boot (maestro §15.2 y §15.5).
//
// ESTADO: contrato definido; la cola que los usa (src/sync/syncService.ts) se completa en la Fase 4.
// INTEGRACIÓN FUTURA:
//  - upsertSession / upsertPass / sequenceBatch / incidentBatch: JSON idempotente por ID.
//  - uploadCapture: multipart nativo con File.upload (expo-file-system), una foto a la vez; el backend
//    la guarda en S3 y sus metadatos en PostgreSQL. Idempotente por captureId (duplicate: true).

import { File, UploadType } from 'expo-file-system';

import type {
  ApiErrorCode,
  BatchResponse,
  CaptureUploadMetadata,
  CaptureUploadResponse,
  IncidentBatchRequest,
  PassUpsertRequest,
  SequenceBatchRequest,
  SessionUpsertRequest,
} from './dto';
import { ApiError, apiBaseUrl, apiRequest } from './httpClient';

export interface SyncApi {
  upsertSession(req: SessionUpsertRequest, token: string, deviceId: string): Promise<void>;
  upsertPass(sessionId: string, req: PassUpsertRequest, token: string, deviceId: string): Promise<void>;
  sequenceBatch(req: SequenceBatchRequest, token: string, deviceId: string): Promise<BatchResponse>;
  incidentBatch(req: IncidentBatchRequest, token: string, deviceId: string): Promise<BatchResponse>;
  uploadCapture(fileUri: string, meta: CaptureUploadMetadata, token: string, deviceId: string): Promise<CaptureUploadResponse>;
}

export const realSyncApi: SyncApi = {
  upsertSession: (req, token, deviceId) =>
    apiRequest<void>('/sessions', { method: 'POST', body: req, accessToken: token, deviceId }),
  upsertPass: (sessionId, req, token, deviceId) =>
    apiRequest<void>(`/sessions/${sessionId}/passes`, { method: 'POST', body: req, accessToken: token, deviceId }),
  sequenceBatch: (req, token, deviceId) =>
    apiRequest<BatchResponse>(`/sessions/${req.sessionId}/sequences/batch`, {
      method: 'POST',
      body: req,
      accessToken: token,
      deviceId,
    }),
  incidentBatch: (req, token, deviceId) =>
    apiRequest<BatchResponse>(`/sessions/${req.sessionId}/incidents/batch`, {
      method: 'POST',
      body: req,
      accessToken: token,
      deviceId,
    }),
  uploadCapture: async (fileUri, meta, token, deviceId) => {
    try {
      const res = await new File(fileUri).upload(`${apiBaseUrl()}/captures/upload`, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'image/jpeg',
        parameters: { metadata: JSON.stringify(meta) },
        headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId },
      });
      if (res.status >= 200 && res.status < 300) return JSON.parse(res.body) as CaptureUploadResponse;
      let code: ApiErrorCode | undefined;
      try {
        code = (JSON.parse(res.body) as { code?: ApiErrorCode }).code;
      } catch {
        code = undefined;
      }
      throw new ApiError('HTTP', res.status, code);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('NETWORK', undefined, undefined);
    }
  },
};
