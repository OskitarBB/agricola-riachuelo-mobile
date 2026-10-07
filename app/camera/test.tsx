// app/camera/test.tsx — PANT-32 Modo prueba de cámara (RF-32, RF-33) con disparo AUTOMÁTICO por estabilidad.
//
// QUÉ HACE:
//  - MANUAL: botón grande "Tomar foto de prueba" (sonido de obturador y destello).
//  - AUTOMÁTICO: dispara cada capture.intervalMs PERO SOLO si el celular está QUIETO (acelerómetro +
//    giroscopio, capture.stability.*). Si se mueve, espera mostrando "Esperando estabilidad…" y no toma foto.
//  - Muestra el anillo de estabilidad en vivo y, tras cada foto, la calidad (UTILIZABLE / REPETIR…), las
//    métricas (luminancia, oscuros, saturados, nitidez) y el tiempo. Miniatura que abre la galería.
// No crea datos de sesión; las fotos de prueba se guardan aparte y se pueden borrar.

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { takeTestPhoto, type TestShot } from '../../src/camera/testModeService';
import { CONFIG } from '../../src/config';
import { isCameraReady, registerCamera, setCameraReady } from '../../src/device/cameraService';
import { useFieldKeepAwake } from '../../src/device/keepAwake';
import { stabilityDetector, type StabilityState } from '../../src/device/stabilityDetector';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { Segmented } from '../../src/ui/components/Segmented';
import { StabilityRing } from '../../src/ui/components/StabilityRing';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { QUALITY_LABEL, S } from '../../src/ui/strings';
import { colors, font, qualityTone, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

type Mode = 'MANUAL' | 'AUTO';

export default function CameraTestScreen() {
  useFieldKeepAwake('camera-test');
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<Mode>('MANUAL');
  const [stab, setStab] = useState<StabilityState>(stabilityDetector.current());
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<TestShot | null>(null);
  const [waiting, setWaiting] = useState(false);
  const flash = useAnimatedValue(0);
  const busyRef = useRef(false);

  useEffect(() => {
    void stabilityDetector.start();
    const unsub = stabilityDetector.subscribe(setStab);
    return () => {
      unsub();
      stabilityDetector.stop();
      registerCamera(null);
    };
  }, []);

  // Ref ESTABLE: con una función en línea React la llama con null y otra vez en cada redibujo (ver cameraService).
  const setCameraRef = useCallback((r: CameraView | null) => {
    if (r) registerCamera(r);
  }, []);

  const take = useCallback(
    async (auto: boolean) => {
      if (busyRef.current || !isCameraReady()) return;
      busyRef.current = true;
      setBusy(true);
      feedback('shutter');
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 350, useNativeDriver: true }).start();
      try {
        const r = await takeTestPhoto(auto);
        setShot(r);
        feedback(r.quality.status === 'UTILIZABLE' ? 'success' : 'error');
      } catch {
        showToast('ERROR_INESPERADO', 'error');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [flash],
  );

  // Bucle automático: cada intervalo, solo dispara si la cámara está quieta.
  useEffect(() => {
    if (mode !== 'AUTO') return; // al salir de AUTO, la limpieza del efecto anterior apaga el aviso
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, CONFIG.capture.intervalMs));
        if (cancelled) break;
        if (busyRef.current) continue;
        setWaiting(!stabilityDetector.current().stable);
        const stable = await stabilityDetector.waitForStable(CONFIG.capture.stability.maxWaitMs);
        if (cancelled) break;
        if (!stable) {
          setWaiting(true);
          continue; // no se toma foto con la cámara en movimiento
        }
        setWaiting(false);
        await take(true);
      }
    };
    void loop();
    return () => {
      cancelled = true;
      setWaiting(false);
    };
  }, [mode, take]);

  const m = shot?.quality.metrics;

  return (
    <View style={styles.flex}>
      <AppHeader title={S.camera.testTitle} back />
      <View style={styles.flex}>
        {permission?.granted ? (
          <CameraView
            ref={setCameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            animateShutter={false}
            onCameraReady={() => setCameraReady(true)}
            onMountError={() => setCameraReady(false)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <AppButton title={S.permissions.grant} variant="gold" onPress={() => void requestPermission()} />
          </View>
        )}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />

        <View style={styles.top}>
          <Segmented<Mode>
            options={[
              { value: 'MANUAL', label: S.camera.manualMode },
              { value: 'AUTO', label: S.camera.autoMode },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'AUTO' ? (
            <FadeIn from="top">
              <Text style={styles.autoHint}>{waiting ? S.camera.waitingStable : S.camera.autoHint}</Text>
            </FadeIn>
          ) : null}
        </View>

        <View style={[styles.bottom, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.resultRow}>
            <StabilityRing score={stab.score} stable={stab.stable} size={84} dark />
            {shot ? (
              <FadeIn key={shot.uri} from="scale" style={styles.result}>
                <StatusPill label={QUALITY_LABEL[shot.quality.status]} tone={qualityTone(shot.quality.status)} big />
                {m ? (
                  <Text style={styles.metrics}>
                    {S.camera.luminance} {m.luminanceMean} · {S.camera.dark} {Math.round(m.darkRatio * 100)}% · {S.camera.bright}{' '}
                    {Math.round(m.brightRatio * 100)}%{'\n'}
                    {S.camera.sharpness} {m.laplacianVariance < 0 ? '—' : m.laplacianVariance} · {S.camera.duration}{' '}
                    {m.durationMs} ms
                  </Text>
                ) : null}
              </FadeIn>
            ) : (
              <View style={styles.result} />
            )}
            {shot ? (
              <Pressable onPress={() => router.push('/gallery')}>
                <Image source={{ uri: shot.uri }} style={styles.thumb} contentFit="cover" transition={200} />
              </Pressable>
            ) : null}
          </View>
          {mode === 'MANUAL' ? (
            <AppButton title={S.camera.takeTest} variant="huge" onPress={() => void take(false)} loading={busy} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  top: { position: 'absolute', top: 12, left: 12, right: 12, gap: 8 },
  autoHint: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 10,
    borderRadius: radius.md,
    textAlign: 'center',
    fontSize: font.body,
    fontWeight: font.weightSemi,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    gap: 12,
    backgroundColor: 'rgba(8,24,16,0.82)',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  result: { flex: 1, gap: 6 },
  metrics: { color: '#E3F0E6', fontSize: 14, lineHeight: 20 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.goldLight },
});
