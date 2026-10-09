// src/diagnostics/eventLog.ts — Registro de eventos técnicos (maestro §20.1).
//
// QUÉ HACE: logEvent() guarda un evento en SQLite (event_log) SIN lanzar errores: el registro nunca
// debe romper el flujo de trabajo. Categorías: AUTH, DEVICE, CATALOG, SESSION, NET, CAPTURE, TRANSFER,
// SYNC, GPS, ERROR. En desarrollo también se imprime en la consola de Metro.
// Prohibido registrar contraseñas, tokens o el verificador (R-10): sanitize() elimina esas claves.

import { addMsIso, nowIso } from '../domain/time';
import { isDbOpen } from '../storage/db';
import { insertEvent, purgeEventsBefore, type LogLevel } from '../storage/repositories/eventLogRepo';
import { purgeProcessedBefore } from '../storage/repositories/processedMessagesRepo';

export type LogCategory =
  | 'AUTH'
  | 'DEVICE'
  | 'CATALOG'
  | 'SESSION'
  | 'NET'
  | 'CAPTURE'
  | 'TRANSFER'
  | 'SYNC'
  | 'GPS'
  | 'PESTS' // v0.5.0: «Ubicar plaga» (ADR 0009)
  | 'ERROR';

let currentDeviceId: string | null = null;
let currentSessionId: string | null = null;

export function setLogDevice(deviceId: string | null): void {
  currentDeviceId = deviceId;
}

export function setLogSession(sessionId: string | null): void {
  currentSessionId = sessionId;
}

const FORBIDDEN = /pass(word)?|token|verifier|secret|hash/i;

function sanitize(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    out[k] = FORBIDDEN.test(k) ? '[omitido]' : sanitize(v);
  }
  return out;
}

export function logEvent(level: LogLevel, category: LogCategory, event: string, data?: unknown, sessionId?: string | null): void {
  const entry = {
    ts: nowIso(),
    level,
    category,
    event,
    sessionId: sessionId === undefined ? currentSessionId : sessionId,
    deviceId: currentDeviceId,
    data: sanitize(data),
  };
  if (__DEV__) {
    console.log(`[${entry.level}] ${category}/${event}`, entry.data ?? '');
  }
  if (!isDbOpen()) return;
  insertEvent(entry).catch(() => undefined);
}

/** Registra un error no controlado sin datos sensibles (solo nombre y mensaje). */
export function logError(where: string, err: unknown): void {
  const e = err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };
  logEvent('ERROR', 'ERROR', where, e);
}

/** Purga event_log y processed_messages según la configuración (se llama al arrancar). */
export async function purgeOldLogs(eventLogMaxDays: number, processedTtlHours: number): Promise<void> {
  try {
    await purgeEventsBefore(addMsIso(nowIso(), -eventLogMaxDays * 86_400_000));
    await purgeProcessedBefore(addMsIso(nowIso(), -processedTtlHours * 3_600_000));
  } catch {
    // No crítico.
  }
}
