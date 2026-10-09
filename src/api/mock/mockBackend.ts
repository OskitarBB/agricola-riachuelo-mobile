// src/api/mock/mockBackend.ts — Backend SIMULADO con el mismo contrato que la plataforma Django (maestro §15.6).
//
// QUÉ HACE: implementa AuthApi, BootstrapApi, SyncApi, UploadApi y PestApi en memoria, con latencia y tasa de fallos
// configurables. Se activa con EXPO_PUBLIC_USE_MOCK_API=1 (o si no hay EXPO_PUBLIC_API_URL).
//  - Si el celular no tiene internet (expo-network), responde como "sin red" → se prueba el login sin internet.
//  - Cuentas de prueba (contraseña Demo2026 salvo indicación):
//      operador@demo.pe   ACTIVO, OPERADOR_CAMPO
//      admin@demo.pe      ACTIVO, ADMINISTRADOR
//      pendiente@demo.pe  PENDIENTE_APROBACION
//      bloqueado@demo.pe  BLOQUEADO
//      temporal@demo.pe   / Temp2026 → obliga a cambiar la contraseña (mustChangePassword)
//      supervisor@demo.pe SUPERVISOR → ROLE_NOT_ALLOWED
//      especialista@demo.pe ESPECIALISTA_FITOSANITARIO → solo «Ubicar plaga» (sincronizar → ROLE_NOT_ALLOWED)
//  - Los tokens simulados se autovalidan (llevan userId y vencimiento) para sobrevivir reinicios de la app.
//  - Sincronización (v2.0): recuerda sesiones, pasadas y secuencias recibidas para responder SESSION_NOT_FOUND,
//    PASS_NOT_FOUND o SEQUENCE_NOT_FOUND como el servidor real (la memoria se pierde al reiniciar la app: así se
//    prueba el reenvío de padres, §15.5 paso 8). Ticket con url 'mock://cloudinary/upload' (mockCloudinary.ts),
//    confirmación que acepta cualquier firma no vacía y responde UPLOAD_MISMATCH si bytes ≠ sizeBytes.
//  - Las capturas confirmadas guardan solo captureId, md5 y tamaño (duplicados y conflictos).
// Es solo para desarrollo y demostraciones: el APK del piloto usa la plataforma real (eas.json, perfil piloto).

import * as Network from 'expo-network';

import { canDoFieldWork, MOBILE_ALLOWED_ROLES, type AccountStatus, type UserProfile, type UserRole } from '../../domain/types';
import type { AuthApi } from '../authApi';
import type { BootstrapApi } from '../bootstrapApi';
import type { DeletionApi } from '../deletionApi';
import type { ApiErrorCode, LoginResponse } from '../dto';
import { ApiError, toCallResult, type ApiCallResult } from '../httpClient';
import type { PestApi } from '../pestApi';
import type { SyncApi } from '../syncApi';
import type { UploadApi } from '../uploadApi';
import { buildMockBootstrap } from './mockCatalog';
import { buildMockPestReports } from './mockPests';

interface MockUser {
  profile: UserProfile;
  password: string;
}

const LATENCY_MS: [number, number] = [250, 650];
const ACCESS_TTL_MS = 15 * 60_000; // como SimpleJWT en la plataforma (15 min)
const REFRESH_TTL_MS = 14 * 86_400_000;
const TICKET_TTL_MS = 3_600_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
    user(
      '6f7a8b9c-0d1e-4f2a-3b4c-5d6e7f8a9b0c',
      'Especialista Fitosanitario',
      'especialista@demo.pe',
      ['ESPECIALISTA_FITOSANITARIO'],
      'ACTIVO',
      'Demo2026',
    ),
  ].map((u) => [u.profile.email, u]),
);

// Estado de la "plataforma" simulada (solo en memoria).
const sessions = new Map<string, string>(); // sessionId → status
const passes = new Map<string, { sessionId: string; lateral: string }>(); // passId → sesión y lateral
const sequences = new Map<string, string>(); // sequenceId → passId
const incidents = new Set<string>();
const confirmed = new Map<string, { md5: string; sizeBytes: number }>(); // captureId → archivo

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
  throw new ApiError('HTTP', status, code, fieldErrors, `mock-${Date.now().toString(36)}`);
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

function requireUser(token: string): MockUser {
  const u = userFromToken(token, 'mock');
  if (!u) fail(401, 'TOKEN_EXPIRED');
  checkAccess(u);
  return u;
}

/** Monitoreo y sincronización: como api.permissions.FieldWork de la plataforma (el especialista no sincroniza). */
function requireFieldUser(token: string): MockUser {
  const u = requireUser(token);
  if (!canDoFieldWork(u.profile.roles)) fail(403, 'ROLE_NOT_ALLOWED');
  return u;
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
      fail(400, 'PASSWORD_POLICY', [{ field: 'newPassword', message: 'Debe incluir letras y números (8 o más).' }]);
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
    requireUser(accessToken);
    return buildMockBootstrap(new Date().toISOString());
  },
};

export const mockPestApi: PestApi = {
  async list(accessToken, _deviceId, days) {
    await requireInternet();
    requireUser(accessToken);
    return buildMockPestReports(Math.max(1, Math.min(Math.round(days), 90)));
  },
};

/** v0.5.1: el backend simulado nunca borra fotos (la limpieza la hace el administrador en la web real). */
export const mockDeletionApi: DeletionApi = {
  async list(accessToken, _deviceId, since) {
    await requireInternet();
    requireUser(accessToken);
    return { captures: [], sessionIds: [], cursor: since, hasMore: false, serverTime: new Date().toISOString() };
  },
};

async function maybeFail(): Promise<void> {
  await requireInternet();
  if (Math.random() < failureRate) fail(503, 'INTERNAL_ERROR');
}

/** Ejecuta la lógica simulada y devuelve ApiCallResult como el cliente real. */
async function call<T>(status: number, fn: () => T | Promise<T>): Promise<ApiCallResult<T>> {
  try {
    await maybeFail();
    return { ok: true, status, data: await fn() };
  } catch (err) {
    return toCallResult<T>(err);
  }
}

function requireSession(sessionId: string): void {
  if (!sessions.has(sessionId)) fail(404, 'SESSION_NOT_FOUND');
}

export const mockSyncApi: SyncApi = {
  upsertSession: (req, token) =>
    call(sessions.has(req.sessionId) ? 200 : 201, () => {
      requireFieldUser(token);
      const prev = sessions.get(req.sessionId);
      const status = prev === 'CLOSED' ? 'CLOSED' : req.status; // una sesión CLOSED no se reabre
      sessions.set(req.sessionId, status);
      return { sessionId: req.sessionId, status };
    }),
  upsertPass: (sessionId, req, token) =>
    call(passes.has(req.passId) ? 200 : 201, () => {
      requireFieldUser(token);
      requireSession(sessionId);
      passes.set(req.passId, { sessionId, lateral: req.lateralCode });
      return { passId: req.passId, status: req.status };
    }),
  sequenceBatch: (req, token) =>
    call(200, () => {
      requireFieldUser(token);
      requireSession(req.sessionId);
      let accepted = 0;
      let duplicates = 0;
      for (const s of req.sequences) {
        if (!passes.has(s.passId)) fail(404, 'PASS_NOT_FOUND');
        if (sequences.has(s.sequenceId)) duplicates += 1;
        else accepted += 1;
        sequences.set(s.sequenceId, s.passId);
      }
      return { accepted, duplicates };
    }),
  incidentBatch: (req, token) =>
    call(200, () => {
      requireFieldUser(token);
      requireSession(req.sessionId);
      let accepted = 0;
      let duplicates = 0;
      for (const i of req.incidents) {
        if (i.passId && !passes.has(i.passId)) fail(404, 'PASS_NOT_FOUND');
        if (i.sequenceId && !sequences.has(i.sequenceId)) fail(404, 'SEQUENCE_NOT_FOUND');
        if (incidents.has(i.incidentId)) duplicates += 1;
        else accepted += 1;
        incidents.add(i.incidentId);
      }
      return { accepted, duplicates };
    }),
};

function checkParents(sessionId: string, passId: string, sequenceId: string): void {
  requireSession(sessionId);
  const p = passes.get(passId);
  if (!p || p.sessionId !== sessionId) fail(404, 'PASS_NOT_FOUND');
  if (sequences.get(sequenceId) !== passId) fail(404, 'SEQUENCE_NOT_FOUND');
}

export const mockUploadApi: UploadApi = {
  requestTicket: (req, token) =>
    call(200, () => {
      requireFieldUser(token);
      checkParents(req.sessionId, req.passId, req.sequenceId);
      const prev = confirmed.get(req.captureId);
      const serverTime = new Date().toISOString();
      if (prev) {
        if (prev.md5 !== req.md5.toLowerCase() || prev.sizeBytes !== req.sizeBytes) fail(409, 'CAPTURE_CONFLICT');
        return { captureId: req.captureId, alreadyConfirmed: true, upload: null, serverTime };
      }
      if (req.sizeBytes > MAX_UPLOAD_BYTES) fail(413, 'PAYLOAD_TOO_LARGE');
      const publicId = `riachuelo/dev/${req.sessionId}/${req.passId}/${req.captureId}`;
      return {
        captureId: req.captureId,
        alreadyConfirmed: false,
        upload: {
          url: 'mock://cloudinary/upload',
          fields: {
            api_key: 'mock',
            timestamp: String(Math.floor(Date.now() / 1000)),
            public_id: publicId,
            type: 'authenticated',
            overwrite: 'false',
            signature: 'mock',
            x_size_bytes: String(req.sizeBytes),
          },
          publicId,
          expiresAt: new Date(Date.parse(serverTime) + TICKET_TTL_MS).toISOString(),
          maxBytes: MAX_UPLOAD_BYTES,
        },
        serverTime,
      };
    }),
  confirm: (req, token) =>
    call(confirmed.has(req.metadata.captureId) ? 200 : 201, () => {
      requireFieldUser(token);
      const m = req.metadata;
      checkParents(m.sessionId, m.passId, m.sequenceId);
      const prev = confirmed.get(m.captureId);
      if (prev) {
        if (prev.md5 !== m.md5.toLowerCase() || prev.sizeBytes !== m.sizeBytes) fail(409, 'CAPTURE_CONFLICT');
        return { captureId: m.captureId, status: 'SINCRONIZADO' as const, duplicate: true };
      }
      if (passes.get(m.passId)?.lateral !== m.lateralCode)
        fail(400, 'VALIDATION_ERROR', [{ field: 'metadata.lateralCode', message: 'No coincide con el lateral de la pasada.' }]);
      if (!req.cloudinary.signature) fail(422, 'UPLOAD_SIGNATURE_INVALID');
      const expectedId = `riachuelo/dev/${m.sessionId}/${m.passId}/${m.captureId}`;
      if (req.cloudinary.publicId !== expectedId || req.cloudinary.bytes !== m.sizeBytes) fail(409, 'UPLOAD_MISMATCH');
      confirmed.set(m.captureId, { md5: m.md5.toLowerCase(), sizeBytes: m.sizeBytes });
      return { captureId: m.captureId, status: 'SINCRONIZADO' as const, duplicate: false };
    }),
  uploadMultipart: (_fileUri, meta, token) =>
    call(confirmed.has(meta.captureId) ? 200 : 201, () => {
      requireFieldUser(token);
      checkParents(meta.sessionId, meta.passId, meta.sequenceId);
      const prev = confirmed.get(meta.captureId);
      if (prev && (prev.md5 !== meta.md5.toLowerCase() || prev.sizeBytes !== meta.sizeBytes)) fail(409, 'CAPTURE_CONFLICT');
      if (meta.sizeBytes > MAX_UPLOAD_BYTES) fail(413, 'PAYLOAD_TOO_LARGE');
      confirmed.set(meta.captureId, { md5: meta.md5.toLowerCase(), sizeBytes: meta.sizeBytes });
      return { captureId: meta.captureId, status: 'SINCRONIZADO' as const, duplicate: prev !== undefined };
    }),
  captureStatus: (captureId, token) =>
    call(200, () => {
      requireFieldUser(token);
      const c = confirmed.get(captureId);
      if (!c) fail(404, 'NOT_FOUND');
      return {
        captureId,
        status: 'SINCRONIZADO' as const,
        sessionId: '',
        passId: '',
        sequenceId: '',
        sizeBytes: c.sizeBytes,
        md5: c.md5,
        confirmedAt: new Date().toISOString(),
      };
    }),
};

/** Cuentas de prueba visibles en la pantalla de login (solo con backend simulado). */
export const DEMO_ACCOUNTS: readonly { email: string; password: string; label: string }[] = [
  { email: 'operador@demo.pe', password: 'Demo2026', label: 'Operador' },
  { email: 'admin@demo.pe', password: 'Demo2026', label: 'Administrador' },
  { email: 'temporal@demo.pe', password: 'Temp2026', label: 'Temporal' },
];
