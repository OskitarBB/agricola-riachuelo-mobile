// app/controller/pass.tsx — PANT-16 Pasada activa / monitor (maestro §8.4–8.6; RF-21 a RF-25, RF-38, RF-42).
//
// QUÉ HACE (contexto §25.8, "menos texto, más estado y acción"):
//  - Cabecera de estado: lote · hilera · lateral, marcador y segmento actuales, GPS y precisión, modo.
//  - Contadores animados (total, completas, parciales, incompletas) y tarjetas de las dos cámaras.
//  - Botones "Repetir CÁMARA X (secuencia N)" (RN-07) justo debajo de la cabecera de estado, y la última
//    secuencia con el resultado de cada cámara.
//  - MANUAL:      [CAPTURAR] [PAUSAR] [CAMBIAR MARCADOR] [TERMINAR PASADA]
//  - AUTOMÁTICO:  "Captura automática: ACTIVA" + [PAUSAR] siempre visible; [CAMBIAR MARCADOR] solo en pausa;
//                 en pausa: [REANUDAR] [CAMBIAR MARCADOR] [TERMINAR PASADA]  (secuencia PAUSAR → CAMBIAR → REANUDAR).
//  - Nunca dos órdenes superpuestas (RN-11); pausa automática por enlace, batería, espacio o segundo plano.
//  - Pantalla siempre encendida (useKeepAwake).

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import { catalogs } from '../../src/controller/catalogService';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController } from '../../src/controller/controllerStore';
import type { CameraRole } from '../../src/domain/types';
import { useFieldKeepAwake } from '../../src/device/keepAwake';
import { AnimatedCounter } from '../../src/ui/components/AnimatedCounter';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { CameraCardView } from '../../src/ui/components/CameraCardView';
import { Card } from '../../src/ui/components/Card';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { SimulatorTools } from '../../src/ui/components/SimulatorTools';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { LATERAL_LABEL, MODE_LABEL, ROLE_LABEL, S, SEQUENCE_LABEL, SLOT_LABEL } from '../../src/ui/strings';
import { colors, font, radius, slotTone } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function PassScreen() {
  useFieldKeepAwake('pass');
  const { session, pass, cameras, counters, lastSequence, orderInFlight, autoState, gps, alerts, retakes, resyncing } =
    useController();
  const [names, setNames] = useState({ lot: '', row: '', marker: '', segment: '' });
  const flash = useAnimatedValue(0);
  const lastSeqId = useRef<string | null>(null);

  // Nombres legibles del contexto (desde los catálogos locales).
  useEffect(() => {
    if (!pass) return;
    void (async () => {
      const [lot, row, marker, segment] = await Promise.all([
        catalogs.lot(pass.lotId),
        catalogs.row(pass.rowId),
        pass.currentMarkerId ? catalogs.marker(pass.currentMarkerId) : Promise.resolve(null),
        pass.currentSegmentId ? catalogs.segment(pass.currentSegmentId) : Promise.resolve(null),
      ]);
      setNames({
        lot: lot?.code ?? pass.lotId,
        row: row ? String(row.number) : pass.rowId,
        marker: marker?.code ?? '—',
        segment: segment?.code ?? '—',
      });
    })();
  }, [pass]);

  // Destello verde cada vez que sale una secuencia nueva (también en automático).
  useEffect(() => {
    if (lastSequence && lastSequence.sequenceId !== lastSeqId.current) {
      lastSeqId.current = lastSequence.sequenceId;
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 450, useNativeDriver: true }).start();
      if (autoState === 'ACTIVE') feedback('shutter');
    }
  }, [lastSequence, flash, autoState]);

  // Sonido al completar una secuencia.
  const status = lastSequence?.status;
  useEffect(() => {
    if (status === 'COMPLETE') feedback('success');
  }, [status]);

  if (!session || !pass) {
    return (
      <Screen header={<AppHeader title={S.pass.title} back />}>
        <Text style={styles.empty}>{messageFor('PASADA_NO_ABIERTA')}</Text>
        <AppButton title={S.back} onPress={() => router.replace('/controller')} />
      </Screen>
    );
  }

  const paused = pass.status === 'PAUSED';
  const auto = session.mode === 'AUTOMATICO';
  const markerCheck = controllerRuntime.canChangeMarkerNow();

  const act = async (fn: () => Promise<{ ok: boolean; code?: string }>) => {
    const r = await fn();
    if (!r.ok && 'code' in r && r.code) showToast(r.code, 'warn');
  };

  const retakeLabel = (role: CameraRole, n: number) => S.pass.retake(ROLE_LABEL[role], n);

  return (
    <Screen
      header={<AppHeader title={S.pass.title} back />}
      footer={
        <>
          {!auto ? (
            <AppButton
              title={S.pass.capture}
              variant="huge"
              disabled={paused || orderInFlight || resyncing}
              loading={orderInFlight}
              onPress={() => act(() => controllerRuntime.capture())}
            />
          ) : (
            <View style={styles.autoBar}>
              <Text style={styles.autoText}>{S.pass.auto}:</Text>
              <StatusPill
                label={paused ? S.pass.autoPaused : S.pass.autoActive}
                tone={paused ? 'warn' : 'ok'}
                pulse={!paused}
                big
              />
            </View>
          )}
          <View style={styles.row}>
            {paused ? (
              <AppButton
                title={S.pass.resume}
                variant="primary"
                style={styles.flex}
                onPress={() => act(() => controllerRuntime.resume())}
              />
            ) : (
              <AppButton
                title={S.pass.pause}
                variant="dark"
                style={styles.flex}
                onPress={() => act(() => controllerRuntime.pause())}
              />
            )}
            <AppButton
              title={S.pass.changeMarker}
              variant="secondary"
              style={styles.flex}
              disabled={!markerCheck.ok}
              onPress={() => router.push('/controller/marker')}
            />
          </View>
          <AppButton title={S.pass.endPass} variant="danger" compact onPress={() => router.push('/controller/close-pass')} />
        </>
      }
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />

      <Card dark delay={30}>
        <View style={styles.ctxHead}>
          <Text style={styles.ctxTitle}>
            {names.lot} · {S.newPass.row} {names.row} · {LATERAL_LABEL[pass.lateralCode]}
          </Text>
          <StatusPill label={MODE_LABEL[session.mode]} tone="info" />
        </View>
        <InfoRow dark label={S.pass.marker} value={names.marker} strong />
        <InfoRow dark label={S.pass.segment} value={names.segment} />
        <InfoRow dark label={S.controller.gps} value={gps ? S.pass.accuracy(gps.fix.accuracyM ?? 0) : S.pass.noGps} />
        {auto ? <InfoRow dark label={S.pass.interval} value={`${Math.round(session.intervalMs / 1000)} s`} /> : null}
      </Card>

      {/* Repeticiones pendientes justo debajo del contexto, visibles sin desplazarse (RN-07). */}
      {retakes.map((r) => (
        <FadeIn key={`${r.role}-${r.sequenceId}`} from="right">
          <AppButton
            title={retakeLabel(r.role, r.sequenceNumber)}
            variant="gold"
            style={{ marginBottom: 10 }}
            disabled={paused || cameras[r.role].link !== 'CONECTADA' || (orderInFlight && !auto)}
            onPress={() => act(() => controllerRuntime.retake(r.role))}
          />
        </FadeIn>
      ))}

      <Card delay={80}>
        <View style={styles.counters}>
          <AnimatedCounter value={counters.total} label={S.pass.total} />
          <AnimatedCounter value={counters.complete} label={S.pass.complete} color={colors.ok} />
          <AnimatedCounter value={counters.partial} label={S.pass.partial} color={colors.info} />
          <AnimatedCounter value={counters.incomplete} label={S.pass.incomplete} color={colors.error} />
        </View>
      </Card>

      {lastSequence ? (
        <FadeIn key={lastSequence.sequenceId} from="scale">
          <Card title={`#${lastSequence.sequenceNumber} · ${SEQUENCE_LABEL[lastSequence.status]}`}>
            <View style={styles.row}>
              {(['CAMERA_1', 'CAMERA_2'] as const).map((r) => (
                <View key={r} style={styles.slot}>
                  <Text style={styles.slotName}>{ROLE_LABEL[r]}</Text>
                  <StatusPill
                    label={SLOT_LABEL[lastSequence.slots[r].outcome]}
                    tone={slotTone(lastSequence.slots[r].outcome)}
                    pulse={lastSequence.slots[r].outcome === 'PENDIENTE'}
                  />
                </View>
              ))}
            </View>
          </Card>
        </FadeIn>
      ) : null}

      {alerts.map((a) => (
        <Text key={a} style={styles.alert}>
          {messageFor(a)}
        </Text>
      ))}
      {resyncing ? <Text style={styles.alert}>{messageFor('RESYNC_EN_CURSO')}</Text> : null}

      <CameraCardView card={cameras.CAMERA_1} compact />
      <CameraCardView card={cameras.CAMERA_2} compact />

      {paused ? (
        <AppButton
          title={S.pass.pairing}
          variant="secondary"
          compact
          style={{ marginBottom: 12 }}
          onPress={() => router.push('/controller/pairing')}
        />
      ) : null}
      <SimulatorTools />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  empty: { fontSize: font.body, color: colors.textMuted, marginBottom: 16 },
  flash: { backgroundColor: colors.leaf, zIndex: 10 },
  ctxHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 8 },
  ctxTitle: { color: colors.textOnDark, fontSize: 19, fontWeight: font.weightBold, flex: 1 },
  counters: { flexDirection: 'row' },
  slot: { flex: 1, gap: 6 },
  slotName: { fontSize: font.body, fontWeight: font.weightSemi, color: colors.text },
  alert: {
    backgroundColor: colors.warnBg,
    padding: 12,
    borderRadius: radius.md,
    fontSize: font.body,
    color: colors.text,
    marginBottom: 10,
  },
  autoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 64,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
  },
  autoText: { fontSize: 18, fontWeight: font.weightBold, color: colors.text },
});
