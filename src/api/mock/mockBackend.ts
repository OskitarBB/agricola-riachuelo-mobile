// src/api/mock/mockBackend.ts — Backend SIMULADO con el mismo contrato que Spring Boot (maestro §15.6).
//
// QUÉ HACE: implementa AuthApi, BootstrapApi y SyncApi en memoria, con latencia y tasa de fallos
// configurables. Se activa con EXPO_PUBLIC_USE_MOCK_API=1 (o si no hay EXPO_PUBLIC_API_URL).
//  - Si el celular no tiene internet (expo-network), responde como "sin red" → se prueba el login sin internet.
//  - Cuentas de prueba (contraseña Demo2026 salvo indicación):
//      operador@demo.pe   ACTIVO, OPERADOR_CAMPO
//      admin@demo.pe      ACTIVO, ADMINISTRADOR
//      pendiente@demo.pe  PENDIENTE_APROBACION
//      bloqueado@demo.pe  BLOQUEADO
//      temporal@demo.pe   / Temp2026 → obliga a cambiar la contraseña (mustChangePassword)
//      supervisor@demo.pe SUPERVISOR → ROLE_NOT_ALLOWED
//  - Los tokens simulados se autovalidan (llevan userId y vencimiento) para sobrevivir reinicios de la app.
//  - Las subidas simuladas guardan solo captureId y md5 para probar duplicados y conflictos.
//
// ESTE ARCHIVO SE ELIMINA (o queda solo para pruebas) cuando el backend real esté disponible.

import * as Network from 'expo-network';

import { MOBILE_ALLOWED_ROLES, type AccountStatus, type UserProfile, type UserRole } from '../../domain/types';
import type { AuthApi } from '../authApi';
import type { BootstrapApi } from '../bootstrapApi';
import type { ApiErrorCode, LoginResponse } from '../dto';
import { ApiError } from '../httpClient';
import type { SyncApi } from '../syncApi';
import { buildMockBootstrap } from './mockCatalog';

interface MockUser {
  profile: UserProfile;
  password: string;
}

const LATENCY_MS: [number, number] = [250, 650];
const ACCESS_TTL_MS = 30 * 60_000;
const REFRESH_TTL_MS = 14 * 86_400_000;

function user(
  id: string,
  fullName: string,
  email: string,
  roles: UserRole[],
  status: AccountStatus,
  password: string,
  mustChange = false,
): MockUser {
  return { profile: { id, fullName, email, roles, status, mustChangePassword: mustChange }, password };
}

const users = new Map<string, MockUser>(
  [
    user(
      '9d1e0f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a',
      'Operador de Campo',
      'operador@demo.pe',
      ['OPERADOR_CAMPO'],
      'ACTIVO',
      'Demo2026',
    ),
    user(
      '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      'Administrador Riachuelo',
      'admin@demo.pe',
      ['ADMINISTRADOR'],
      'ACTIVO',
      'Demo2026',
    ),
    user(
      '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
      'Usuario Pendiente',
      'pendiente@demo.pe',
      ['OPERADOR_CAMPO'],
      'PENDIENTE_APROBACION',
      'Demo2026',
    ),
    user(
      '3c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f',
      'Usuario Bloqueado',
      'bloqueado@demo.pe',
      ['OPERADOR_CAMPO'],
      'BLOQUEADO',
      'Demo2026',
    ),
    user(
      '4d5e6f7a-8b9c-4d0e-1f2a-3b4c5d6e7f8a',
      'Usuario Temporal',
      'temporal@demo.pe',
      ['OPERADOR_CAMPO'],
      'ACTIVO',
      'Temp2026',
      true,
    ),
    user('5e6f7a8b-9c0d-4e1f-2a3b-4c5d6e7f8a9b', 'Supervisor Web', 'supervisor@demo.pe', ['SUPERVISOR'], 'ACTIVO', 'Demo2026'),
  ].map((u) => [u.profile.email, u]),
);

const uploads = new Map<string, string>(); // captureId → md5

/** Probabilidad de fallo 5xx simulado en sincronización (0 por defecto). */
let failureRate = 0;
export function setMockFailureRate(rate: number): void {
  failureRate = Math.max(0, Math.min(1, rate));
}

async function delay(): Promise<void> {
  const ms = LATENCY_MS[0] + Math.random() * (LATENCY_MS[1] - LATENCY_MS[0]);
  await new Promise((r) => setTimeout(r, ms));
}

/** Simula "sin internet" cuando el celular no tiene conexión a internet. */
async function requireInternet(): Promise<void> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) throw new ApiError('NETWORK', undefined, undefined);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Si no se puede consultar el estado, se asume que hay red.
  }
  await delay();
}

function fail(status: number, code: ApiErrorCode, fieldErrors: { field: string; message: string }[] = []): never {
  throw new ApiError('HTTP', status, code, fieldErrors);
}

function makeTokens(u: UserProfile): LoginResponse {
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return {
    accessToken: `mock.${u.id}.${now + ACCESS_TTL_MS}.${rand}`,
    accessTokenExpiresAt: new Date(now + ACCESS_TTL_MS).toISOString(),
    refreshToken: `mockr.${u.id}.${now + REFRESH_TTL_MS}.${rand}`,
    refreshTokenExpiresAt: new Date(now + REFRESH_TTL_MS).toISOString(),
    user: { ...u },
    serverTime: new Date(now).toISOString(),
  };
}

function userFromToken(token: string, prefix: 'mock' | 'mockr'): MockUser | null {
  const [p, userId, exp] = token.split('.');
  if (p !== prefix || Number(exp) < Date.now()) return null;
  for (const u of users.values()) if (u.profile.id === userId) return u;
  return null;
}

function checkAccess(u: MockUser): void {
  const s = u.profile.status;
  if (s === 'PENDIENTE_APROBACION') fail(403, 'ACCOUNT_PENDING');
  if (s === 'RECHAZADO') fail(403, 'ACCOUNT_REJECTED');
  if (s === 'BLOQUEADO') fail(403, 'ACCOUNT_BLOCKED');
  if (!u.profile.roles.some((r) => MOBILE_ALLOWED_ROLES.includes(r))) fail(403, 'ROLE_NOT_ALLOWED');
}

export const mockAuthApi: AuthApi = {
  async health() {
    await requireInternet();
    return { status: 'UP', serverTime: new Date().toISOString() };
  },
  async register(req) {
    await requireInternet();
    const email = req.email.trim().toLowerCase();
    if (users.has(email)) fail(409, 'EMAIL_ALREADY_REGISTERED', [{ field: 'email', message: 'Ese correo ya tiene una cuenta.' }]);
    const id = `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
    users.set(email, user(id, req.fullName.trim(), email, ['OPERADOR_CAMPO'], 'PENDIENTE_APROBACION', req.password));
    return { userId: id, status: 'PENDIENTE_APROBACION' };
  },
  async login(req) {
    await requireInternet();
    const u = users.get(req.email.trim().toLowerCase());
    if (!u || u.password !== req.password) fail(401, 'INVALID_CREDENTIALS');
    checkAccess(u);
    return makeTokens(u.profile);
  },
  async refresh(req) {
    await requireInternet();
    const u = userFromToken(req.refreshToken, 'mockr');
    if (!u) fail(401, 'REFRESH_INVALID');
    checkAccess(u);
    return makeTokens(u.profile);
  },
  async logout() {
    await requireInternet();
  },
  async changePassword(req, accessToken) {
    await requireInternet();
    const u = userFromToken(accessToken, 'mock');
    if (!u) fail(401, 'TOKEN_EXPIRED');
    if (u.password !== req.currentPassword) fail(401, 'INVALID_CREDENTIALS');
    if (req.newPassword.length < 8 || !/\d/.test(req.newPassword) || !/[A-Za-z]/.test(req.newPassword))
      fail(400, 'PASSWORD_POLICY');
    u.password = req.newPassword;
    u.profile.mustChangePassword = false;
  },
  async requestPasswordReset() {
    await requireInternet();
    // Siempre 202: no revela si el correo existe.
  },
};

export const mockBootstrapApi: BootstrapApi = {
  async bootstrap(accessToken) {
    await requireInternet();
    if (!userFromToken(accessToken, 'mock')) fail(401, 'TOKEN_EXPIRED');
    return buildMockBootstrap(new Date().toISOString());
  },
};

async function maybeFail(): Promise<void> {
  await requireInternet();
  if (Math.random() < failureRate) fail(503, 'INTERNAL_ERROR');
}

export const mockSyncApi: SyncApi = {
  async upsertSession() {
    await maybeFail();
  },
  async upsertPass() {
    await maybeFail();
  },
  async sequenceBatch(req) {
    await maybeFail();
    return { accepted: req.sequences.length, duplicates: 0 };
  },
  async incidentBatch(req) {
    await maybeFail();
    return { accepted: req.incidents.length, duplicates: 0 };
  },
  async uploadCapture(_fileUri, meta) {
    await maybeFail();
    const prev = uploads.get(meta.captureId);
    if (prev && prev !== meta.md5) fail(409, 'CAPTURE_CONFLICT');
    uploads.set(meta.captureId, meta.md5);
    return { captureId: meta.captureId, status: 'SINCRONIZADO', duplicate: prev !== undefined };
  },
};

/** Cuentas de prueba visibles en la pantalla de login (solo con backend simulado). */
export const DEMO_ACCOUNTS: readonly { email: string; password: string; label: string }[] = [
  { email: 'operador@demo.pe', password: 'Demo2026', label: 'Operador' },
  { email: 'admin@demo.pe', password: 'Demo2026', label: 'Administrador' },
  { email: 'temporal@demo.pe', password: 'Temp2026', label: 'Temporal' },
];
