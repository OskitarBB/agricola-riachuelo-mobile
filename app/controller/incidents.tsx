// app/controller/incidents.tsx — PANT-21 Incidencias (RF-43).
//
// QUÉ HACE: lista las incidencias de la sesión actual (o las últimas) con tipo, severidad y hora; las
// automáticas las genera el sistema (desconexión, calidad, batería, espacio, transferencia…). "Agregar
// incidencia" abre un formulario (tipo, severidad, detalle) para registrar una manual (OPERADOR).
// INTEGRACIÓN FUTURA: se envían al backend en lote al sincronizar (POST /sessions/{id}/incidents/batch).

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useController } from '../../src/controller/controllerStore';
import { formatDateTime } from '../../src/domain/time';
import type { Incident, IncidentSeverity, IncidentType } from '../../src/domain/types';
import { addManualIncident, listIncidents } from '../../src/diagnostics/incidents';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { ChipGroup } from '../../src/ui/components/ChipGroup';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { TextField } from '../../src/ui/components/TextField';
import { INCIDENT_LABEL, S } from '../../src/ui/strings';
import { colors, font, radius, shadow, type Tone } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

const SEV_TONE: Record<IncidentSeverity, Tone> = { INFO: 'info', AVISO: 'warn', ERROR: 'error' };
const MANUAL_TYPES: IncidentType[] = ['OPERADOR', 'SOPORTE', 'GPS', 'TEMPERATURA', 'BATERIA', 'OTRO'];

export default function IncidentsScreen() {
  const insets = useSafeAreaInsets();
  const { session, pass } = useController();
  const [items, setItems] = useState<Incident[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IncidentType>('OPERADOR');
  const [severity, setSeverity] = useState<IncidentSeverity>('AVISO');
  const [detail, setDetail] = useState('');

  const load = useCallback(() => {
    void listIncidents(session?.sessionId ?? null).then(setItems);
  }, [session]);

  useFocusEffect(load);

  const save = async () => {
    if (!session || detail.trim().length < 3) {
      showToast('INCIDENCIA_REQUERIDA', 'warn');
      return;
    }
    await addManualIncident({ sessionId: session.sessionId, passId: pass?.passId ?? null }, type, severity, detail);
    setOpen(false);
    setDetail('');
    showToast(S.incidents.saved, 'success');
    load();
  };

  return (
    <View style={styles.flex}>
      <AppHeader title={S.incidents.title} back />
      <FlatList
        data={items}
        keyExtractor={(i) => i.incidentId}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        ListEmptyComponent={<Text style={styles.empty}>{S.incidents.empty}</Text>}
        renderItem={({ item, index }) => (
          <FadeIn delay={Math.min(index, 10) * 40}>
            <View style={[styles.item, shadow]}>
              <View style={styles.head}>
                <Text style={styles.type}>{INCIDENT_LABEL[item.type]}</Text>
                <StatusPill label={item.severity} tone={SEV_TONE[item.severity]} />
              </View>
              <Text style={styles.detail}>{item.detail}</Text>
              <Text style={styles.meta}>
                {formatDateTime(item.occurredAt)} · {item.createdBy}
              </Text>
            </View>
          </FadeIn>
        )}
      />
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <AppButton title={S.incidents.add} variant="gold" disabled={!session} onPress={() => setOpen(true)} />
      </View>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
            <Text style={styles.sheetTitle}>{S.incidents.add}</Text>
            <Text style={styles.label}>{S.incidents.type}</Text>
            <ChipGroup<IncidentType>
              options={MANUAL_TYPES.map((t) => ({ value: t, label: INCIDENT_LABEL[t] }))}
              value={type}
              onChange={setType}
            />
            <Text style={[styles.label, { marginTop: 12 }]}>{S.incidents.severity}</Text>
            <ChipGroup<IncidentSeverity>
              options={(['INFO', 'AVISO', 'ERROR'] as const).map((s) => ({ value: s, label: s }))}
              value={severity}
              onChange={setSeverity}
            />
            <View style={{ marginTop: 12 }}>
              <TextField label={S.incidents.detail} value={detail} onChangeText={setDetail} multiline />
            </View>
            <View style={styles.row}>
              <AppButton title={S.cancel} variant="secondary" style={styles.flex1} onPress={() => setOpen(false)} />
              <AppButton title={S.save} style={styles.flex1} onPress={save} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flex1: { flex: 1 },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: font.body, marginTop: 40 },
  item: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, marginBottom: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { fontSize: 18, fontWeight: font.weightBold, color: colors.text },
  detail: { fontSize: font.body, color: colors.text, marginTop: 8 },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 6 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: colors.bg,
  },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 18 },
  sheetTitle: { fontSize: 21, fontWeight: font.weightBold, color: colors.text, marginBottom: 12 },
  label: { fontSize: font.label, color: colors.textMuted, marginBottom: 8, fontWeight: font.weightMedium },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
});
