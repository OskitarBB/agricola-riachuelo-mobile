// src/api/deletionApi.ts — Fotos y sesiones borradas por el administrador (GET /api/v1/mobile/deleted-captures).
//
// QUÉ HACE: pide a la plataforma Django (v1.3.1, limpieza de fotos) la lista de fotos y sesiones que el
// ADMINISTRADOR eliminó para siempre después de `since` (el `cursor` de la respuesta anterior). La app borra su copia
// local de cada una (src/sync/deletionService.ts). Solo lectura; no envía datos del celular.

import type { DeletedCapturesResponse } from './dto';
import { apiRequest } from './httpClient';

export interface DeletionApi {
  list(accessToken: string, deviceId: string, since: string | null, timeoutMs: number): Promise<DeletedCapturesResponse>;
}

export const realDeletionApi: DeletionApi = {
  list: (accessToken, deviceId, since, timeoutMs) =>
    apiRequest<DeletedCapturesResponse>(
      `/mobile/deleted-captures${since ? `?since=${encodeURIComponent(since)}` : ''}`,
      { accessToken, deviceId, timeoutMs },
    ),
};
