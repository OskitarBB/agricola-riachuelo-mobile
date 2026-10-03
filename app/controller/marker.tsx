// app/controller/marker.tsx — PANT-17 Cambiar marcador (hoja modal; maestro §8.6; RF-24; contexto §25.2).
//
// QUÉ HACE: lista los marcadores de la hilera agrupados por segmento; el actual aparece marcado.
// "Confirmar" registra el cambio (hora y GPS) y reenvía SESSION_CONTEXT a las cámaras: las secuencias
// SIGUIENTES llevan el nuevo marcador; las anteriores no cambian. El cambio es SIEMPRE manual y, en
// AUTOMÁTICO, solo con la pasada en pausa.

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { catalogs } from '../../src/controller/catalogService';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController } from '../../src/controller/controllerStore';
import type { Marker, Segment } from '../../src/domain/types';
import { AppButton } from '../../src/ui/components/AppButton';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function MarkerModal() {
  const insets = useSafeAreaInsets();
  const pass = useController((s) => s.pass);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selected, setSelected] = useState<string | null>(pass?.currentMarkerId ?? null);
  const [busy, setBusy] = useState(false);
  const check = controllerRuntime.canChangeMarkerNow();

  useEffect(() => {
    if (!pass) return;
    void catalogs.markers(pass.rowId).then(setMarkers);
    void catalogs.segments(pass.rowId).then(setSegments);
  }, [pass]);

  const segCode = (id: string | null) => segments.find((s) => s.id === id)?.code ?? '—';

  const save = async () => {
    const m = markers.find((x) => x.id === selected);
    if (!m) return;
    setBusy(true);
    const r = await controllerRuntime.changeMarker(m.id, m.segmentId);
    setBusy(false);
    if (!r.ok) {
      showToast(r.code, 'warn');
      return;
    }
    showToast(S.marker.changed(m.code), 'success');
    router.back();
  };

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.handle} />
      <Text style={styles.title}>{S.marker.title}</Text>
      {!check.ok ? <Text style={styles.warn}>{messageFor(check.code)}</Text> : null}
      <FlatList
        data={markers}
        keyExtractor={(m) => m.id}
        style={styles.list}
        renderItem={({ item, index }) => {
          const active = item.id === selected;
          const current = item.id === pass?.currentMarkerId;
          return (
            <FadeIn delay={Math.min(index, 12) * 25}>
              <Pressable
                onPress={() => {
                  feedback('toggle');
                  setSelected(item.id);
                }}
                style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.75 }]}
              >
                <View style={styles.flex}>
                  <Text style={[styles.code, active && { color: '#fff' }]}>{item.code}</Text>
                  <Text style={[styles.desc, active && { color: '#DDF2E2' }]}>
                    {segCode(item.segmentId)} · {item.description ?? ''}
                  </Text>
                </View>
                {current ? <Text style={[styles.current, active && { color: colors.goldLight }]}>{S.marker.current}</Text> : null}
              </Pressable>
            </FadeIn>
          );
        }}
      />
      <View style={styles.row}>
        <AppButton title={S.cancel} variant="secondary" style={styles.flex} onPress={() => router.back()} />
        <AppButton
          title={S.marker.confirm}
          style={styles.flex}
          onPress={save}
          loading={busy}
          disabled={!check.ok || !selected || selected === pass?.currentMarkerId}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.card, paddingHorizontal: 16, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 48, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: font.weightBold, color: colors.text, marginBottom: 10 },
  warn: {
    backgroundColor: colors.warnBg,
    padding: 12,
    borderRadius: radius.md,
    fontSize: font.body,
    color: colors.text,
    marginBottom: 10,
  },
  list: { flex: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.cardAlt,
  },
  itemActive: { backgroundColor: colors.brand },
  code: { fontSize: 18, fontWeight: font.weightBold, color: colors.text },
  desc: { fontSize: 15, color: colors.textMuted, marginTop: 2 },
  current: { fontSize: 14, fontWeight: font.weightBold, color: colors.brand },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  flex: { flex: 1 },
});
