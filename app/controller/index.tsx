// app/controller/index.tsx — PANT-10 Panel del controlador (RF-15, RF-42, RF-46).
//
// QUÉ HACE: estado de preparación (catálogos y su fecha, batería, espacio, GPS), la sesión abierta si
// existe y las sesiones por sincronizar. Acciones: Nueva sesión, Continuar sesión (abre la pantalla que
// corresponde según el estado), Descartar borrador, Catálogos, Sincronizar, Incidencias y Fotos.
// Cabecera con [Ajustes] y [Cerrar sesión] en la misma zona (contexto §25.3).

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { catalogInfo, catalogState, isCatalogOld, type CatalogInfo } from '../../src/controller/catalogService';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController } from '../../src/controller/controllerStore';
import { formatDateTime } from '../../src/domain/time';
import { pendingSyncCount } from '../../src/sync/syncQueue';
import { useSyncStore } from '../../src/sync/syncStore';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { messageFor } from '../../src/ui/messages';
import { formatBytes, formatPct, MODE_LABEL, S, SESSION_LABEL } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function ControllerPanel() {
  const { session, pass, ownBattery, ownFreeSpace, gps, alerts } = useController();
  const [info, setInfo] = useState<CatalogInfo | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const syncRunning = useSyncStore((s) => s.running);
  const syncTick = useSyncStore((s) => s.tick);

  useFocusEffect(
    useCallback(() => {
      void catalogInfo().then(setInfo);
      void pendingSyncCount().then(setPendingSync);
      void controllerRuntime.reload();
    }, []),
  );
  // La sincronización automática (S-08) puede vaciar la cola mientras el panel está abierto.
  useEffect(() => {
    if (!syncRunning) void pendingSyncCount().then(setPendingSync);
  }, [syncRunning, syncTick]);

  const catState = catalogState(info);
  const hasCatalogs = catState === 'LISTO';
  const old = info ? isCatalogOld(info) : false;

  const continueSession = () => {
    if (!session) return;
    const openPass = pass && ['READY', 'ACTIVE', 'PAUSED'].includes(pass.status);
    if (session.status === 'DRAFT' || session.status === 'PREPARING') router.push('/controller/pairing');
    else if (session.status === 'CLOSING') router.push('/controller/session-summary');
    else if (openPass) router.push('/controller/pass');
    else router.push('/controller/new-pass');
  };

  const discard = async () => {
    const ok = await confirm({
      title: S.controller.discardDraft,
      message: S.controller.discardConfirm,
      danger: true,
      confirmText: S.controller.discardDraft,
    });
    if (!ok) return;
    const r = await controllerRuntime.discardDraft();
    if (!r.ok) showToast(r.code, 'error');
  };

  return (
    <Screen header={<AppHeader title={S.controller.panelTitle} main />}>
      <Card title={S.controller.readiness} delay={40}>
        <InfoRow
          label={S.controller.catalogs}
          right={
            <StatusPill
              label={
                hasCatalogs
                  ? formatDateTime(info?.bootstrapAt ?? null)
                  : catState === 'VACIO'
                    ? S.catalogs.empty
                    : S.catalogs.never
              }
              tone={!hasCatalogs ? 'error' : old ? 'warn' : 'ok'}
            />
          }
        />
        <InfoRow label={S.controller.battery} value={formatPct(ownBattery)} />
        <InfoRow label={S.controller.space} value={formatBytes(ownFreeSpace)} />
        <InfoRow
          label={S.controller.gps}
          right={
            <StatusPill label={gps ? S.pass.accuracy(gps.fix.accuracyM ?? 0) : S.pass.noGps} tone={gps ? 'ok' : 'neutral'} />
          }
        />
        {!hasCatalogs ? (
          <Text style={styles.alert}>{messageFor(catState === 'VACIO' ? 'CATALOGOS_VACIOS' : 'CATALOGOS_FALTANTES')}</Text>
        ) : null}
        {old ? <Text style={styles.alert}>{messageFor('CATALOGOS_ANTIGUOS')}</Text> : null}
        {alerts
          .filter((a) => a !== 'GPS_NO_DISPONIBLE')
          .map((a) => (
            <Text key={a} style={styles.alert}>
              {messageFor(a)}
            </Text>
          ))}
      </Card>

      <Card
        title={session ? S.controller.openSession : S.controller.noSession}
        right={
          session ? (
            <StatusPill
              label={SESSION_LABEL[session.status]}
              tone={session.status === 'ACTIVE' ? 'ok' : 'info'}
              pulse={session.status === 'ACTIVE'}
            />
          ) : null
        }
        delay={110}
        tone={session ? 'info' : undefined}
      >
        {session ? (
          <>
            <InfoRow label={S.newSession.mode} value={MODE_LABEL[session.mode]} />
            {session.mode === 'AUTOMATICO' ? (
              <InfoRow label={S.newSession.interval} value={S.newSession.seconds(session.intervalMs)} />
            ) : null}
            <InfoRow label={S.controller.started} value={formatDateTime(session.createdAt)} />
            <View style={styles.actions}>
              <AppButton title={S.controller.continueSession} onPress={continueSession} />
              {session.status === 'DRAFT' ? (
                <AppButton title={S.controller.discardDraft} variant="secondary" onPress={discard} />
              ) : null}
            </View>
          </>
        ) : (
          <AppButton
            title={S.controller.newSession}
            variant="gold"
            disabled={!hasCatalogs}
            onPress={() => router.push('/controller/new-session')}
          />
        )}
      </Card>

      <Card delay={180}>
        <View style={styles.grid}>
          <AppButton
            title={S.controller.catalogs}
            variant="secondary"
            style={styles.cell}
            onPress={() => router.push('/controller/catalogs')}
          />
          <AppButton
            title={
              syncRunning ? `${S.controller.sync} …` : pendingSync > 0 ? `${S.controller.sync} (${pendingSync})` : S.controller.sync
            }
            variant="secondary"
            style={styles.cell}
            onPress={() => router.push('/controller/sync')}
          />
          <AppButton
            title={S.controller.incidents}
            variant="secondary"
            style={styles.cell}
            onPress={() => router.push('/controller/incidents')}
          />
          <AppButton
            title={S.controller.gallery}
            variant="secondary"
            style={styles.cell}
            onPress={() => router.push('/gallery')}
          />
          <AppButton title={S.pests.entry} variant="dark" style={styles.cell} onPress={() => router.push('/pests')} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  alert: {
    marginTop: 8,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.warnBg,
    color: colors.text,
    fontSize: font.body,
  },
  actions: { marginTop: 12, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexBasis: '47%', flexGrow: 1 },
});
