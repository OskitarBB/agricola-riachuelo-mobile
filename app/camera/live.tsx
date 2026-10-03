// app/camera/live.tsx — PANT-31 Cámara en sesión (maestro §9; RF-29 a RF-31, RF-35, RF-36).
//
// QUÉ HACE: la vista de cámara queda SIEMPRE montada a pantalla completa (el controlador ordena cada foto).
// Una franja de estado GRANDE, con colores y texto (legible a 1 m), muestra: conexión, sesión, lateral,
// pendientes, última captura (calidad y hora), batería y espacio; además el anillo de estabilidad.
// Durante la pasada no hay botones (todo lo ordena el controlador). Sin pasada activa: "Reintentar
// transferencias con error". Sin conexión: "Sin conexión con el controlador — en pausa", "Reescanear QR" y
// "Abandonar sesión" (con confirmación). Al capturar, la pantalla destella y suena el obturador.
// Pantalla siempre encendida (useKeepAwake).

import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppSession } from '../../src/auth/authStore';
import { cameraAgent } from '../../src/camera/cameraAgent';
import { useCameraLive } from '../../src/camera/cameraStore';
import { formatTime } from '../../src/domain/time';
import type { CameraRole } from '../../src/domain/types';
import { registerCamera, setCameraReady } from '../../src/device/cameraService';
import { useFieldKeepAwake } from '../../src/device/keepAwake';
import { stabilityDetector, type StabilityState } from '../../src/device/stabilityDetector';
import { AppButton } from '../../src/ui/components/AppButton';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { StabilityRing } from '../../src/ui/components/StabilityRing';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor, PAIR_REJECT_MESSAGES } from '../../src/ui/messages';
import { formatBytes, formatPct, LATERAL_LABEL, QUALITY_LABEL, ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, qualityTone, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function LiveCameraScreen() {
  useFieldKeepAwake('camera-live');
  const insets = useSafeAreaInsets();
  const role = useAppSession((s) => s.deviceRole) as CameraRole;
  const live = useCameraLive();
  const [permission] = useCameraPermissions();
  const camRef = useRef<CameraView | null>(null);
  const flash = useAnimatedValue(0);
  const [stab, setStab] = useState<StabilityState>(stabilityDetector.current());

  useEffect(() => stabilityDetector.subscribe(setStab), []);
  useEffect(() => () => registerCamera(null), []);

  // Destello + sonido de obturador en cada captura ordenada por el controlador.
  const flashCount = live.flash;
  useEffect(() => {
    if (flashCount === 0) return;
    feedback('shutter');
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 380, useNativeDriver: true }).start();
  }, [flashCount, flash]);

  const connected = live.link === 'CONECTADO' && live.paired;
  const passActive = !!live.passId && !live.paused;
  let stripTone: 'ok' | 'warn' | 'error' | 'info' = 'info';
  let stripText: string = S.camera.waitingPass;
  if (live.link === 'RECHAZADO') {
    stripTone = 'error';
    stripText = live.rejectReason ? PAIR_REJECT_MESSAGES[live.rejectReason] : messageFor('QR_INVALIDO');
  } else if (!connected) {
    stripTone = 'error';
    stripText = live.link === 'CONECTANDO' ? S.camera.connecting : S.camera.disconnected;
  } else if (live.paused) {
    stripTone = 'warn';
    stripText = S.camera.paused;
  } else if (passActive) {
    stripTone = 'ok';
    stripText = `${S.camera.connected} · ${live.lateral ? LATERAL_LABEL[live.lateral] : ''}`;
  }
  const stripColor = { ok: colors.ok, warn: colors.warn, error: colors.error, info: colors.info }[stripTone];

  const rescan = () => {
    cameraAgent.disconnectForRescan();
    router.replace('/camera');
  };

  const abandon = async () => {
    const ok = await confirm({
      title: S.camera.abandon,
      message: S.camera.abandonConfirm,
      danger: true,
      confirmText: S.camera.abandon,
    });
    if (!ok) return;
    if (await cameraAgent.abandon()) router.replace('/camera');
  };

  const retry = async () => {
    const n = await cameraAgent.retryErroredTransfers();
    showToast(S.settings.retried(n), 'success');
  };

  return (
    <View style={styles.flex}>
      {permission?.granted ? (
        <CameraView
          ref={(r) => {
            camRef.current = r;
            registerCamera(r);
          }}
          style={StyleSheet.absoluteFill}
          facing="back"
          active
          animateShutter={false}
          onCameraReady={() => setCameraReady(true)}
          onMountError={() => setCameraReady(false)}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.noCam]}>
          <Text style={styles.noCamText}>{S.camera.noCameraPermission}</Text>
        </View>
      )}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />

      {/* Franja de estado grande (arriba) */}
      <View style={[styles.strip, { paddingTop: insets.top + 10, backgroundColor: stripColor }]}>
        <View style={styles.stripHead}>
          <Text style={styles.role}>{ROLE_LABEL[role]}</Text>
          {live.capturing ? <StatusPill label={S.camera.capturing} tone="error" pulse /> : null}
        </View>
        <Text style={styles.stripText} numberOfLines={2}>
          {stripText}
        </Text>
      </View>

      {/* Panel de datos (abajo) */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.dataRow}>
          <View style={styles.flexItem}>
            <Text style={styles.k}>{S.camera.session}</Text>
            <Text style={styles.v}>{live.sessionId ? live.sessionId.slice(0, 8) : '—'}</Text>
            <Text style={styles.k}>{S.camera.pending}</Text>
            <Text style={styles.v}>
              {live.pendingTransfers}
              {live.errorTransfers > 0 ? `  ·  ${live.errorTransfers} ✗` : ''}
            </Text>
          </View>
          <View style={styles.flexItem}>
            <Text style={styles.k}>{S.settings.battery}</Text>
            <Text style={styles.v}>{formatPct(live.battery)}</Text>
            <Text style={styles.k}>{S.settings.freeSpace}</Text>
            <Text style={styles.v}>{formatBytes(live.freeSpace)}</Text>
          </View>
          <StabilityRing score={stab.score} stable={stab.stable} size={78} dark />
        </View>
        {live.lastCapture ? (
          <FadeIn key={live.lastCapture.at} from="scale">
            <View style={styles.last}>
              <Text style={styles.k}>{S.camera.lastCapture}</Text>
              <StatusPill
                label={`${QUALITY_LABEL[live.lastCapture.quality]} · ${formatTime(live.lastCapture.at)}`}
                tone={qualityTone(live.lastCapture.quality)}
                big
              />
            </View>
          </FadeIn>
        ) : null}
        {live.otherControllerPhotos ? <Text style={styles.notice}>{messageFor('FOTOS_DE_OTRO_CONTROLADOR')}</Text> : null}

        {!connected ? (
          <View style={styles.row}>
            <AppButton title={S.camera.rescan} variant="gold" style={styles.flexItem} onPress={rescan} />
            {live.sessionId ? (
              <AppButton title={S.camera.abandon} variant="danger" style={styles.flexItem} onPress={abandon} />
            ) : null}
          </View>
        ) : null}
        {connected && !passActive && live.errorTransfers > 0 ? (
          <AppButton title={S.camera.retryTransfers} variant="secondary" onPress={retry} />
        ) : null}
        {!live.sessionId ? <AppButton title={S.camera.exit} variant="dark" onPress={() => router.replace('/camera')} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  flexItem: { flex: 1 },
  noCam: { alignItems: 'center', justifyContent: 'center' },
  noCamText: { color: '#fff', fontSize: font.body },
  flash: { backgroundColor: '#fff' },
  strip: { paddingHorizontal: 16, paddingBottom: 14, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  stripHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  role: { color: '#fff', fontSize: 26, fontWeight: font.weightBold },
  stripText: { color: '#fff', fontSize: 22, fontWeight: font.weightBold, marginTop: 4 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,24,16,0.82)',
    padding: 14,
    gap: 10,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  dataRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  k: { color: '#B9D3C0', fontSize: 14 },
  v: { color: '#fff', fontSize: 20, fontWeight: font.weightBold, marginBottom: 4 },
  last: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  notice: { color: '#fff', backgroundColor: colors.warn, padding: 10, borderRadius: radius.sm, fontSize: font.body },
  row: { flexDirection: 'row', gap: 10 },
});
