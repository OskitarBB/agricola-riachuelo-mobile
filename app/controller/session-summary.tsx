// app/controller/session-summary.tsx — PANT-19 Cerrar sesión de monitoreo (maestro §8.8; RF-27).
//
// QUÉ HACE: resumen por pasada, fotos que faltan llegar por cámara e incidencias. "Cerrar sesión" pasa a
// CLOSING (sin órdenes nuevas; una pasada abierta se cierra INCOMPLETE con incidencia). Si faltan fotos,
// ofrece "Esperar" o "Cerrar igual" (mensaje CIERRE_CON_PENDIENTES); "Cerrar igual" registra la incidencia.
// Al cerrar: CLOSED + cola de sincronización + SESSION_CLOSED a las cámaras + se borran fotos de prueba corta.
// Las fotos que falten llegarán después (8.13) cuando la cámara se vincule de nuevo.

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { sessionPasses } from '../../src/controller/sessionService';
import { useController } from '../../src/controller/controllerStore';
import type { CameraRole, MonitoringPass } from '../../src/domain/types';
import { listIncidents } from '../../src/diagnostics/incidents';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { LATERAL_LABEL, PASS_LABEL, ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function SessionSummaryScreen() {
  const session = useController((s) => s.session);
  const [passes, setPasses] = useState<MonitoringPass[]>([]);
  const [missing, setMissing] = useState<Record<CameraRole, number>>({ CAMERA_1: 0, CAMERA_2: 0 });
  const [incidents, setIncidents] = useState(0);
  const [askPending, setAskPending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setPasses(await sessionPasses(session.sessionId));
    setMissing(await controllerRuntime.missingPhotos());
    setIncidents((await listIncidents(session.sessionId)).length);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const doClose = async (force: boolean) => {
    if (!force) {
      const ok = await confirm({
        title: S.sessionSummary.title,
        message: S.sessionSummary.confirm,
        danger: true,
        confirmText: S.sessionSummary.close,
      });
      if (!ok) return;
    }
    setBusy(true);
    const r = await controllerRuntime.closeSession(force);
    setBusy(false);
    if (!r.ok) {
      if (r.code === 'CIERRE_CON_PENDIENTES') {
        setAskPending(true);
        if ('missing' in r && r.missing) setMissing(r.missing);
        feedback('error');
        return;
      }
      showToast(r.code, 'error');
      return;
    }
    showToast('SESION_CERRADA', 'success');
    router.replace('/controller');
  };

  const totalMissing = missing.CAMERA_1 + missing.CAMERA_2;

  return (
    <Screen
      header={<AppHeader title={S.sessionSummary.title} back />}
      footer={
        askPending ? (
          <View style={styles.row}>
            <AppButton
              title={S.sessionSummary.wait}
              variant="secondary"
              style={styles.flex}
              onPress={() => {
                setAskPending(false);
                void load();
              }}
            />
            <AppButton
              title={S.sessionSummary.closeAnyway}
              variant="danger"
              style={styles.flex}
              loading={busy}
              onPress={() => void doClose(true)}
            />
          </View>
        ) : (
          <AppButton
            title={S.sessionSummary.close.toUpperCase()}
            variant="danger"
            loading={busy}
            onPress={() => void doClose(false)}
            disabled={!session}
          />
        )
      }
    >
      <Card title={S.sessionSummary.passes} delay={40}>
        {passes.length === 0 ? <Text style={styles.muted}>—</Text> : null}
        {passes.map((p) => (
          <InfoRow
            key={p.passId}
            label={`${p.rowId} · ${LATERAL_LABEL[p.lateralCode]} (#${p.passOrder})`}
            right={
              <StatusPill
                label={`${PASS_LABEL[p.status]} · ${p.sequencesComplete}/${p.sequencesTotal}`}
                tone={p.status === 'COMPLETED' ? 'ok' : p.status === 'INCOMPLETE' ? 'warn' : 'info'}
              />
            }
          />
        ))}
      </Card>
      <Card title={S.sessionSummary.missingPhotos} delay={100} tone={totalMissing > 0 ? 'warn' : 'ok'}>
        <InfoRow label={ROLE_LABEL.CAMERA_1} value={missing.CAMERA_1} strong />
        <InfoRow label={ROLE_LABEL.CAMERA_2} value={missing.CAMERA_2} strong />
      </Card>
      <Card delay={160}>
        <InfoRow label={S.closePass.incidents} value={incidents} />
      </Card>
      {askPending ? <Text style={styles.warn}>{messageFor('CIERRE_CON_PENDIENTES')}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  muted: { color: colors.textMuted, fontSize: font.body },
  warn: { backgroundColor: colors.warnBg, padding: 12, borderRadius: radius.md, fontSize: font.body, color: colors.text },
});
