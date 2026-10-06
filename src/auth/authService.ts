// src/auth/authService.ts — Inicio de sesión con y sin internet, renovación, cierre y revocación.
// Maestro §7.4 (online), §7.5 (offline), §7.6 (contraseña temporal), §7.8 (cierre/revocación), §7.11 (reabrir).
//
// QUÉ HACE (resumen):
//  - login(): intenta con internet; si NO hay respuesta del servidor, intenta automáticamente sin internet.
//  - Con internet OK: guarda tokens (SecureStore), usuario (users_cache) y crea el verificador PBKDF2
//    para entrar sin internet hasta 7 días (salvo contraseña temporal: RN-04).
//  - Todo login correcto desde PANT-02 (con o sin internet) marca roleChoicePending: la app pasa por PANT-08
//    para elegir la función del celular (ADR 0005). restoreSession() y reauthenticate() no la marcan.
//  - restoreSession(): al abrir la app decide AUTENTICADO (ONLINE/OFFLINE) o SIN_SESION (tabla de 7.11).
//  - getAccessToken(): renueva el token si vence pronto (refreshMarginSeconds, medido con la HORA DEL SERVIDOR);
//    ante REFRESH_INVALID, ACCOUNT_BLOCKED, ACCOUNT_PENDING, ACCOUNT_REJECTED, DEVICE_REVOKED o ROLE_NOT_ALLOWED aplica
//    la revocación (borra tokens y verificador, conserva datos de campo).
//  - refreshAccessToken(): UNA sola renovación a la vez. Django rota el refresh y pone el anterior en la lista negra
//    (SimpleJWT, D-28): dos renovaciones simultáneas con el mismo refresh harían que la segunda reciba REFRESH_INVALID y
//    la app cerrara la sesión sin motivo. Por eso los llamadores comparten la misma petición en curso.
//  - callWithToken(): llama a la API con un token vigente y, ante 401 TOKEN_EXPIRED, renueva una vez y repite
//    (clase RENOVAR_TOKEN del Anexo C.3).
//  - noteServerTime(): guarda la diferencia entre la hora del servidor (serverTime de login, refresh, health y
//    bootstrap) y la del celular; un celular con la hora mal puesta no debe usar tokens vencidos ni renovarlos de más.
//  - logout(): bloqueado si hay una sesión de monitoreo abierta (RN-19).
//
// Backend real: la plataforma Django /api/v1 (src/api/index.ts elige el cliente real o el simulado).

import * as Crypto from 'expo-crypto';

import { ApiError, authApi } from '../api';
import type { ApiErrorCode, LoginResponse } from '../api/dto';
import { CONFIG } from '../config';
import { canLogout } from '../domain/rules';
import { nowIso, nowMs } from '../domain/time';
import { MOBILE_ALLOWED_ROLES, type AuthStatus, type UserProfile } from '../domain/types';
import { deviceInfoDto, getDeviceIdentity } from '../device/deviceIdentity';
import { logEvent } from '../diagnostics/eventLog';
import { getMeta, setMeta } from '../storage/repositories/appMetaRepo';
import { getUser, setMustChangePassword, upsertUser } from '../storage/repositories/usersRepo';
import { useAppSession } from './authStore';
import {
  canAttemptOfflineLogin,
  createVerifier,
  normalizeEmail,
  offlineValidUntil,
  registerFailedOfflineAttempt,
  registerSuccessfulOfflineLogin,
  verifyPassword,
  type OfflineAuthRecord,
  type OfflineVerifier,
} from './offlineAuth';
import {
  clearTokens,
  deleteVerifier,
  loadAuthPointer,
  loadTokens,
  loadVerifierJson,
  saveTokens,
  saveVerifierJson,
  setAuthMode,
} from './tokenStore';

export type AuthResult =
  | { ok: true; status: AuthStatus; mode: 'ONLINE' | 'OFFLINE' }
  | { ok: false; code: string; until?: string; fieldErrors?: { field: string; message: string }[] };

/**
 * Códigos que significan "esta sesión ya no vale": se revoca (7.8). ACCOUNT_PENDING y ACCOUNT_REJECTED los responde
 * Django (ensure_app_access) si el administrador cambió el estado de la cuenta después del login.
 */
export const REVOKE_CODES: readonly ApiErrorCode[] = [
  'REFRESH_INVALID',
  'ACCOUNT_BLOCKED',
  'ACCOUNT_PENDING',
  'ACCOUNT_REJECTED',
  'DEVICE_REVOKED',
  'ROLE_NOT_ALLOWED',
];

// ------------------------------------------------------------------ hora del servidor

/** Hora del servidor − hora del celular (ms). Se mide en cada respuesta con serverTime. */
let clockOffsetMs = 0;

/** Hora del servidor estimada. Los vencimientos que emite Django se comparan contra ella. */
export function serverNowMs(): number {
  return nowMs() + clockOffsetMs;
}

export function getClockOffsetMs(): number {
  return clockOffsetMs;
}

/** Registra la hora del servidor de una respuesta (login, refresh, health, bootstrap). */
export function noteServerTime(serverTime: string | null | undefined): void {
  const t = serverTime ? Date.parse(serverTime) : Number.NaN;
  if (!Number.isFinite(t)) return;
  const offset = Math.round(t - nowMs());
  const changed = Math.abs(offset - clockOffsetMs) > 1_000;
  clockOffsetMs = offset;
  if (!changed) return;
  if (Math.abs(offset) > CONFIG.auth.clockSkewWarnSeconds * 1000) {
    logEvent('WARN', 'NET', 'SERVER_CLOCK_OFFSET', { offsetMs: offset });
  }
  setMeta('server_clock_offset_ms', String(offset)).catch(() => undefined);
}

/** Al arrancar (src/boot.ts): último desfase conocido, útil aunque no haya internet. */
export async function loadClockOffset(): Promise<void> {
  const raw = await getMeta('server_clock_offset_ms');
  const n = raw === null ? Number.NaN : Number(raw);
  if (Number.isFinite(n)) clockOffsetMs = n;
}

/** Callback opcional para mostrar "Preparando acceso sin internet…" mientras se deriva el verificador. */
export type PhaseListener = (phase: 'CONNECTING' | 'PREPARING_OFFLINE' | 'CHECKING_OFFLINE') => void;

// ------------------------------------------------------------------ login con internet (7.4)

/**
 * `askRole` (ADR 0005): true en un inicio de sesión desde PANT-02 → la app pasa por PANT-08 para elegir la
 * función. false en la revalidación sin salir de la pantalla (reauthenticate): no cambia la navegación.
 */
async function applyOnlineLogin(
  res: LoginResponse,
  password: string,
  onPhase?: PhaseListener,
  askRole = true,
): Promise<AuthResult> {
  const roleChoice = askRole ? { roleChoicePending: true } : {};
  noteServerTime(res.serverTime);
  const now = nowIso();
  await saveTokens(res, res.user.id);
  await upsertUser(res.user, now);
  await setMeta('last_online_user_id', res.user.id);
  await setMeta('offline_failed_attempts', '0');
  await setMeta('offline_locked_until', null);
  const until = offlineValidUntil(now, CONFIG.auth.offlineLoginMaxDays);

  if (res.user.mustChangePassword) {
    // RN-04: con contraseña temporal no se crea verificador.
    useAppSession.getState().set({
      status: 'CAMBIO_CONTRASENA_REQUERIDO',
      mode: 'ONLINE',
      user: res.user,
      lastOnlineAuthAt: now,
      offlineValidUntil: null,
      reauthSuggested: false,
      online: true,
      ...roleChoice, // después del cambio obligatorio se elige la función (ADR 0005)
    });
    logEvent('INFO', 'AUTH', 'LOGIN_ONLINE_OK', { mustChangePassword: true });
    return { ok: true, status: 'CAMBIO_CONTRASENA_REQUERIDO', mode: 'ONLINE' };
  }

  onPhase?.('PREPARING_OFFLINE');
  await buildVerifier(password, res.user.id, res.user.email);
  useAppSession.getState().set({
    status: 'AUTENTICADO',
    mode: 'ONLINE',
    user: res.user,
    lastOnlineAuthAt: now,
    offlineValidUntil: until,
    reauthSuggested: false,
    online: true,
    ...roleChoice, // PANT-08 después de cada login (ADR 0005)
  });
  logEvent('INFO', 'AUTH', 'LOGIN_ONLINE_OK');
  return { ok: true, status: 'AUTENTICADO', mode: 'ONLINE' };
}

/** Deriva y guarda el verificador PBKDF2; registra el tiempo (PBKDF2_MS, para calibrar iteraciones Q-10). */
async function buildVerifier(password: string, userId: string, email: string): Promise<void> {
  const started = nowMs();
  const verifier = await createVerifier(password, { userId, email }, CONFIG.auth.pbkdf2Iterations, (n) =>
    Crypto.getRandomBytes(n),
  );
  await saveVerifierJson(JSON.stringify(verifier));
  logEvent('INFO', 'AUTH', 'PBKDF2_MS', { ms: nowMs() - started, iterations: CONFIG.auth.pbkdf2Iterations });
}

export async function login(email: string, password: string, onPhase?: PhaseListener): Promise<AuthResult> {
  const id = getDeviceIdentity();
  onPhase?.('CONNECTING');
  try {
    const res = await authApi.login({ email: normalizeEmail(email), password, device: deviceInfoDto(id) });
    return await applyOnlineLogin(res, password, onPhase);
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) {
      // 7.4 paso 8: sin respuesta del servidor → login sin internet automático.
      onPhase?.('CHECKING_OFFLINE');
      return loginOffline(email, password);
    }
    const code = err instanceof ApiError && err.code ? err.code : 'ERROR_INESPERADO';
    logEvent('WARN', 'AUTH', 'LOGIN_FAIL', { code });
    return { ok: false, code, fieldErrors: err instanceof ApiError ? err.fieldErrors : undefined };
  }
}

// ------------------------------------------------------------------ login sin internet (7.5)

async function loadOfflineRecord(): Promise<OfflineAuthRecord | null> {
  const userId = await getMeta('last_online_user_id');
  if (!userId) return null;
  const u = await getUser(userId);
  if (!u || !u.lastOnlineAuthAt) return null;
  return {
    userId: u.id,
    email: u.email,
    roles: u.roles,
    accountStatus: u.status,
    mustChangePassword: u.mustChangePassword,
    lastOnlineAuthAt: u.lastOnlineAuthAt,
    failedAttempts: Number((await getMeta('offline_failed_attempts')) ?? '0') || 0,
    lockedUntil: await getMeta('offline_locked_until'),
  };
}

async function loadVerifier(): Promise<OfflineVerifier | null> {
  const raw = await loadVerifierJson();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OfflineVerifier;
  } catch {
    return null;
  }
}

async function saveOfflineRecord(r: OfflineAuthRecord): Promise<void> {
  await setMeta('offline_failed_attempts', String(r.failedAttempts));
  await setMeta('offline_locked_until', r.lockedUntil);
}

export async function loginOffline(email: string, password: string): Promise<AuthResult> {
  const record = await loadOfflineRecord();
  const verifier = await loadVerifier();
  const decision = canAttemptOfflineLogin(record, verifier, email, new Date(nowMs()), CONFIG.auth);
  if (!decision.allowed) {
    logEvent('WARN', 'AUTH', 'LOGIN_FAIL', { code: decision.reason, offline: true });
    return { ok: false, code: decision.reason, until: decision.until };
  }
  const valid = await verifyPassword(password, verifier as OfflineVerifier);
  const rec = record as OfflineAuthRecord;
  if (!valid) {
    const next = registerFailedOfflineAttempt(rec, new Date(nowMs()), CONFIG.auth);
    await saveOfflineRecord(next);
    logEvent('WARN', 'AUTH', 'LOGIN_FAIL', { code: 'INVALID_CREDENTIALS', offline: true });
    if (next.lockedUntil) return { ok: false, code: 'BLOQUEADO_TEMPORAL', until: next.lockedUntil };
    // Mismo mensaje que con internet (no revela nada más).
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }
  await saveOfflineRecord(registerSuccessfulOfflineLogin(rec));
  await setAuthMode('OFFLINE', rec.userId);
  const u = await getUser(rec.userId);
  useAppSession.getState().set({
    status: 'AUTENTICADO',
    mode: 'OFFLINE',
    user: u
      ? {
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          roles: u.roles,
          status: u.status,
          mustChangePassword: u.mustChangePassword,
        }
      : null,
    lastOnlineAuthAt: rec.lastOnlineAuthAt,
    offlineValidUntil: offlineValidUntil(rec.lastOnlineAuthAt, CONFIG.auth.offlineLoginMaxDays),
    roleChoicePending: true, // PANT-08 después de cada login (ADR 0005)
  });
  logEvent('INFO', 'AUTH', 'LOGIN_OFFLINE_OK');
  return { ok: true, status: 'AUTENTICADO', mode: 'OFFLINE' };
}

// ------------------------------------------------------------------ reabrir la app (7.11)

export async function restoreSession(): Promise<void> {
  const store = useAppSession.getState();
  const { userId, mode } = await loadAuthPointer();
  if (!userId) {
    store.reset();
    return;
  }
  const u = await getUser(userId);
  if (!u) {
    store.reset();
    return;
  }
  const profile = {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    roles: u.roles,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
  };
  const tokens = await loadTokens();
  const refreshValid = !!tokens && Date.parse(tokens.refreshTokenExpiresAt) > serverNowMs();

  if (mode === 'ONLINE' && refreshValid) {
    store.set({
      status: u.mustChangePassword ? 'CAMBIO_CONTRASENA_REQUERIDO' : 'AUTENTICADO',
      mode: 'ONLINE',
      user: profile,
      lastOnlineAuthAt: u.lastOnlineAuthAt,
      offlineValidUntil: u.lastOnlineAuthAt ? offlineValidUntil(u.lastOnlineAuthAt, CONFIG.auth.offlineLoginMaxDays) : null,
    });
    return;
  }
  if (mode === 'ONLINE' && !refreshValid) await clearTokens();

  // OFFLINE (o ONLINE con refresh vencido): vale si se cumplen las condiciones de RN-03 salvo la contraseña.
  const record = await loadOfflineRecord();
  const verifier = await loadVerifier();
  const decision = canAttemptOfflineLogin(record, verifier, u.email, new Date(nowMs()), CONFIG.auth);
  if (decision.allowed && record) {
    await setAuthMode('OFFLINE', u.id);
    store.set({
      status: 'AUTENTICADO',
      mode: 'OFFLINE',
      user: profile,
      lastOnlineAuthAt: record.lastOnlineAuthAt,
      offlineValidUntil: offlineValidUntil(record.lastOnlineAuthAt, CONFIG.auth.offlineLoginMaxDays),
    });
    return;
  }
  await clearTokens();
  store.reset();
}

// ------------------------------------------------------------------ token de acceso y revocación

/**
 * Devuelve un access token vigente (lo renueva si vence en menos de auth.refreshMarginSeconds). null si no hay tokens
 * (sesión OFFLINE) o si la renovación revocó el acceso (7.8). Lanza ApiError si no se pudo renovar por falta de red o
 * por un error del servidor: el llamador decide (la sincronización reintenta más tarde).
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  const marginMs = CONFIG.auth.refreshMarginSeconds * 1000;
  const expiresAt = Date.parse(tokens.accessTokenExpiresAt);
  if (Number.isFinite(expiresAt) && expiresAt - marginMs > serverNowMs()) return tokens.accessToken;
  return refreshAccessToken();
}

let refreshing: Promise<string | null> | null = null;

/** Renueva el par de tokens aunque el access token parezca vigente (p. ej. el servidor respondió 401). */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function doRefresh(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  try {
    // Siempre el refresh MÁS RECIENTE (si otra renovación terminó antes, ya se guardó el nuevo).
    const res = await authApi.refresh({ refreshToken: tokens.refreshToken, deviceId: getDeviceIdentity().deviceId });
    noteServerTime(res.serverTime);
    await saveTokens(res, res.user.id);
    await upsertUser(res.user, nowIso());
    refreshSessionUser(res.user);
    logEvent('INFO', 'AUTH', 'REFRESH_OK');
    return res.accessToken;
  } catch (err) {
    if (err instanceof ApiError && err.code && REVOKE_CODES.includes(err.code)) {
      await revoke(err.code);
      return null;
    }
    throw err;
  }
}

/** El perfil que devuelve el servidor (roles, nombre) reemplaza al de la pantalla si es el mismo usuario. */
function refreshSessionUser(user: UserProfile): void {
  const s = useAppSession.getState();
  if (s.user && s.user.id === user.id) {
    s.set({ user: { ...s.user, fullName: user.fullName, roles: user.roles, status: user.status } });
  }
}

/**
 * Llama a la API con un token vigente. Ante 401 TOKEN_EXPIRED (reloj del celular mal puesto o token revocado por el
 * servidor) renueva UNA vez y repite (RENOVAR_TOKEN). Sin tokens o con el acceso revocado lanza ApiError
 * REFRESH_INVALID; los demás errores se propagan tal cual.
 */
export async function callWithToken<T>(call: (token: string) => Promise<T>): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new ApiError('HTTP', 401, 'REFRESH_INVALID');
  try {
    return await call(token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || err.code !== 'TOKEN_EXPIRED') throw err;
    const fresh = await refreshAccessToken();
    if (!fresh) throw new ApiError('HTTP', 401, 'REFRESH_INVALID');
    return call(fresh);
  }
}

/** 7.8 Revocación: borra tokens y verificador; los datos de campo se conservan. No aplica RN-19. */
export async function revoke(code: string): Promise<void> {
  await clearTokens();
  await deleteVerifier();
  useAppSession.getState().reset();
  logEvent('WARN', 'AUTH', 'REVOKED', { code });
}

// ------------------------------------------------------------------ cierre de sesión (7.8, RN-19)

export async function logout(hasOpenMonitoringSession: boolean): Promise<AuthResult> {
  const rule = canLogout(hasOpenMonitoringSession);
  if (!rule.ok) return { ok: false, code: rule.code };
  const tokens = await loadTokens();
  if (tokens) {
    try {
      await authApi.logout({ refreshToken: tokens.refreshToken, deviceId: getDeviceIdentity().deviceId });
    } catch {
      // Sin internet: igual se borran los tokens locales.
    }
  }
  await clearTokens();
  useAppSession.getState().reset();
  logEvent('INFO', 'AUTH', 'LOGOUT');
  return { ok: true, status: 'SIN_SESION', mode: 'ONLINE' };
}

// ------------------------------------------------------------------ contraseña (7.6, 7.7) y registro (7.3)

export async function changePassword(current: string, next: string): Promise<AuthResult> {
  // Una sesión OFFLINE no tiene tokens: primero se valida la contraseña con internet (7.5).
  if (useAppSession.getState().mode !== 'ONLINE') return { ok: false, code: 'REAUTENTICACION_REQUERIDA' };
  try {
    await callWithToken((token) =>
      authApi.changePassword({ currentPassword: current, newPassword: next }, token, getDeviceIdentity().deviceId),
    );
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) return { ok: false, code: 'SIN_INTERNET' };
    if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS') return { ok: false, code: 'CONTRASENA_ACTUAL_INCORRECTA' };
    const code = err instanceof ApiError && err.code ? err.code : 'ERROR_INESPERADO';
    if (REVOKE_CODES.includes(code as ApiErrorCode) && code !== 'REFRESH_INVALID') await revoke(code);
    logEvent('WARN', 'AUTH', 'CHANGE_PASSWORD_FAIL', { code });
    return { ok: false, code, fieldErrors: err instanceof ApiError ? err.fieldErrors : undefined };
  }
  const s = useAppSession.getState();
  if (s.user) {
    await setMustChangePassword(s.user.id, false);
    await buildVerifier(next, s.user.id, s.user.email);
    s.set({
      status: 'AUTENTICADO',
      user: { ...s.user, mustChangePassword: false },
      offlineValidUntil: offlineValidUntil(nowIso(), CONFIG.auth.offlineLoginMaxDays),
    });
  }
  logEvent('INFO', 'AUTH', 'PASSWORD_CHANGED');
  return { ok: true, status: 'AUTENTICADO', mode: 'ONLINE' };
}

export async function register(input: {
  fullName: string;
  email: string;
  phone: string;
  employeeCode: string;
  password: string;
}): Promise<AuthResult> {
  try {
    await authApi.register(
      {
        fullName: input.fullName.trim(),
        email: normalizeEmail(input.email),
        phone: input.phone.trim() || null,
        employeeCode: input.employeeCode.trim() || null,
        password: input.password,
        acceptedPrivacyNotice: true,
      },
      getDeviceIdentity().deviceId,
    );
    return { ok: true, status: 'SIN_SESION', mode: 'ONLINE' };
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) return { ok: false, code: 'SIN_INTERNET' };
    return {
      ok: false,
      code: err instanceof ApiError && err.code ? err.code : 'ERROR_INESPERADO',
      fieldErrors: err instanceof ApiError ? err.fieldErrors : undefined,
    };
  }
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  try {
    await authApi.requestPasswordReset({ email: normalizeEmail(email) }, getDeviceIdentity().deviceId);
    return { ok: true, status: 'SIN_SESION', mode: 'ONLINE' };
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) return { ok: false, code: 'SIN_INTERNET' };
    // Mensaje neutro siempre (no revela si el correo existe).
    return { ok: true, status: 'SIN_SESION', mode: 'ONLINE' };
  }
}

// ------------------------------------------------------------------ conectividad y revalidación (7.5)

/** Comprueba GET /health. Si la sesión es OFFLINE y hay internet, sugiere revalidar la contraseña. */
export async function checkBackend(passActive: boolean): Promise<boolean> {
  let online = false;
  try {
    const h = await authApi.health();
    noteServerTime(h.serverTime);
    online = true;
  } catch {
    online = false;
  }
  const s = useAppSession.getState();
  s.set({ online, reauthSuggested: online && s.status === 'AUTENTICADO' && s.mode === 'OFFLINE' && !passActive });
  return online;
}

/** Validación con internet de una sesión OFFLINE sin salir de la pantalla (REAUTENTICACION_REQUERIDA). */
export async function reauthenticate(password: string): Promise<AuthResult> {
  const s = useAppSession.getState();
  if (!s.user) return { ok: false, code: 'ERROR_INESPERADO' };
  try {
    const res = await authApi.login({ email: s.user.email, password, device: deviceInfoDto(getDeviceIdentity()) });
    if (res.user.id !== s.user.id) return { ok: false, code: 'INVALID_CREDENTIALS' };
    // Revalidación en la misma pantalla: no vuelve a pedir la función del celular (askRole = false).
    const r = await applyOnlineLogin(res, password, undefined, false);
    logEvent('INFO', 'AUTH', 'REAUTH_OK');
    return r;
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) return { ok: false, code: 'SIN_INTERNET' };
    const code = err instanceof ApiError && err.code ? err.code : 'ERROR_INESPERADO';
    if (REVOKE_CODES.includes(code as ApiErrorCode)) await revoke(code);
    return { ok: false, code };
  }
}

/** ¿El usuario actual puede usar la app? (RN-02) */
export function hasMobileRole(roles: readonly string[]): boolean {
  return roles.some((r) => (MOBILE_ALLOWED_ROLES as readonly string[]).includes(r));
}
