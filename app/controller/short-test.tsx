// app/controller/short-test.tsx — PANT-14 Prueba corta (maestro §14.12; RF-19).
//
// QUÉ HACE: envía una orden de prueba a ambas cámaras y muestra por cámara: respuesta (CAPTURE_OK o
// QUALITY_ERROR), calidad con métricas, transferencia (foto recibida y verificada), tiempo y el desfase entre
// cámaras. Una foto de mala calidad APRUEBA la comunicación pero avisa PRUEBA_CORTA_CALIDAD. Solo con ambas
// aprobadas la sesión pasa a READY y se habilita "Continuar" (Nueva pasada). Las fotos de prueba no son evidencia.

import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CONFIG } from '../../src/config';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController, type ShortTestCamResult } from '../../src/controller/controllerStore';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { QUALITY_LABEL, ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, qualityTone, radius, type Tone } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

/** Motivo de la reprobación en palabras simples (shortTestFailReason). */
function reasonText(r: ShortTestCamResult): string {
  const R = S.shortTest.reasons;
  switch (r.detail) {
    case 'RESPUESTA_LENTA':
      return R.RESPUESTA_LENTA(secs(r.responseMs), secs(CONFIG.protocol.captureResponseTimeoutMs));
    case 'DEMASIADO_LENTA':
      return R.DEMASIADO_LENTA(secs(r.totalMs), secs(CONFIG.shortTest.timeoutMs));
    case 'SIN_RESPUESTA':
    case 'ERROR':
    case 'ERROR_CAMARA':
    case 'FOTO_NO_LLEGO':
    case 'CALIDAD':
      return R[r.detail];
    default:
      return r.detail ?? '';
  }
}

function stateView(r: ShortTestCamResult): { label: string; tone: Tone } {
  switch (r.state) {
    case 'APROBADA':
      return { label: S.shortTest.passed, tone: 'ok' };
    case 'APROBADA_CALIDAD':
      return { label: S.shortTest.passed, tone: 'warn' };
    case 'REPROBADA':
      return { label: S.shortTest.failed, tone: 'error' };
    case 'EN_CURSO':
      return { label: S.shortTest.running, tone: 'info' };
    default:
      return { label: S.shortTest.notRun, tone: 'neutral' };
  }
}

export default function ShortTestScreen() {
  const { shortTest, session, cameras } = useController();
  const passedSession = !!session?.shortTestPassedAt && session.status !== 'PREPARING';
  const ready = cameras.CAMERA_1.link === 'CONECTADA' && cameras.CAMERA_2.link === 'CONECTADA';
  const ran = shortTest.CAMERA_1.state !== 'SIN_EJECUTAR';

  useEffect(() => {
    if (!shortTest.running && ran) feedback(shortTest.passed ? 'success' : 'error');
  }, [shortTest.running, shortTest.passed, ran]);

  const run = async () => {
    const r = await controllerRuntime.runShortTest();
    if (!r.ok) showToast(r.code, 'warn');
  };

  return (
    <Screen
      header={<AppHeader title={S.shortTest.title} back />}
      footer={
        <>
          {!passedSession ? (
            <AppButton
              title={ran ? S.shortTest.repeat : S.shortTest.run}
              variant="gold"
              onPress={run}
              loading={shortTest.running}
              disabled={!ready}
            />
          ) : null}
          <AppButton title={S.continue} onPress={() => router.replace('/controller/new-pass')} disabled={!passedSession} />
        </>
      }
    >
      {!ready && !passedSession ? <Text style={styles.warn}>{messageFor('CAMARAS_NO_LISTAS')}</Text> : null}
      {(['CAMERA_1', 'CAMERA_2'] as const).map((role, i) => {
        const r = shortTest[role];
        const v = stateView(r);
        return (
          <Card
            key={role}
            title={ROLE_LABEL[role]}
            right={<StatusPill label={v.label} tone={v.tone} pulse={r.state === 'EN_CURSO'} />}
            delay={60 + i * 80}
            tone={v.tone}
          >
            <InfoRow label={S.shortTest.response} value={r.response ?? '—'} />
            <InfoRow
              label={S.shortTest.quality}
              right={
                r.quality ? (
                  <StatusPill label={QUALITY_LABEL[r.quality]} tone={qualityTone(r.quality)} />
                ) : (
                  <Text style={styles.dash}>—</Text>
                )
              }
            />
            <InfoRow label={S.shortTest.transfer} value={r.transferred ? 'OK' : '—'} />
            <InfoRow
              label={S.shortTest.time}
              value={
                r.totalMs !== null
                  ? `${(r.totalMs / 1000).toFixed(1)} s`
                  : r.responseMs !== null
                    ? `${(r.responseMs / 1000).toFixed(1)} s`
                    : '—'
              }
            />
            {r.state === 'REPROBADA' && r.detail ? <Text style={styles.reason}>{reasonText(r)}</Text> : null}
          </Card>
        );
      })}
      <Card delay={240}>
        <InfoRow label={S.shortTest.offset} value={shortTest.offsetMs !== null ? `${shortTest.offsetMs} ms` : '—'} strong />
      </Card>
      {passedSession ? (
        <View style={styles.ok}>
          <Text style={styles.okText}>{messageFor('PRUEBA_APROBADA')}</Text>
        </View>
      ) : null}
      {shortTest.CAMERA_1.state === 'APROBADA_CALIDAD' || shortTest.CAMERA_2.state === 'APROBADA_CALIDAD' ? (
        <Text style={styles.warn}>{messageFor('PRUEBA_CORTA_CALIDAD')}</Text>
      ) : null}
      {shortTest.CAMERA_1.state === 'REPROBADA' || shortTest.CAMERA_2.state === 'REPROBADA' ? (
        <Text style={styles.err}>{messageFor('PRUEBA_CORTA_FALLIDA')}</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  reason: { marginTop: 8, fontSize: font.body, fontWeight: '700', color: colors.error },
  dash: { fontSize: font.body, color: colors.text },
  warn: {
    backgroundColor: colors.warnBg,
    padding: 12,
    borderRadius: radius.md,
    fontSize: font.body,
    color: colors.text,
    marginBottom: 10,
  },
  err: {
    backgroundColor: colors.errorBg,
    padding: 12,
    borderRadius: radius.md,
    fontSize: font.body,
    color: colors.error,
    marginBottom: 10,
  },
  ok: { backgroundColor: colors.okBg, padding: 14, borderRadius: radius.md, marginBottom: 10 },
  okText: { color: colors.ok, fontSize: font.body, fontWeight: font.weightSemi, textAlign: 'center' },
});
