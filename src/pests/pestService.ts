// src/pests/pestService.ts — «Ubicar plaga»: alertas con ubicación, copia sin internet y posición del celular (ADR 0009).
//
// QUÉ HACE:
//  - refreshPests(): con sesión ONLINE pide GET /api/v1/mobile/pest-reports (últimos pests.windowDays días) y guarda
//    la respuesta en app_meta (pest_reports_json) para verla sin internet en el campo. Errores como catalogService:
//    sin internet → SIN_INTERNET (se sigue mostrando la copia); 403 de cuenta o celular → misma revocación de 7.8.
//  - loadPests(): copia guardada (al abrir la pantalla, antes de pedir la nueva).
//  - watchMyPosition(): GPS propio de la pantalla (no toca el GPS del controlador, src/device/gpsService.ts).
//  - usePests: estado para las pantallas (lista, cargando, último error, mi posición, permiso).
// La app nunca habla con Supabase ni con Cloudinary con secretos: la miniatura llega firmada por Django (R-21).

import * as Location from 'expo-location';
import { create } from 'zustand';

import { pestApi } from '../api';
import { ApiError } from '../api/httpClient';
import { callWithToken, noteServerTime, revoke, REVOKE_CODES } from '../auth/authService';
import { useAppSession } from '../auth/authStore';
import { CONFIG } from '../config';
import type { PestReportsResponse } from '../domain/pests';
import { nowIso } from '../domain/time';
import type { GpsFix, ISODateString } from '../domain/types';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { logEvent } from '../diagnostics/eventLog';
import { getMetaJson, setMetaJson } from '../storage/repositories/appMetaRepo';

export interface PestCache {
  fetchedAt: ISODateString;
  data: PestReportsResponse;
}

interface PestState {
  cache: PestCache | null;
  loading: boolean;
  /** Código del último intento fallido (SIN_INTERNET, REAUTENTICACION_REQUERIDA, …) o null. */
  lastError: string | null;
  me: GpsFix | null;
  locationDenied: boolean;
  set(patch: Partial<Omit<PestState, 'set'>>): void;
}

export const usePests = create<PestState>((set) => ({
  cache: null,
  loading: false,
  lastError: null,
  me: null,
  locationDenied: false,
  set: (patch) => set(patch),
}));

/** Forma mínima de la respuesta: una versión distinta del servidor no rompe la pantalla. */
export function isValidPestResponse(d: unknown): d is PestReportsResponse {
  if (!d || typeof d !== 'object') return false;
  const r = d as Partial<PestReportsResponse>;
  return Array.isArray(r.reports) && !!r.farm && typeof r.farm === 'object' && Array.isArray(r.farm.lots);
}

export async function loadPests(): Promise<PestCache | null> {
  const cache = await getMetaJson<PestCache>('pest_reports_json');
  const ok = cache && isValidPestResponse(cache.data) ? cache : null;
  if (ok && !usePests.getState().cache) usePests.getState().set({ cache: ok });
  return ok;
}

let inFlight: Promise<{ ok: true; cache: PestCache } | { ok: false; code: string }> | null = null;

export function refreshPests(): Promise<{ ok: true; cache: PestCache } | { ok: false; code: string }> {
  if (inFlight) return inFlight;
  inFlight = doRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(): Promise<{ ok: true; cache: PestCache } | { ok: false; code: string }> {
  const store = usePests.getState();
  // Sin tokens (entró sin internet) primero hay que validar la contraseña con internet (7.5).
  if (useAppSession.getState().mode !== 'ONLINE') {
    store.set({ lastError: 'REAUTENTICACION_REQUERIDA' });
    return { ok: false, code: 'REAUTENTICACION_REQUERIDA' };
  }
  store.set({ loading: true });
  try {
    const data = await callWithToken((token) =>
      pestApi.list(token, getDeviceIdentity().deviceId, CONFIG.pests.windowDays, CONFIG.pests.requestTimeoutMs),
    );
    if (!isValidPestResponse(data)) throw new ApiError('HTTP', 200, 'INTERNAL_ERROR');
    noteServerTime(data.serverTime);
    const cache: PestCache = { fetchedAt: nowIso(), data };
    await setMetaJson('pest_reports_json', cache);
    usePests.getState().set({ cache, loading: false, lastError: null });
    logEvent('INFO', 'PESTS', 'LIST_OK', { reports: data.reports.length, lots: data.farm.lots.length, days: data.days });
    return { ok: true, cache };
  } catch (err) {
    const code =
      err instanceof ApiError ? (err.isNetwork ? 'SIN_INTERNET' : (err.code ?? 'BACKEND_NO_DISPONIBLE')) : 'ERROR_INESPERADO';
    logEvent('WARN', 'PESTS', 'LIST_FAIL', {
      code,
      status: err instanceof ApiError ? (err.status ?? null) : null,
      traceId: err instanceof ApiError ? err.traceId : null,
    });
    usePests.getState().set({ loading: false, lastError: code });
    // 403 de cuenta o celular (no del refresh, que ya revoca en authService): misma revocación de 7.8.
    if (code !== 'REFRESH_INVALID' && (REVOKE_CODES as readonly string[]).includes(code)) await revoke(code);
    return { ok: false, code };
  }
}

/**
 * GPS de la pantalla «Ubicar plaga». Pide el permiso si falta (la cámara y el especialista quizá nunca lo dieron).
 * Devuelve una función para detenerlo. Si no hay permiso deja locationDenied = true y la pantalla lo explica.
 */
export async function watchMyPosition(): Promise<() => void> {
  const store = usePests.getState();
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted' && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      store.set({ locationDenied: true });
      return () => undefined;
    }
    store.set({ locationDenied: false });
    const sub = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: CONFIG.pests.locationIntervalMs, distanceInterval: 1 },
      (loc) => {
        usePests.getState().set({
          me: {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            accuracyM: loc.coords.accuracy ?? null,
            timestamp: new Date(loc.timestamp).toISOString(),
          },
        });
      },
    );
    return () => sub.remove();
  } catch (err) {
    logEvent('WARN', 'PESTS', 'GPS_FAIL', { message: err instanceof Error ? err.message : String(err) });
    return () => undefined;
  }
}
