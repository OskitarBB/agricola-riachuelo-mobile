// src/api/index.ts — Punto único para obtener las APIs (real o simulada).
//
// QUÉ HACE: según ENV.useMockApi devuelve el backend simulado (Fase 1) o el cliente real (Fase 4).
// Los servicios importan SIEMPRE desde aquí; así el cambio de backend no toca ninguna pantalla.

import { ENV } from '../config';
import { realAuthApi, type AuthApi } from './authApi';
import { realBootstrapApi, type BootstrapApi } from './bootstrapApi';
import { mockAuthApi, mockBootstrapApi, mockSyncApi } from './mock/mockBackend';
import { realSyncApi, type SyncApi } from './syncApi';

export const authApi: AuthApi = ENV.useMockApi ? mockAuthApi : realAuthApi;
export const bootstrapApi: BootstrapApi = ENV.useMockApi ? mockBootstrapApi : realBootstrapApi;
export const syncApi: SyncApi = ENV.useMockApi ? mockSyncApi : realSyncApi;

export { ApiError } from './httpClient';
