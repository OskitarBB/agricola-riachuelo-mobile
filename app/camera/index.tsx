// app/camera/index.tsx — PANT-30 Escanear QR (maestro §14.6 y §8.12; RF-28).
//
// QUÉ HACE: vista de cámara a pantalla completa con lector de QR y marco animado. Al leer un QR válido
// (type = RIACHUELO_PAIR) se vincula con el controlador usando la función de este celular (Cámara 1 o 2).
// Si ya está unido a OTRA sesión, pide confirmación antes de cerrarla (8.12). Un QR que no es de la app
// muestra QR_INVALIDO. Acceso a "Modo prueba" (PANT-32) y a las fotos guardadas.
// ADR 0005: es la pantalla principal de Cámara 1 / Cámara 2 al entrar después del login. Muestra también el
// estado del celular antes de vincularse (batería, espacio y Wi-Fi con su IP, maestro §8.2) y "Reintentar"
// para reiniciar el lector si la vista de cámara se quedó congelada.
// Funciona en Expo Go (cámara + WebSocket) para vincularse con un controlador instalado como APK.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppSession } from '../../src/auth/authStore';
import { cameraAgent } from '../../src/camera/cameraAgent';
import { useCameraLive } from '../../src/camera/cameraStore';
import { CONFIG } from '../../src/config';
import type { CameraRole } from '../../src/domain/types';
import { localIp } from '../../src/device/networkMonitor';
import { parsePairingQr } from '../../src/protocol/envelope';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { ScanFrame } from '../../src/ui/components/ScanFrame';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { formatBytes, formatPct, ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const role = useAppSession((s) => s.deviceRole) as CameraRole;
  const online = useAppSession((s) => s.online);
  const live = useCameraLive();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const [scanKey, setScanKey] = useState(0);
  const [ip, setIp] = useState<string | null>(null);
  const handling = useRef(false);
  const lastInvalid = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      handling.current = false;
      setActive(true);
      // IP del Wi-Fi: la cámara y el controlador deben estar en la misma red (o el hotspot del controlador).
      void localIp().then((v) => alive && setIp(v));
      return () => {
        alive = false;
        setActive(false);
      };
    }, []),
  );

  /** "Reintentar" (PANT-30): vuelve a montar la vista de cámara y habilita otra lectura. */
  const retry = () => {
    handling.current = false;
    setScanKey((k) => k + 1);
  };

  const lowBattery = live.battery !== null && live.battery < CONFIG.device.lowBatteryAlertPct;
  const lowSpace = live.freeSpace !== null && live.freeSpace < CONFIG.device.minFreeSpaceToStartBytes;

  const onScan = async (data: string) => {
    if (handling.current) return;
    const qr = parsePairingQr(data);
    if (!qr) {
      if (Date.now() - lastInvalid.current > 2500) {
        lastInvalid.current = Date.now();
        showToast('QR_INVALIDO', 'warn');
      }
      return;
    }
    handling.current = true;
    feedback('success');
    if (live.sessionId && live.sessionId !== qr.sessionId) {
      const ok = await confirm({ title: S.camera.scanTitle, message: S.camera.otherSessionConfirm, confirmText: S.continue });
      if (!ok) {
        handling.current = false;
        return;
      }
    }
    await cameraAgent.pairWithQr(qr, role);
    router.replace('/camera/live');
  };

  const granted = permission?.granted;

  return (
    <View style={styles.flex}>
      <AppHeader title={S.camera.scanTitle} main />
      <View style={styles.flex}>
        {granted ? (
          <CameraView
            key={scanKey}
            style={StyleSheet.absoluteFill}
            facing="back"
            active={active}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={active ? (r) => void onScan(r.data) : undefined}
          />
        ) : null}
        <View style={styles.overlay}>
          <FadeIn from="top">
            <View style={styles.chips}>
              <StatusPill label={ROLE_LABEL[role]} tone="info" big />
              <StatusPill label={online ? S.online : S.offline} tone={online ? 'ok' : 'neutral'} big />
            </View>
          </FadeIn>
          {granted ? (
            <View style={styles.center}>
              <ScanFrame />
              <Text style={styles.hint}>{S.camera.scanHint}</Text>
              <AppButton title={S.camera.retry} variant="dark" compact onPress={retry} />
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.hint}>{messageFor('PERMISO_CAMARA')}</Text>
              <AppButton title={S.permissions.grant} variant="gold" onPress={() => void requestPermission()} />
            </View>
          )}
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 14 }]}>
            <View style={styles.status}>
              <View style={styles.statusItem}>
                <Text style={styles.k}>{S.settings.battery}</Text>
                <Text style={[styles.v, lowBattery && styles.vWarn]}>{formatPct(live.battery)}</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.k}>{S.settings.freeSpace}</Text>
                <Text style={[styles.v, lowSpace && styles.vWarn]}>{formatBytes(live.freeSpace)}</Text>
              </View>
              <View style={styles.statusItem}>
                <Text style={styles.k}>{S.camera.wifi}</Text>
                <Text style={[styles.v, !ip && styles.vWarn]} numberOfLines={1} adjustsFontSizeToFit>
                  {ip ?? S.camera.noWifi}
                </Text>
              </View>
            </View>
            {lowBattery ? <Text style={styles.batteryNotice}>{messageFor('BATERIA_BAJA')}</Text> : null}
            {live.sessionId ? (
              <AppButton title={S.camera.liveTitle} variant="gold" onPress={() => router.replace('/camera/live')} />
            ) : null}
            <View style={styles.row}>
              <AppButton
                title={S.camera.testMode}
                variant="dark"
                style={styles.flex}
                onPress={() => router.push('/camera/test')}
              />
              <AppButton
                title={S.controller.gallery}
                variant="dark"
                style={styles.flex}
                onPress={() => router.push('/gallery')}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.brandDeep },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' },
  chips: { flexDirection: 'row', gap: 10, padding: 14, flexWrap: 'wrap' },
  center: { alignItems: 'center', gap: 18, paddingHorizontal: 24 },
  hint: {
    color: '#fff',
    fontSize: 18,
    fontWeight: font.weightSemi,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  bottom: { paddingHorizontal: 16, gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  status: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(8,24,16,0.78)',
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statusItem: { flex: 1 },
  k: { color: '#B9D3C0', fontSize: 14 },
  v: { color: '#fff', fontSize: 18, fontWeight: font.weightBold },
  vWarn: { color: colors.goldLight },
  batteryNotice: { color: '#fff', backgroundColor: colors.warn, padding: 10, borderRadius: 10, fontSize: 15, marginBottom: 10 },
});
