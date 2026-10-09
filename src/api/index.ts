// src/api/index.ts — Punto único para obtener las APIs (real o simulada).
//
// QUÉ HACE: según ENV.useMockApi devuelve el backend simulado (desarrollo y demostración) o el cliente real de la
// plataforma Django /api/v1 (piloto). Los servicios importan SIEMPRE desde aquí; así el cambio de backend no toca
// ninguna pantalla. La subida a Cloudinary también se elige aquí (simulada o real).

import { ENV } from '../config';
import { realAuthApi, type AuthApi } from './authApi';
import { realBootstrapApi, type BootstrapApi } from './bootstrapApi';
import { uploadToCloudinary } from './cloudinaryUpload';
import { mockAuthApi, mockBootstrapApi, mockPestApi, mockSyncApi, mockUploadApi } from './mock/mockBackend';
import { mockUploadToCloudinary } from './mock/mockCloudinary';
import { realPestApi, type PestApi } from './pestApi';
import { realSyncApi, type SyncApi } from './syncApi';
import { realUploadApi, type UploadApi } from './uploadApi';

export const authApi: AuthApi = ENV.useMockApi ? mockAuthApi : realAuthApi;
export const bootstrapApi: BootstrapApi = ENV.useMockApi ? mockBootstrapApi : realBootstrapApi;
export const syncApi: SyncApi = ENV.useMockApi ? mockSyncApi : realSyncApi;
export const uploadApi: UploadApi = ENV.useMockApi ? mockUploadApi : realUploadApi;
/** «Ubicar plaga» (ADR 0009): alertas con ubicación y capas del fundo. */
export const pestApi: PestApi = ENV.useMockApi ? mockPestApi : realPestApi;
/** Subida directa de una foto con el ticket (real: Cloudinary; simulado: en memoria). */
export const cloudUpload: typeof uploadToCloudinary = ENV.useMockApi
  ? (ticket, fileUri) => mockUploadToCloudinary(ticket, fileUri)
  : uploadToCloudinary;

export { ApiError } from './httpClient';
