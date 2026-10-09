// src/api/pestApi.ts — Alertas de plaga con ubicación (GET /api/v1/mobile/pest-reports, plataforma v1.3; ADR 0009).
//
// QUÉ HACE: pide a la plataforma Django los casos que el encargado debe ir a ver (confirmados por la IA o por el
// especialista, posibles plagas y en revisión) de los últimos `days` días, con su ubicación, una miniatura firmada y
// las capas del fundo (contornos de lotes, hileras y puntos con nombre). Lo pueden pedir el operador, el administrador
// y el especialista fitosanitario.

import type { PestReportsResponse } from './dto';
import { apiRequest } from './httpClient';

export interface PestApi {
  list(accessToken: string, deviceId: string, days: number, timeoutMs: number): Promise<PestReportsResponse>;
}

export const realPestApi: PestApi = {
  list: (accessToken, deviceId, days, timeoutMs) =>
    apiRequest<PestReportsResponse>(`/mobile/pest-reports?days=${Math.round(days)}`, { accessToken, deviceId, timeoutMs }),
};
