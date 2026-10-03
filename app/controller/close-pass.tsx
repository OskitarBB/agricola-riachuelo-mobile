// app/controller/close-pass.tsx — PANT-18 Terminar pasada (maestro §8.7; RF-26, RF-47; RN-12, RN-13).
//
// QUÉ HACE: resumen de la pasada (duración, completas/parciales/incompletas, repeticiones, fotos por llegar,
// incidencias y resumen por segmento) y el estado final COMPLETED o INCOMPLETE (esta exige el motivo).
// "Cerrar pasada" envía END_PASS. Después ofrece: Crear LATERAL B · Repetir lateral · Otra hilera ·
// Vincular cámaras · Cerrar sesión de monitoreo.

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController } from '../../src/controller/controllerStore';
import { passSummary, type PassSummary } from '../../src/controller/passService';
import { formatDuration } from '../../src/domain/time';
import { AnimatedCounter } from '../../src/ui/components/AnimatedCounter';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { Segmented } from '../../src/ui/components/Segmented';
import { TextField } from '../../src/ui/components/TextField';
import { feedback } from '../../src/ui/feedback';
import { LATERAL_LABEL, PASS_LABEL, S } from '../../src/ui/strings';
import { colors, font } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

type Final = 'COMPLETED' | 'INCOMPLETE';

export default function ClosePassScreen() {
  const { pass, counters } = useController();
  const [summary, setSummary] = useState<PassSummary | null>(null);
  const [final, setFinal] = useState<Final>('COMPLETED');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const closed = pass?.status === 'COMPLETED' || pass?.status === 'INCOMPLETE';

  useFocusEffect(
    useCallback(() => {
      if (pass) void passSummary(pass).then(setSummary);
    }, [pass]),
  );

  const close = async () => {
    setBusy(true);
    const r = await controllerRuntime.endPass(final, final === 'INCOMPLETE' ? reason : null);
    setBusy(false);
    if (!r.ok) {
      showToast(r.code, 'warn');
      return;
    }
    feedback('success');
    showToast('PASADA_CERRADA', 'success');
  };

  const next = (
    path: '/controller/new-pass' | '/controller/pairing' | '/controller/session-summary',
    params?: Record<string, string>,
  ) => {
    const p = pass;
    controllerRuntime.clearClosedPass();
    if (path === '/controller/new-pass' && p) router.replace({ pathname: path, params: params ?? {} });
    else router.replace(path);
  };

  if (!pass) {
    return (
      <Screen header={<AppHeader title={S.closePass.title} back />}>
        <AppButton title={S.back} onPress={() => router.replace('/controller')} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<AppHeader title={S.closePass.title} back={!closed} />}
      footer={
        closed ? (
          <FadeIn>
            <View style={styles.after}>
              {pass.lateralCode === 'LATERAL_A' ? (
                <AppButton
                  title={S.closePass.nextB}
                  variant="gold"
                  onPress={() => next('/controller/new-pass', { lotId: pass.lotId, rowId: pass.rowId, lateral: 'LATERAL_B' })}
                />
              ) : null}
              <View style={styles.row}>
                <AppButton
                  title={S.closePass.repeatLateral}
                  variant="secondary"
                  compact
                  style={styles.flex}
                  onPress={() =>
                    next('/controller/new-pass', { lotId: pass.lotId, rowId: pass.rowId, lateral: pass.lateralCode })
                  }
                />
                <AppButton
                  title={S.closePass.otherRow}
                  variant="secondary"
                  compact
                  style={styles.flex}
                  onPress={() => next('/controller/new-pass', { lotId: pass.lotId })}
                />
              </View>
              <View style={styles.row}>
                <AppButton
                  title={S.closePass.pairing}
                  variant="ghost"
                  compact
                  style={styles.flex}
                  onPress={() => next('/controller/pairing')}
                />
                <AppButton
                  title={S.closePass.closeSession}
                  variant="danger"
                  compact
                  style={styles.flex}
                  onPress={() => next('/controller/session-summary')}
                />
              </View>
            </View>
          </FadeIn>
        ) : (
          <AppButton
            title={S.closePass.close.toUpperCase()}
            variant={final === 'INCOMPLETE' ? 'danger' : 'primary'}
            onPress={close}
            loading={busy}
            disabled={final === 'INCOMPLETE' && reason.trim().length < 3}
          />
        )
      }
    >
      <Card title={`${LATERAL_LABEL[pass.lateralCode]} · ${PASS_LABEL[pass.status]}`} delay={30}>
        <View style={styles.counters}>
          <AnimatedCounter value={counters.total} label={S.pass.total} />
          <AnimatedCounter value={counters.complete} label={S.pass.complete} color={colors.ok} />
          <AnimatedCounter value={counters.partial} label={S.pass.partial} color={colors.info} />
          <AnimatedCounter value={counters.incomplete} label={S.pass.incomplete} color={colors.error} />
        </View>
      </Card>
      <Card title={S.closePass.summary} delay={90}>
        <InfoRow label={S.closePass.duration} value={summary ? formatDuration(summary.durationMs) : '—'} />
        <InfoRow label={S.closePass.retakes} value={summary?.retakes ?? 0} />
        <InfoRow label={S.closePass.pendingTransfers} value={summary?.missingPhotos ?? 0} />
        <InfoRow label={S.closePass.incidents} value={summary?.incidents ?? 0} />
      </Card>
      {summary && summary.bySegment.length > 0 ? (
        <Card title={S.closePass.bySegment} delay={150}>
          {summary.bySegment.map((s) => (
            <InfoRow
              key={s.segmentId ?? 'none'}
              label={s.segmentId ?? '—'}
              value={`${s.complete}/${s.total} · ${s.incomplete} ✗`}
            />
          ))}
        </Card>
      ) : null}
      {!closed ? (
        <Card title={S.closePass.status} delay={210}>
          <Segmented<Final>
            options={[
              { value: 'COMPLETED', label: PASS_LABEL.COMPLETED },
              { value: 'INCOMPLETE', label: PASS_LABEL.INCOMPLETE },
            ]}
            value={final}
            onChange={setFinal}
          />
          {final === 'INCOMPLETE' ? (
            <FadeIn>
              <View style={{ marginTop: 14 }}>
                <TextField label={S.closePass.reason} value={reason} onChangeText={setReason} multiline />
              </View>
            </FadeIn>
          ) : null}
        </Card>
      ) : (
        <Text style={styles.done}>{S.closePass.closed}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  counters: { flexDirection: 'row' },
  after: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  done: { textAlign: 'center', fontSize: 18, fontWeight: font.weightBold, color: colors.ok, marginTop: 6 },
});
