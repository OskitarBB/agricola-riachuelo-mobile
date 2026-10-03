// app/controller/new-session.tsx — PANT-12 Nueva sesión (RF-17; contexto §25.1 y §25.7).
//
// QUÉ HACE (pantalla simplificada):
//   Modo de captura   [ MANUAL ] [ AUTOMÁTICO ]      ← sin "MIXTO"
//   Intervalo         [1 s] [2 s] [3 s] [5 s]
//   [ CREAR SESIÓN ]
// Reglas: con MANUAL el intervalo queda DESHABILITADO (fondo blanco, atenuado, sin interacción y sin error);
// con AUTOMÁTICO el intervalo es obligatorio y dentro de capture.minIntervalMs / maxIntervalMs.
// Exige catálogos y batería/espacio mínimos (RN-10). La sesión queda DRAFT y pasa a "Vincular cámaras".

import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { CONFIG } from '../../src/config';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import type { CaptureMode } from '../../src/domain/types';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { ChipGroup } from '../../src/ui/components/ChipGroup';
import { Screen } from '../../src/ui/components/Screen';
import { Segmented } from '../../src/ui/components/Segmented';
import { MODE_LABEL, S } from '../../src/ui/strings';
import { colors, font } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function NewSessionScreen() {
  const [mode, setMode] = useState<CaptureMode>(CONFIG.capture.defaultMode);
  const [interval, setIntervalMs] = useState<number | null>(CONFIG.capture.intervalMs);
  const [busy, setBusy] = useState(false);
  const manual = mode === 'MANUAL';

  const create = async () => {
    setBusy(true);
    const r = await controllerRuntime.createSession(mode, interval ?? CONFIG.capture.intervalMs);
    setBusy(false);
    if (!r.ok) {
      showToast(r.code, 'error');
      return;
    }
    router.replace('/controller/pairing');
  };

  return (
    <Screen
      header={<AppHeader title={S.newSession.title} back />}
      footer={
        <AppButton
          title={S.newSession.create.toUpperCase()}
          variant="gold"
          onPress={create}
          loading={busy}
          disabled={!manual && interval === null}
        />
      }
    >
      <Card title={S.newSession.mode} delay={40}>
        <Segmented<CaptureMode>
          options={[
            { value: 'MANUAL', label: MODE_LABEL.MANUAL },
            { value: 'AUTOMATICO', label: MODE_LABEL.AUTOMATICO },
          ]}
          value={mode}
          onChange={setMode}
        />
      </Card>
      <Card title={S.newSession.interval} delay={110} style={manual ? styles.disabledCard : undefined}>
        <ChipGroup<number>
          options={CONFIG.capture.intervalOptionsMs.map((ms) => ({ value: ms, label: S.newSession.seconds(ms) }))}
          value={interval}
          onChange={setIntervalMs}
          disabled={manual}
        />
        {!manual && interval === null ? <Text style={styles.err}>{S.newSession.interval}</Text> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  disabledCard: { backgroundColor: colors.disabledBg, opacity: 0.75 },
  err: { color: colors.error, fontSize: font.body, marginTop: 8 },
});
