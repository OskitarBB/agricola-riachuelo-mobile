// app/controller/marker.tsx — PANT-17 Cambiar marcador (hoja modal; maestro §8.6; RF-24; contexto §25.2).
//
// QUÉ HACE: lista los marcadores de la hilera agrupados por segmento; el actual aparece marcado.
// v0.6.0 (ADR 0011): arriba propone el SIGUIENTE SEGMENTO en el sentido de la pasada (ya seleccionado: basta
// «Confirmar»). En el LATERAL B (de vuelta) el marcador que se cruza es el inicio del segmento que se deja y el
// segmento nuevo es el anterior; por eso la selección guarda marcador y segmento por separado.
// "Confirmar" registra el cambio (hora y GPS) y reenvía SESSION_CONTEXT a las cámaras: las secuencias
// SIGUIENTES llevan el nuevo marcador; las anteriores no cambian. El cambio es SIEMPRE manual y, en
// AUTOMÁTICO, solo con la pasada en pausa.

import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { catalogs } from '../../src/controller/catalogService';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController } from '../../src/controller/controllerStore';
import { DEFAULT_SEGMENTS_PER_ROW, nextSegmentStep, segmentPosition } from '../../src/domain/segments';
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
  const [perRow, setPerRow] = useState(DEFAULT_SEGMENTS_PER_ROW);
  /** Selección manual (marcador + segmento). Sin elección, vale la sugerencia «Siguiente segmento». */
  const [picked, setPicked] = useState<{ markerId: string; segmentId: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = controllerRuntime.canChangeMarkerNow();

  useEffect(() => {
    if (!pass) return;
    void catalogs.markers(pass.rowId).then(setMarkers);
    void catalogs.segments(pass.rowId).then(setSegments);
    void catalogs.segmentsPerRow().then(setPerRow);
  }, [pass]);

  const step = useMemo(
    () => (pass ? nextSegmentStep(segments, markers, pass.currentSegmentId, pass.direction, perRow) : null),
    [pass, segments, markers, perRow],
  );
  const suggestion = step?.marker ? { markerId: step.marker.id, segmentId: step.segment.id } : null;
  const selected = picked ?? suggestion;
  const isCurrent = (markerId: string, segmentId: string | null) =>
    markerId === pass?.currentMarkerId && segmentId === (pass?.currentSegmentId ?? null);

  const segText = (id: string | null) => {
    const s = segments.find((x) => x.id === id);
    if (!s) return '—';
    const p = segmentPosition(segments, s.id, perRow);
    return p ? `${s.code} (${p.index} de ${p.count}) · plantas ${s.startPlant}–${s.endPlant}` : s.code;
  };

  const save = async () => {
    const m = selected ? markers.find((x) => x.id === selected.markerId) : null;
    if (!m || !selected) return;
    setBusy(true);
    const r = await controllerRuntime.changeMarker(m.id, selected.segmentId);
    setBusy(false);
    if (!r.ok) {
      showToast(r.code, 'warn');
      return;
    }
    showToast(S.marker.changed(m.code), 'success');
    router.back();
  };

  const suggestionActive = !!suggestion && selected?.markerId === suggestion.markerId && selected?.segmentId === suggestion.segmentId;

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.handle} />
      <Text style={styles.title}>{S.marker.title}</Text>
      {!check.ok ? <Text style={styles.warn}>{messageFor(check.code)}</Text> : null}
      {step && suggestion ? (
        <Pressable
          onPress={() => {
            feedback('toggle');
            setPicked(suggestion);
          }}
          style={({ pressed }) => [styles.item, styles.next, suggestionActive && styles.itemActive, pressed && { opacity: 0.75 }]}
        >
          <View style={styles.flex}>
            <Text style={[styles.nextLabel, suggestionActive && { color: colors.goldLight }]}>{S.marker.next}</Text>
            <Text style={[styles.code, suggestionActive && { color: '#fff' }]}>{segText(step.segment.id)}</Text>
            <Text style={[styles.desc, suggestionActive && { color: '#DDF2E2' }]}>
              {S.marker.nextHint(step.marker?.code ?? '—')}
            </Text>
          </View>
        </Pressable>
      ) : pass?.currentSegmentId && segments.length > 1 ? (
        <Text style={styles.info}>{S.marker.lastSegment}</Text>
      ) : null}
      {segments.length > 0 ? <Text style={styles.section}>{S.marker.others}</Text> : null}
      <FlatList
        data={markers}
        keyExtractor={(m) => m.id}
        style={styles.list}
        renderItem={({ item, index }) => {
          const active = !suggestionActive && item.id === selected?.markerId && item.segmentId === selected?.segmentId;
          const current = isCurrent(item.id, item.segmentId);
          return (
            <FadeIn delay={Math.min(index, 12) * 25}>
              <Pressable
                onPress={() => {
                  feedback('toggle');
                  setPicked({ markerId: item.id, segmentId: item.segmentId });
                }}
                style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.75 }]}
              >
                <View style={styles.flex}>
                  <Text style={[styles.code, active && { color: '#fff' }]}>{item.code}</Text>
                  <Text style={[styles.desc, active && { color: '#DDF2E2' }]}>
                    {segText(item.segmentId)}
                    {item.description ? ` · ${item.description}` : ''}
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
          disabled={!check.ok || !selected || isCurrent(selected.markerId, selected.segmentId)}
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
  next: { borderWidth: 2, borderColor: colors.gold, minHeight: 84 },
  nextLabel: { fontSize: 13, fontWeight: font.weightBold, color: colors.brand, textTransform: 'uppercase', marginBottom: 2 },
  section: { fontSize: font.label, color: colors.textMuted, fontWeight: font.weightMedium, marginTop: 4, marginBottom: 8 },
  info: {
    backgroundColor: colors.cardAlt,
    padding: 12,
    borderRadius: radius.md,
    fontSize: font.body,
    color: colors.text,
    marginBottom: 10,
  },
  code: { fontSize: 18, fontWeight: font.weightBold, color: colors.text },
  desc: { fontSize: 15, color: colors.textMuted, marginTop: 2 },
  current: { fontSize: 14, fontWeight: font.weightBold, color: colors.brand },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  flex: { flex: 1 },
});
