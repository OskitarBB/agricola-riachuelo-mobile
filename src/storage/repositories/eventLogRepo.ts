// src/storage/repositories/eventLogRepo.ts — Tabla event_log (registro técnico de eventos, maestro §20.1).
//
// QUÉ HACE: inserta, lista y purga eventos. data_json lleva SOLO identificadores, códigos, tiempos y
// conteos (nunca contraseñas, tokens ni el verificador; regla R-10).

import { getDb, type Db } from '../db';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface EventRow {
  id: number;
  ts: string;
  level: LogLevel;
  category: string;
  event: string;
  sessionId: string | null;
  deviceId: string | null;
  data: unknown;
}

export async function insertEvent(
  e: {
    ts: string;
    level: LogLevel;
    category: string;
    event: string;
    sessionId: string | null;
    deviceId: string | null;
    data: unknown;
  },
  db: Db = getDb(),
): Promise<void> {
  await db.runAsync(
    'INSERT INTO event_log (ts, level, category, event, session_id, device_id, data_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [e.ts, e.level, e.category, e.event, e.sessionId, e.deviceId, e.data === undefined ? null : JSON.stringify(e.data)],
  );
}

export async function listEvents(sinceIso: string, limit = 5000, db: Db = getDb()): Promise<EventRow[]> {
  const rows = await db.getAllAsync<{
    id: number;
    ts: string;
    level: LogLevel;
    category: string;
    event: string;
    session_id: string | null;
    device_id: string | null;
    data_json: string | null;
  }>('SELECT * FROM event_log WHERE ts >= ? ORDER BY id DESC LIMIT ?', [sinceIso, limit]);
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    level: r.level,
    category: r.category,
    event: r.event,
    sessionId: r.session_id,
    deviceId: r.device_id,
    data: r.data_json ? safeParse(r.data_json) : null,
  }));
}

export async function purgeEventsBefore(iso: string, db: Db = getDb()): Promise<void> {
  await db.runAsync('DELETE FROM event_log WHERE ts < ?', [iso]);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
