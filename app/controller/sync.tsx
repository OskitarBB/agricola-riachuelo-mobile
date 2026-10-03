// app/controller/sync.tsx — PANT-20 Sincronización (RF-39 a RF-41). ENVÍO AL BACKEND: FASE 4 (Pendiente).
//
// QUÉ HACE HOY: muestra, por sesión cerrada, el total de elementos en la cola de sincronización, enviados,
// pendientes, errores y el último intento (la cola se llena al cerrar cada sesión y con fotos tardías).
// "Sincronizar ahora" y "Reintentar errores" muestran solo "Pendiente" (contexto §25.5).
// INTEGRACIÓN FUTURA (T-20): llamar a src/sync/syncService.runSync(), que enviará en orden sesión → pasadas →
// secuencias → fotos (multipart) → incidencias → cierre a Spring Boot (PostgreSQL + S3), con reintentos.

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppSession } from '../../src/auth/authStore';
import { formatDateTime } from '../../src/domain/time';
import { syncSummary, type SyncSessionSummary } from '../../src/sync/syncQueue';
import { retrySyncErrors, runSync } from '../../src/sync/syncService';
import { AnimatedCounter } from '../../src/ui/components/AnimatedCounter';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { S } from '../../src/ui/strings';
import { colors, font } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function SyncScreen() {
  const online = useAppSession((s) => s.online);
  const [items, setItems] = useState<SyncSessionSummary[]>([]);

  useFocusEffect(
    useCallback(() => {
      void syncSummary().then(setItems);
    }, []),
  );

  const run = async () => {
    const r = await runSync();
    showToast(r.code, 'info');
  };

  const retry = async () => {
    const r = await retrySyncErrors();
    showToast(r.code, 'info');
  };

  return (
    <Screen
      header={<AppHeader title={S.sync.title} back />}
      footer={
        <>
          <AppButton title={S.sync.syncNow} onPress={run} disabled={!online || items.length === 0} />
          <AppButton
            title={S.sync.retryErrors}
            variant="secondary"
            compact
            onPress={retry}
            disabled={!items.some((i) => i.errors > 0)}
          />
        </>
      }
    >
      {items.length === 0 ? <Text style={styles.empty}>{S.sync.empty}</Text> : null}
      {items.map((it, i) => (
        <Card key={it.sessionId} title={it.sessionId.slice(0, 8)} delay={40 + i * 60}>
          <View style={styles.row}>
            <AnimatedCounter value={it.total} label={S.sync.total} />
            <AnimatedCounter value={it.done} label={S.sync.sent} color={colors.ok} />
            <AnimatedCounter value={it.pending} label={S.sync.pending} color={colors.info} />
            <AnimatedCounter value={it.errors} label={S.sync.errors} color={colors.error} />
          </View>
          <InfoRow label={S.sync.lastAttempt} value={formatDateTime(it.lastAttemptAt)} />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: font.body, marginTop: 40 },
  row: { flexDirection: 'row', marginBottom: 8 },
});
