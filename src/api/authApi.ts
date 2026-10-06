// src/api/authApi.ts — Endpoints de autenticación de la plataforma Django /api/v1/auth/* (maestro §7 y §15.2).
//
// QUÉ HACE: una función por endpoint. No guarda nada: authService decide qué hacer con la respuesta.
// El backend simulado (src/api/mock/mockBackend.ts) implementa esta MISMA interfaz (AuthApi).
// Django emite el JWT con SimpleJWT (access 15 min, refresh 14 días con rotación y lista negra, D-28).

import type {
  ChangePasswordRequest,
  HealthResponse,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  PasswordResetRequest,
  RefreshRequest,
  RefreshResponse,
  RegisterRequest,
  RegisterResponse,
} from './dto';
import { apiRequest } from './httpClient';

export interface AuthApi {
  health(): Promise<HealthResponse>;
  register(req: RegisterRequest, deviceId: string): Promise<RegisterResponse>;
  login(req: LoginRequest): Promise<LoginResponse>;
  refresh(req: RefreshRequest): Promise<RefreshResponse>;
  logout(req: LogoutRequest): Promise<void>;
  changePassword(req: ChangePasswordRequest, accessToken: string, deviceId: string): Promise<void>;
  requestPasswordReset(req: PasswordResetRequest, deviceId: string): Promise<void>;
}

export const realAuthApi: AuthApi = {
  health: () => apiRequest<HealthResponse>('/health', { timeoutMs: 6_000 }),
  register: (req, deviceId) => apiRequest<RegisterResponse>('/auth/register', { method: 'POST', body: req, deviceId }),
  login: (req) => apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: req, deviceId: req.device.deviceId }),
  refresh: (req) => apiRequest<RefreshResponse>('/auth/refresh', { method: 'POST', body: req, deviceId: req.deviceId }),
  logout: (req) => apiRequest<void>('/auth/logout', { method: 'POST', body: req, deviceId: req.deviceId }),
  changePassword: (req, accessToken, deviceId) =>
    apiRequest<void>('/auth/change-password', { method: 'POST', body: req, accessToken, deviceId }),
  requestPasswordReset: (req, deviceId) =>
    apiRequest<void>('/auth/password-reset-requests', { method: 'POST', body: req, deviceId }),
};
