// app/settings.tsx — PANT-09 Ajustes (maestro §9; RF-08, RF-09, RF-13, RF-35, RF-45).
//
// QUÉ HACE: muestra usuario, modo de acceso y fecha límite sin internet, función, versiones (app,
// protocolo, perfil de calidad, configuración), entorno, espacio libre y batería. Acciones:
//  Cambiar contraseña · Cambiar función (RN-15) · Reintentar transferencias con error (cámaras) ·
//  Exportar diagnóstico · Liberar espacio (solo según RN-09) · Fotos guardadas · Sonidos / Vibración.
// "Cerrar sesión" está ARRIBA, en la misma zona que el título Ajustes (contexto §25.3) y respeta RN-19.

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useAppSession } from '../src/auth/authStore';
import { cameraAgent } from '../src/camera/cameraAgent';
import { releaseControllerSyncedPhotos } from '../src/camera/retentionService';
import { APP_VERSION, CONFIG, CONFIG_VERSION, ENV, PROTOCOL_VERSION_LABEL } from '../src/config';
import { formatDateTime } from '../src/domain/time';
import { batteryPct } from '../src/device/batteryService';
import { canChangeRole } from '../src/device/deviceRole';
import { setHapticsEnabled, setSoundsEnabled } from '../src/device/preferences';
import { freeSpace } from '../src/device/storageInfo';
import { exportAndShareDiagnostics } from '../src/diagnostics/exportDiagnostics';
import { AppButton } from '../src/ui/components/AppButton';
import { AppHeader } from '../src/ui/components/AppHeader';
import { Card } from '../src/ui/components/Card';
import { InfoRow } from '../src/ui/components/InfoRow';
import { Screen } from '../src/ui/components/Screen';
import { feedback, getFeedbackPrefs } from '../src/ui/feedback';
import { formatBytes, formatPct, ROLE_LABEL, S } from '../src/ui/strings';
import { colors, font } from '../src/ui/theme';
import { showToast } from '../src/ui/toast';

export default function SettingsScreen() {
  const { user, mode, offlineValidUntil, deviceRole, identity, online } = useAppSession();
  const [battery, setBattery] = useState<number | null>(null);
  const [space, setSpace] = useState<number | null>(null);
  const [prefs, setPrefs] = useState(getFeedbackPrefs());
  const isCamera = deviceRole === 'CAMERA_1' || deviceRole === 'CAMERA_2';

  useFocusEffect(
    useCallback(() => {
      void batteryPct().then(setBattery);
      setSpace(freeSpace());
    }, []),
  );

  const changeRole = async () => {
    const r = await canChangeRole(deviceRole);
    if (!r.ok) {
      showToast(r.code, 'warn');
      return;
    }
    router.push('/role');
  };

  const retryTransfers = async () => {
    const n = await cameraAgent.retryErroredTransfers();
    showToast(S.settings.retried(n), 'success');
  };

  const freeUp = async () => {
    const n = deviceRole === 'CONTROLADOR' ? await releaseControllerSyncedPhotos() : 0;
    showToast(S.gallery.deleted(n), 'info');
    setSpace(freeSpace());
  };

  const toggleSounds = async (on: boolean) => {
    await setSoundsEnabled(on);
    setPrefs(getFeedbackPrefs());
    if (on) feedback('toggle');
  };

  const toggleHaptics = async (on: boolean) => {
    await setHapticsEnabled(on);
    setPrefs(getFeedbackPrefs());
    if (on) feedback('toggle');
  };

  return (
    <Screen header={<AppHeader title={S.settings.title} back showLogout />}>
      <Card title={S.settings.user} delay={40}>
        <InfoRow label={S.settings.user} value={user?.fullName} strong />
        <InfoRow label={S.login.email} value={user?.email} />
        <InfoRow label={S.settings.access} value={mode === 'OFFLINE' ? S.offline : S.online} />
        <InfoRow label={S.settings.offlineUntil} value={formatDateTime(offlineValidUntil)} />
        <InfoRow label={S.settings.role} value={deviceRole ? ROLE_LABEL[deviceRole] : null} />
      </Card>

      <Card delay={110}>
        <View style={styles.actions}>
          <AppButton
            title={S.settings.changePassword}
            variant="secondary"
            disabled={!online || mode !== 'ONLINE'}
            onPress={() => router.push('/change-password')}
          />
          <AppButton title={S.settings.changeRole} variant="secondary" onPress={changeRole} />
          <AppButton title={S.settings.gallery} variant="secondary" onPress={() => router.push('/gallery')} />
          {isCamera ? <AppButton title={S.settings.retryTransfers} variant="secondary" onPress={retryTransfers} /> : null}
          <AppButton
            title={S.settings.exportDiagnostics}
            variant="secondary"
            onPress={async () => {
              const ok = await exportAndShareDiagnostics();
              showToast(ok ? S.settings.exported : 'ERROR_INESPERADO', ok ? 'success' : 'error');
            }}
          />
          <AppButton title={S.settings.freeSpaceAction} variant="secondary" onPress={freeUp} />
        </View>
      </Card>

      <Card delay={180}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{S.settings.sounds}</Text>
          <Switch
            value={prefs.sounds}
            onValueChange={(v) => void toggleSounds(v)}
            trackColor={{ true: colors.brandLight, false: colors.border }}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{S.settings.haptics}</Text>
          <Switch
            value={prefs.haptics}
            onValueChange={(v) => void toggleHaptics(v)}
            trackColor={{ true: colors.brandLight, false: colors.border }}
          />
        </View>
      </Card>

      <Card delay={250}>
        <InfoRow label={S.settings.appVersion} value={APP_VERSION} />
        <InfoRow label={S.settings.protocol} value={PROTOCOL_VERSION_LABEL} />
        <InfoRow label={S.settings.quality} value={CONFIG.quality.profileVersion} />
        <InfoRow label={S.settings.config} value={CONFIG_VERSION} />
        <InfoRow label={S.settings.env} value={ENV.appEnv} />
        <InfoRow label={S.settings.freeSpace} value={formatBytes(space)} />
        <InfoRow label={S.settings.battery} value={formatPct(battery)} />
        <InfoRow label={S.settings.deviceId} value={identity?.deviceId.slice(0, 8)} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  switchLabel: { fontSize: font.body, color: colors.text, fontWeight: font.weightMedium },
});
