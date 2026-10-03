// src/diagnostics/exportDiagnostics.ts — Exportar diagnóstico (maestro §20.2, RF-45).
//
// QUÉ HACE: arma diagnostics/diagnostico_{deviceId}_{fecha}.json con: versiones (app, protocolo,
// configuración, perfil de calidad), datos del equipo, función, resumen de sesiones, conteos de tablas
// y colas, y los eventos de los últimos logging.eventLogMaxDays días. Lo comparte con expo-sharing.
// SIN contraseñas, tokens ni verificador (R-10): esos datos nunca están en SQLite ni en event_log.

import * as Sharing from 'expo-sharing';

import { APP_VERSION, CONFIG, CONFIG_VERSION, ENV } from '../config';
import { addMsIso, nowIso } from '../domain/time';
import { loadDeviceRole } from '../device/deviceRole';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { getDb, tableCounts } from '../storage/db';
import { dateKey, diagnosticsPath, writeJson } from '../storage/files';
import { listEvents } from '../storage/repositories/eventLogRepo';
import { countQueue } from '../storage/repositories/transferQueueRepo';
import { countPendingSync } from '../storage/repositories/syncQueueRepo';
import { logError, logEvent } from './eventLog';

export async function buildDiagnostics(): Promise<Record<string, unknown>> {
  const id = getDeviceIdentity();
  const sessions = await getDb().getAllAsync<{ session_id: string; status: string; mode: string; created_at: string }>(
    'SELECT session_id, status, mode, created_at FROM monitoring_sessions ORDER BY created_at DESC LIMIT 50',
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
    device: id,
    role: await loadDeviceRole(),
    config: CONFIG,
    sessions,
    counts: await tableCounts(),
    queues: { transfer: await countQueue(), syncPending: await countPendingSync() },
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
