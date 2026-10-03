// app/camera/index.tsx — PANT-30 Escanear QR (maestro §14.6 y §8.12; RF-28).
//
// QUÉ HACE: vista de cámara a pantalla completa con lector de QR y marco animado. Al leer un QR válido
// (type = RIACHUELO_PAIR) se vincula con el controlador usando la función de este celular (Cámara 1 o 2).
// Si ya está unido a OTRA sesión, pide confirmación antes de cerrarla (8.12). Un QR que no es de la app
// muestra QR_INVALIDO. Acceso a "Modo prueba" (PANT-32) y a las fotos guardadas.
// Funciona en Expo Go (cámara + WebSocket) para vincularse con un controlador instalado como APK.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppSession } from '../../src/auth/authStore';
import { cameraAgent } from '../../src/camera/cameraAgent';
import { useCameraLive } from '../../src/camera/cameraStore';
import type { CameraRole } from '../../src/domain/types';
import { parsePairingQr } from '../../src/protocol/envelope';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { ScanFrame } from '../../src/ui/components/ScanFrame';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const role = useAppSession((s) => s.deviceRole) as CameraRole;
  const online = useAppSession((s) => s.online);
  const live = useCameraLive();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const handling = useRef(false);
  const lastInvalid = useRef(0);

  useFocusEffect(
    useCallback(() => {
      handling.current = false;
      setActive(true);
      return () => setActive(false);
    }, []),
  );

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
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.hint}>{messageFor('PERMISO_CAMARA')}</Text>
              <AppButton title={S.permissions.grant} variant="gold" onPress={() => void requestPermission()} />
            </View>
          )}
          <View style={[styles.bottom, { paddingBottom: insets.bottom + 14 }]}>
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
});
