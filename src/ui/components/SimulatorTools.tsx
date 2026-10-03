// src/ui/components/SimulatorTools.tsx — Herramientas para inducir fallos con las cámaras VIRTUALES.
//
// QUÉ HACE: solo aparece cuando el controlador usa el simulador (Expo Go). Permite cortar el enlace de una
// cámara 10 s (pausa automática, reconexión y RESYNC: CP-20) y forzar una foto oscura (repetición: CP-15).
// Es plegable y con etiquetas cortas (contexto §25.4: sin textos de desarrollo).

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { controllerRuntime } from '../../controller/controllerRuntime';
import { useController } from '../../controller/controllerStore';
import { feedback } from '../feedback';
import { ROLE_LABEL, S } from '../strings';
import { colors, font, radius } from '../theme';
import { AppButton } from './AppButton';

export function SimulatorTools() {
  const kind = useController((s) => s.networkKind);
  const [open, setOpen] = useState(false);
  const sim = controllerRuntime.simulator;
  if (kind !== 'SIMULADOR' || !sim) return null;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          feedback('toggle');
          setOpen((o) => !o);
        }}
        style={styles.head}
      >
        <Text style={styles.title}>🧪 {S.pairing.tools}</Text>
        <Text style={styles.chev}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          {(['CAMERA_1', 'CAMERA_2'] as const).map((r) => (
            <View key={r} style={styles.row}>
              <AppButton
                title={S.pairing.dropCam(ROLE_LABEL[r])}
                variant="secondary"
                compact
                style={styles.flex}
                onPress={() => sim.dropCamera(r, 10_000)}
              />
              <AppButton
                title={S.pairing.forceBad(ROLE_LABEL[r])}
                variant="secondary"
                compact
                style={styles.flex}
                onPress={() => sim.forceBadPhoto(r)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginBottom: 14,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 50, paddingHorizontal: 14 },
  title: { fontSize: font.body, color: colors.textMuted, fontWeight: font.weightSemi },
  chev: { fontSize: 18, color: colors.textMuted },
  body: { padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
