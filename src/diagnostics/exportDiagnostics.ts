// src/diagnostics/exportDiagnostics.ts — Exportar diagnóstico (maestro §20.2, RF-45).
//
// QUÉ HACE: arma diagnostics/diagnostico_{deviceId}_{fecha}.json con: versiones (app, protocolo,
// configuración, perfil de calidad), datos del equipo, función, resumen de sesiones, conteos de tablas
// y colas, y los eventos de los últimos logging.eventLogMaxDays días. Lo comparte con expo-sharing.
// SIN contraseñas, tokens ni verificador (R-10): esos datos nunca están en SQLite ni en event_log.
// Fase 4: también el servidor configurado (solo el host), el desfase con la hora del servidor, el resultado de la
// última sincronización y los elementos de la cola con error (tipo, id, código y detalle del servidor con traceId,
// para buscarlo en la consola de Django).

import * as Sharing from 'expo-sharing';

import { getClockOffsetMs } from '../auth/authService';
import { apiHostLabel, APP_VERSION, CONFIG, CONFIG_VERSION, ENV } from '../config';
import { addMsIso, nowIso } from '../domain/time';
import { loadDeviceRole } from '../device/deviceRole';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { getDb, tableCounts } from '../storage/db';
import { dateKey, diagnosticsPath, writeJson } from '../storage/files';
import { listEvents } from '../storage/repositories/eventLogRepo';
import { countQueue } from '../storage/repositories/transferQueueRepo';
import { getMetaJson } from '../storage/repositories/appMetaRepo';
import { countPendingSync, countSyncErrors } from '../storage/repositories/syncQueueRepo';
import { logError, logEvent } from './eventLog';

export async function buildDiagnostics(): Promise<Record<string, unknown>> {
  const id = getDeviceIdentity();
  const sessions = await getDb().getAllAsync<{
    session_id: string;
    status: string;
    mode: string;
    created_at: string;
    remote_sync_status: string;
  }>(
    'SELECT session_id, status, mode, created_at, remote_sync_status FROM monitoring_sessions ORDER BY created_at DESC LIMIT 50',
    [],
  );
  const syncErrors = await getDb().getAllAsync<{
    session_id: string;
    entity_type: string;
    entity_id: string;
    attempts: number;
    last_error_code: string | null;
    last_error: string | null;
    updated_at: string;
  }>(
    `SELECT session_id, entity_type, entity_id, attempts, last_error_code, last_error, updated_at FROM sync_queue
     WHERE status = 'ERROR_DEFINITIVO' OR (status = 'PENDIENTE' AND attempts > 0) ORDER BY updated_at DESC LIMIT 200`,
    [],
  );
  return {
    generatedAt: nowIso(),
    versions: {
      app: APP_VERSION,
      protocol: CONFIG.protocol.version,
      config: CONFIG_VERSION,
      qualityProfile: CONFIG.quality.profileVersion,
      env: ENV.appEnv,
      mockApi: ENV.useMockApi,
    },
    server: { host: apiHostLabel(), clockOffsetMs: getClockOffsetMs(), uploadMode: CONFIG.sync.uploadMode },
    device: id,
    role: await loadDeviceRole(),
    config: CONFIG,
    sessions,
    counts: await tableCounts(),
    queues: { transfer: await countQueue(), syncPending: await countPendingSync(), syncErrors: await countSyncErrors() },
    lastSync: await getMetaJson('last_sync'),
    syncProblems: syncErrors,
    events: await listEvents(addMsIso(nowIso(), -CONFIG.logging.eventLogMaxDays * 86_400_000)),
  };
}

/** Genera el archivo y abre el menú de compartir. Devuelve false si falló. */
export async function exportAndShareDiagnostics(): Promise<boolean> {
  try {
    const data = await buildDiagnostics();
    const file = diagnosticsPath(getDeviceIdentity().deviceId, `${dateKey()}_${Date.now()}`);
    writeJson(file, data);
    logEvent('INFO', 'DEVICE', 'DIAGNOSTICS_EXPORTED', {});
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Diagnóstico' });
    }
    return true;
  } catch (err) {
    logError('diagnostics.export', err);
    return false;
  }
}
