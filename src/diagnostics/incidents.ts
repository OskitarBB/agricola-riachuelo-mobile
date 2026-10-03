// src/diagnostics/incidents.ts — Alta de incidencias automáticas (SISTEMA) y manuales (OPERADOR), RF-43.
//
// QUÉ HACE: crea la fila en `incidents` y deja rastro en event_log. Las pantallas usan addManualIncident;
// el controlador usa addSystemIncident ante desconexiones, errores de calidad, batería, espacio, etc.

import { newId } from '../domain/ids';
import { nowIso } from '../domain/time';
import type { Incident, IncidentSeverity, IncidentType } from '../domain/types';
import type { Db } from '../storage/db';
import { insertIncident, listIncidents } from '../storage/repositories/incidentRepo';
import { logEvent } from './eventLog';

export interface IncidentRefs {
  sessionId: string;
  passId?: string | null;
  sequenceId?: string | null;
  captureId?: string | null;
  deviceId?: string | null;
}

async function add(
  refs: IncidentRefs,
  type: IncidentType,
  severity: IncidentSeverity,
  detail: string,
  createdBy: Incident['createdBy'],
  db?: Db,
): Promise<Incident> {
  const inc: Incident = {
    incidentId: newId(),
    sessionId: refs.sessionId,
    passId: refs.passId ?? null,
    sequenceId: refs.sequenceId ?? null,
    captureId: refs.captureId ?? null,
    deviceId: refs.deviceId ?? null,
    type,
    severity,
    detail,
    occurredAt: nowIso(),
    createdBy,
  };
  await insertIncident(inc, db);
  logEvent(severity === 'ERROR' ? 'ERROR' : 'INFO', 'SESSION', 'INCIDENT', { type, severity, createdBy }, refs.sessionId);
  return inc;
}

export function addSystemIncident(refs: IncidentRefs, type: IncidentType, severity: IncidentSeverity, detail: string, db?: Db) {
  return add(refs, type, severity, detail, 'SISTEMA', db);
}

export function addManualIncident(refs: IncidentRefs, type: IncidentType, severity: IncidentSeverity, detail: string, db?: Db) {
  return add(refs, type, severity, detail.trim(), 'OPERADOR', db);
}

export { listIncidents };
