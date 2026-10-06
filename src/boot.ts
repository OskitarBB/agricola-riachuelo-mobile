// src/boot.ts — Arranque de la app (PANT-01, maestro §6.4).
//
// QUÉ HACE, en orden:
//  1) Abre SQLite y ejecuta migraciones (si falla, PANT-01 ofrece "Exportar diagnóstico").
//  2) Inyecta el generador de UUID (expo-crypto) y carga o crea el deviceId.
//  3) Purga registros viejos (event_log, processed_messages).
//  4) Fase 4: reaplica el perfil de calidad guardado (último bootstrap), recupera el desfase con la hora del servidor
//     y devuelve a PENDIENTE lo que quedó EN_CURSO en sync_queue si la app se cerró a mitad de un envío.
//  5) Restaura la sesión de usuario (7.11), la función del celular y el estado de permisos.
//  6) Arranca el monitor de red (indicador con/sin internet y revalidación 7.5), la sincronización automática del
//     controlador (Supuesto S-08: al volver el internet, al volver a primer plano y cada sync.autoSyncIntervalMs) y
//     precarga sonidos.
// La recuperación de la sesión de monitoreo (8.10) la hace el runtime de cada función al entrar a sus pantallas.

import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';

import { loadClockOffset, restoreSession } from './auth/authService';
import { useAppSession } from './auth/authStore';
import { applyStoredQualityProfile, CONFIG } from './config';
import { setIdProvider } from './domain/ids';
import { loadDeviceIdentity } from './device/deviceIdentity';
import { loadDeviceRole } from './device/deviceRole';
import { recheckBackend, setBackendOnlineListener, setPassActiveProvider, startNetworkMonitor } from './device/networkMonitor';
import { rolePermissionsOk } from './device/permissions';
import { logError, logEvent, purgeOldLogs, setLogDevice } from './diagnostics/eventLog';
import { setFactoryDeviceId } from './local-network/factory';
import { useController } from './controller/controllerStore';
import { openAppDb } from './storage/db';
import { getMeta } from './storage/repositories/appMetaRepo';
import { releaseUploadingCaptures } from './storage/repositories/captureRepo';
import { releaseStuckItems } from './storage/repositories/syncQueueRepo';
import { maybeAutoSync, startAutoSync } from './sync/syncService';
import { preloadSounds, setFeedbackPrefs } from './ui/feedback';

let booting: Promise<void> | null = null;

export function bootApp(): Promise<void> {
  if (!booting) {
    booting = runBoot().catch((err: unknown) => {
      booting = null;
      logError('boot', err);
      useAppSession.getState().set({ booted: true, bootError: 'ERROR_INESPERADO' });
    });
  }
  return booting;
}

async function runBoot(): Promise<void> {
  const store = useAppSession.getState();
  await openAppDb();
  setIdProvider(() => Crypto.randomUUID());
  const identity = await loadDeviceIdentity();
  setLogDevice(identity.deviceId);
  setFactoryDeviceId(() => identity.deviceId);
  await purgeOldLogs(CONFIG.logging.eventLogMaxDays, CONFIG.protocol.processedMessagesTtlHours);

  // Fase 4: perfil de calidad publicado por la plataforma (las cámaras lo reciben en PAIRED aunque no haya internet).
  applyStoredQualityProfile(await getMeta('quality_profile_json'));
  await loadClockOffset();
  const released = await releaseStuckItems();
  const uploading = await releaseUploadingCaptures();
  if (released > 0 || uploading > 0) logEvent('INFO', 'SYNC', 'RELEASED_ON_BOOT', { items: released, captures: uploading });

  const sounds = (await getMeta('ui_sounds')) ?? (CONFIG.ui.soundsEnabledByDefault ? '1' : '0');
  const haptics = (await getMeta('ui_haptics')) ?? (CONFIG.ui.hapticsEnabledByDefault ? '1' : '0');
  setFeedbackPrefs({ sounds: sounds === '1', haptics: haptics === '1' });
  void preloadSounds();

  await restoreSession();
  const role = await loadDeviceRole();
  const permissionsOk = role ? await rolePermissionsOk(role) : false;
  store.set({ identity, deviceRole: role, permissionsOk, booted: true, bootError: null });

  setPassActiveProvider(() => useController.getState().pass?.status === 'ACTIVE');
  setBackendOnlineListener(() => {
    void maybeAutoSync('RED');
  });
  startNetworkMonitor();
  startAutoSync();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') recheckBackend(); // al volver: indicador de internet y, si corresponde, sincronización
  });
  logEvent('INFO', 'DEVICE', 'BOOT', {
    role,
    auth: useAppSession.getState().status,
    mode: useAppSession.getState().mode,
    quality: CONFIG.quality.profileVersion,
  });
}

/** Recalcula los permisos de la función actual (después de PANT-07 o al volver de Ajustes). */
export async function refreshPermissions(): Promise<boolean> {
  const role = useAppSession.getState().deviceRole;
  const ok = role ? await rolePermissionsOk(role) : false;
  useAppSession.getState().set({ permissionsOk: ok });
  return ok;
}
