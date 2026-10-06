// app/controller/sync.tsx — PANT-20 Sincronización (RF-39 a RF-41, RF-49 a RF-51; maestro v2.0 §8.9 y §15.5).
//
// QUÉ HACE:
//  - Arriba: servidor, con/sin internet, avance de la ronda en curso (elemento, paso de la foto: permiso de subida,
//    subida a la nube o confirmación, y bytes enviados) y el resultado de la última sincronización.
//  - Por sesión: total, enviados, pendientes y errores; para las fotos: en la nube, por confirmar, con error y MB por
//    subir; último intento; y los elementos que requieren revisión con su código (p. ej. FOTO_DEMASIADO_GRANDE).
//  - «Sincronizar ahora» (con datos móviles pide confirmación con el tamaño), «Detener» mientras corre y
//    «Reintentar errores». Requiere internet y sesión de usuario ONLINE (si es OFFLINE, el aviso de la cabecera
//    permite validar la contraseña sin salir de la pantalla).
// La lógica está en src/sync/syncService.ts; esta pantalla solo la llama y muestra el estado (R-05).

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { checkBackend } from '../../src/auth/authService';
import { useAppSession } from '../../src/auth/authStore';
import { apiHostLabel, ENV, isSecureApiUrl } from '../../src/config';
import { formatDateTime } from '../../src/domain/time';
import { currentNetworkType } from '../../src/device/networkMonitor';
import { syncOverview, type SyncOverview, type SyncSessionView } from '../../src/sync/syncQueue';
import { retrySyncErrors, runSync, stopSync } from '../../src/sync/syncService';
import { useSyncStore, type SyncRunResult } from '../../src/sync/syncStore';
import { AnimatedCounter } from '../../src/ui/components/AnimatedCounter';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { messageFor, syncCodeMessage } from '../../src/ui/messages';
import { formatBytes, S, SESSION_LABEL } from '../../src/ui/strings';
import { colors, font, radius, type Tone } from '../../src/ui/theme';
import { showToast, type ToastKind } from '../../src/ui/toast';

const RELOAD_EVERY_MS = 1_500;
const MAX_ERRORS_SHOWN = 5;

function resultKind(r: SyncRunResult): ToastKind {
  if (r.ok || r.code === 'NADA_PENDIENTE') return 'success';
  if (r.code === 'SINCRONIZACION_PARCIAL' || r.code === 'SINCRONIZACION_DETENIDA' || r.code === 'SINCRONIZACION_EN_CURSO') {
    return 'warn';
  }
  if (r.code === 'SINCRONIZACION_CON_ERRORES') return 'warn';
  return 'error';
}

function sessionTone(s: SyncSessionView): { tone: Tone; label: string } {
  if (s.errors > 0) return { tone: 'error', label: S.sync.errors };
  if (s.pending > 0) return { tone: 'info', label: S.sync.pending };
  return { tone: 'ok', label: s.sessionStatus ? SESSION_LABEL[s.sessionStatus] : SESSION_LABEL.SYNCED };
}

/** Vuelve a leer el resumen como máximo cada RELOAD_EVERY_MS mientras la ronda avanza. */
function useThrottledReload(load: () => Promise<void>, tick: number): void {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const wait = Math.max(0, last.current + RELOAD_EVERY_MS - Date.now());
    if (timer.current) return; // ya hay una lectura programada
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      void load();
    }, wait);
  }, [tick, load]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}

export default function SyncScreen() {
  const online = useAppSession((s) => s.online);
  const mode = useAppSession((s) => s.mode);
  const sync = useSyncStore();
  const [data, setData] = useState<SyncOverview | null>(null);

  const load = useCallback(async () => {
    setData(await syncOverview());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void checkBackend(false);
    }, [load]),
  );
  useThrottledReload(load, sync.tick);

  const pending = data?.pending ?? 0;
  const errors = data?.errors ?? 0;
  const canSync = online && mode === 'ONLINE' && !sync.running && pending > 0;

  const finish = async (r: SyncRunResult) => {
    showToast(r.code, resultKind(r));
    await load();
  };

  const run = async () => {
    if (mode !== 'ONLINE') {
      showToast('REAUTENTICACION_REQUERIDA', 'warn');
      return;
    }
    const bytes = data?.pendingBytes ?? 0;
    if (bytes > 0 && (await currentNetworkType()) === 'DATOS_MOVILES') {
      const ok = await confirm({
        title: S.sync.mobileDataTitle,
        message: S.sync.mobileDataBody(formatBytes(bytes)),
        confirmText: S.sync.send,
      });
      if (!ok) return;
    }
    await finish(await runSync({ trigger: 'MANUAL' }));
  };

  const retry = async () => {
    await finish(await retrySyncErrors());
  };

  const last = sync.lastResult ?? data?.lastSync ?? null;
  const total = Math.max(sync.totalAtStart, 1);
  const processed = sync.done + sync.errors;
  const pct = sync.running ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const upload = sync.upload && sync.upload.totalBytes > 0 ? sync.upload : null;

  return (
    <Screen
      header={<AppHeader title={S.sync.title} back />}
      footer={
        <>
          {sync.running ? (
            <AppButton
              title={sync.stopping ? S.sync.stopping : S.sync.stop}
              variant="danger"
              onPress={stopSync}
              disabled={sync.stopping}
            />
          ) : (
            <AppButton title={S.sync.syncNow} onPress={run} disabled={!canSync} />
          )}
          <AppButton
            title={S.sync.retryErrors}
            variant="secondary"
            compact
            onPress={retry}
            disabled={errors === 0 || sync.running || !online || mode !== 'ONLINE'}
          />
        </>
      }
    >
      <Card delay={20} tone={sync.running ? 'info' : undefined}>
        <InfoRow
          label={S.sync.server}
          right={<StatusPill label={online ? S.online : S.offline} tone={online ? 'ok' : 'neutral'} />}
        />
        <Text style={styles.host}>
          {apiHostLabel()}
          {!ENV.useMockApi && !isSecureApiUrl() ? ` · ${S.settings.insecure}` : ''}
        </Text>
        {mode !== 'ONLINE' ? <Text style={styles.alert}>{S.sync.needsOnline}</Text> : null}
        {sync.running ? (
          <View style={styles.progressBox}>
            <View style={styles.progressHead}>
              <StatusPill label={S.sync.running} tone="info" pulse />
              <Text style={styles.progressText}>{S.sync.progress(processed, sync.totalAtStart)}</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${pct}%` }]} />
            </View>
            {sync.current ? (
              <Text style={styles.current}>
                {S.sync.entity[sync.current.entityType]}
                {sync.current.step ? ` · ${S.sync.step[sync.current.step]}` : ''}
                {upload ? ` · ${S.sync.uploading(formatBytes(upload.bytesSent), formatBytes(upload.totalBytes))}` : ''}
              </Text>
            ) : null}
          </View>
        ) : last ? (
          <>
            <InfoRow label={S.sync.lastSync} value={formatDateTime(last.finishedAt)} />
            <Text style={[styles.result, { color: last.ok ? colors.ok : colors.textMuted }]}>{messageFor(last.code)}</Text>
          </>
        ) : null}
      </Card>

      {data && data.sessions.length === 0 ? <Text style={styles.empty}>{S.sync.empty}</Text> : null}

      {(data?.sessions ?? []).map((it, i) => {
        const st = sessionTone(it);
        return (
          <Card
            key={it.sessionId}
            title={`${S.sync.started} ${formatDateTime(it.startedAt)}`}
            right={<StatusPill label={st.label} tone={st.tone} />}
            tone={it.errors > 0 ? 'error' : undefined}
            delay={60 + i * 50}
          >
            <View style={styles.row}>
              <AnimatedCounter value={it.total} label={S.sync.total} />
              <AnimatedCounter value={it.done} label={S.sync.sent} color={colors.ok} />
              <AnimatedCounter value={it.pending} label={S.sync.pending} color={colors.info} />
              <AnimatedCounter value={it.errors} label={S.sync.errors} color={colors.error} />
            </View>
            {it.capturesTotal > 0 ? (
              <>
                <InfoRow
                  label={S.sync.photos}
                  value={`${S.sync.inCloud} ${it.cloud.confirmed} · ${S.sync.toConfirm} ${it.cloud.uploadedNotConfirmed} · ${S.sync.withError} ${it.capturesErrors}`}
                />
                {it.pendingCaptureBytes > 0 ? <InfoRow label={S.sync.toUpload} value={formatBytes(it.pendingCaptureBytes)} /> : null}
              </>
            ) : null}
            <InfoRow label={S.sync.lastAttempt} value={formatDateTime(it.lastAttemptAt)} />
            {it.errorItems.length > 0 ? (
              <View style={styles.errors}>
                <Text style={styles.errorsTitle}>{S.sync.review}</Text>
                {it.errorItems.slice(0, MAX_ERRORS_SHOWN).map((e) => (
                  <View key={`${e.entityType}-${e.entityId}`} style={styles.errorRow}>
                    <Text style={styles.errorCode}>
                      {S.sync.entity[e.entityType]} · {e.code ?? '—'}
                    </Text>
                    <Text style={styles.errorText}>{syncCodeMessage(e.code)}</Text>
                  </View>
                ))}
                {it.errorItems.length > MAX_ERRORS_SHOWN ? (
                  <Text style={styles.errorText}>{S.sync.more(it.errorItems.length - MAX_ERRORS_SHOWN)}</Text>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: font.body, marginTop: 30 },
  row: { flexDirection: 'row', marginBottom: 8 },
  host: { color: colors.textMuted, fontSize: font.label, marginBottom: 6 },
  alert: {
    marginTop: 6,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.warnBg,
    color: colors.text,
    fontSize: font.body,
  },
  progressBox: { marginTop: 8, gap: 8 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressText: { color: colors.text, fontSize: font.body, fontWeight: font.weightSemi },
  bar: { height: 10, borderRadius: radius.pill, backgroundColor: colors.neutralBg, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: radius.pill, backgroundColor: colors.brand },
  current: { color: colors.textMuted, fontSize: font.label },
  result: { fontSize: font.body, marginTop: 2 },
  errors: { marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: colors.errorBg, gap: 8 },
  errorsTitle: { color: colors.error, fontSize: font.label, fontWeight: font.weightBold },
  errorRow: { gap: 2 },
  errorCode: { color: colors.text, fontSize: font.label, fontWeight: font.weightSemi },
  errorText: { color: colors.text, fontSize: font.label },
});
