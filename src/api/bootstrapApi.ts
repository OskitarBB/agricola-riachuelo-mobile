// src/api/bootstrapApi.ts — Descarga de catálogos y parámetros (GET /api/v1/mobile/bootstrap, RF-15).
//
// La plataforma Django arma esta respuesta desde Supabase (lotes, hileras, segmentos y marcadores administrados en
// la web, más el perfil de calidad publicado). Si publica qualityProfile, la app lo aplica (applyQualityProfile).

import type { BootstrapResponse } from './dto';
import { apiRequest } from './httpClient';

export interface BootstrapApi {
  bootstrap(accessToken: string, deviceId: string): Promise<BootstrapResponse>;
}

export const realBootstrapApi: BootstrapApi = {
  bootstrap: (accessToken, deviceId) =>
    apiRequest<BootstrapResponse>('/mobile/bootstrap', { accessToken, deviceId, timeoutMs: 60_000 }),
};
