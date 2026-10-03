// src/device/gpsService.ts — GPS continuo del controlador (RF-38, RN-18).
//
// QUÉ HACE: con watchPositionAsync (precisión máxima) guarda la ÚLTIMA lectura. Cada secuencia toma
// latest(): la lectura solo se usa si su antigüedad es ≤ gps.maxAgeMs; si no, la secuencia queda SIN
// coordenadas (no se inventan). Los cambios de señal se registran en event_log (GPS/FIX_OK, FIX_LOST).

import * as Location from 'expo-location';

import { CONFIG } from '../config';
import { ageMs, nowMs } from '../domain/time';
import type { GpsFix } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';

type Listener = (fix: GpsFix | null) => void;

let subscription: Location.LocationSubscription | null = null;
let last: GpsFix | null = null;
let hadFix = false;
const listeners = new Set<Listener>();

export async function startGps(): Promise<boolean> {
  if (subscription) return true;
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') return false;
  try {
    subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        timeInterval: CONFIG.gps.timeIntervalMs,
        distanceInterval: CONFIG.gps.distanceIntervalM,
      },
      (loc) => {
        last = {
          lat: loc.coords.latitude,
          lon: loc.coords.longitude,
          accuracyM: loc.coords.accuracy ?? null,
          timestamp: new Date(loc.timestamp).toISOString(),
        };
        if (!hadFix) logEvent('INFO', 'GPS', 'FIX_OK', { accuracyM: last.accuracyM });
        if (last.accuracyM !== null && last.accuracyM > CONFIG.gps.warnAccuracyM)
          logEvent('DEBUG', 'GPS', 'LOW_ACCURACY', { accuracyM: last.accuracyM });
        hadFix = true;
        listeners.forEach((l) => l(last));
      },
    );
    return true;
  } catch {
    return false;
  }
}

export function stopGps(): void {
  subscription?.remove();
  subscription = null;
}

/** Última lectura válida (≤ maxAgeMs) con su antigüedad, o null (RN-18). */
export function latestFix(): { fix: GpsFix; ageMs: number } | null {
  if (!last) return null;
  const age = ageMs(last.timestamp, nowMs()) ?? Number.POSITIVE_INFINITY;
  if (age > CONFIG.gps.maxAgeMs) {
    if (hadFix) logEvent('INFO', 'GPS', 'FIX_LOST', { ageMs: age });
    hadFix = false;
    return null;
  }
  return { fix: last, ageMs: age };
}

export function onGps(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
