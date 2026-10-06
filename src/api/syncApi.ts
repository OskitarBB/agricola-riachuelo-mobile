// src/api/syncApi.ts — Sincronización de datos con la plataforma Django (maestro v2.0 §15.2 y §15.5).
//
// QUÉ HACE: una función por endpoint JSON, todas idempotentes por ID (repetir no duplica y responde lo mismo).
// Devuelven ApiCallResult (nunca lanzan) para que src/sync/syncService.ts clasifique cada fallo (retry.ts):
//  - upsertSession: POST /sessions                         (201 nueva · 200 actualizada; CLOSED nunca se reabre)
//  - upsertPass:    POST /sessions/{id}/passes             (acepta actualizar pasadas ya recibidas: fotos tardías)
//  - sequenceBatch: POST /sessions/{id}/sequences/batch    (≤ sync.batchSize = 200 por petición)
//  - incidentBatch: POST /sessions/{id}/incidents/batch    (≤ 200 por petición)
// Las fotos van por uploadApi.ts (ticket) + cloudinaryUpload.ts (subida directa) + uploadApi.confirm (v2.0).

import type {
  BatchResponse,
  IncidentBatchRequest,
  PassUpsertRequest,
  PassUpsertResponse,
  SequenceBatchRequest,
  SessionUpsertRequest,
  SessionUpsertResponse,
} from './dto';
import { apiCall, type ApiCallResult } from './httpClient';

export interface SyncApi {
  upsertSession(req: SessionUpsertRequest, token: string, deviceId: string, timeoutMs: number): Promise<ApiCallResult<SessionUpsertResponse>>;
  upsertPass(
    sessionId: string,
    req: PassUpsertRequest,
    token: string,
    deviceId: string,
    timeoutMs: number,
  ): Promise<ApiCallResult<PassUpsertResponse>>;
  sequenceBatch(req: SequenceBatchRequest, token: string, deviceId: string, timeoutMs: number): Promise<ApiCallResult<BatchResponse>>;
  incidentBatch(req: IncidentBatchRequest, token: string, deviceId: string, timeoutMs: number): Promise<ApiCallResult<BatchResponse>>;
}

export const realSyncApi: SyncApi = {
  upsertSession: (req, token, deviceId, timeoutMs) =>
    apiCall<SessionUpsertResponse>('/sessions', { method: 'POST', body: req, accessToken: token, deviceId, timeoutMs }),
  upsertPass: (sessionId, req, token, deviceId, timeoutMs) =>
    apiCall<PassUpsertResponse>(`/sessions/${sessionId}/passes`, {
      method: 'POST',
      body: req,
      accessToken: token,
      deviceId,
      timeoutMs,
    }),
  sequenceBatch: (req, token, deviceId, timeoutMs) =>
    apiCall<BatchResponse>(`/sessions/${req.sessionId}/sequences/batch`, {
      method: 'POST',
      body: req,
      accessToken: token,
      deviceId,
      timeoutMs,
    }),
  incidentBatch: (req, token, deviceId, timeoutMs) =>
    apiCall<BatchResponse>(`/sessions/${req.sessionId}/incidents/batch`, {
      method: 'POST',
      body: req,
      accessToken: token,
      deviceId,
      timeoutMs,
    }),
};
