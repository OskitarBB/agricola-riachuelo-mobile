// app/controller/new-pass.tsx — PANT-15 Nueva pasada (maestro §8.4 y §8.7; RF-16, RF-20; RN-10, RN-12).
//
// QUÉ HACE: selectores encadenados SIN internet (lote → hilera → segmento → marcador de inicio), lateral
// (A primero) y dirección. Si ese lateral ya se hizo en la hilera, es "Repetir lateral" y exige el motivo
// (incidencia OPERADOR). "Iniciar pasada" exige ambas cámaras CONECTADA, prueba corta aprobada y batería/
// espacio mínimos (RN-10): envía START_PASS y, con el ACK de ambas, la pasada queda ACTIVA (≤ 3 toques, RNF-08).
// Puede recibir parámetros (lotId, rowId, lateral) desde "Crear LATERAL B" u "Otra hilera" (PANT-18).

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { catalogs } from '../../src/controller/catalogService';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController } from '../../src/controller/controllerStore';
import { evaluateNewPass } from '../../src/controller/passService';
import type { Direction, FieldRow, LateralCode, Lot, Marker, Segment } from '../../src/domain/types';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { PickerSheet } from '../../src/ui/components/PickerSheet';
import { Screen } from '../../src/ui/components/Screen';
import { Segmented } from '../../src/ui/components/Segmented';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { TextField } from '../../src/ui/components/TextField';
import { messageFor } from '../../src/ui/messages';
import { DIRECTION_LABEL, LATERAL_LABEL, LINK_LABEL, ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, linkTone, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function NewPassScreen() {
  const params = useLocalSearchParams<{ lotId?: string; rowId?: string; lateral?: string }>();
  const { session, cameras } = useController();
  const [lots, setLots] = useState<Lot[]>([]);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [lotId, setLotId] = useState<string | null>(params.lotId ?? null);
  const [rowId, setRowId] = useState<string | null>(params.rowId ?? null);
  const [lateral, setLateral] = useState<LateralCode>(params.lateral === 'LATERAL_B' ? 'LATERAL_B' : 'LATERAL_A');
  const [direction, setDirection] = useState<Direction>('ASCENDENTE');
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [markerId, setMarkerId] = useState<string | null>(null);
  const [isRepeat, setIsRepeat] = useState(false);
  const [ruleCode, setRuleCode] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void catalogs.lots().then(setLots);
  }, []);
  useEffect(() => {
    // Sin lote: lista vacía. El estado se actualiza en la promesa (no de forma síncrona en el efecto).
    let alive = true;
    void (lotId ? catalogs.rows(lotId) : Promise.resolve([])).then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, [lotId]);
  useEffect(() => {
    let alive = true;
    void (rowId ? catalogs.segments(rowId) : Promise.resolve([])).then((s) => alive && setSegments(s));
    if (!rowId) void Promise.resolve().then(() => alive && setMarkers([]));
    if (rowId) {
      void catalogs.markers(rowId).then((m) => {
        if (!alive) return;
        setMarkers(m);
        // Por defecto, el primer marcador de INICIO (o el último si se avanza en sentido descendente).
        const starts = m.filter((x) => x.position === 'INICIO');
        const def = direction === 'ASCENDENTE' ? starts[0] : starts[starts.length - 1];
        setMarkerId(def?.id ?? m[0]?.id ?? null);
        setSegmentId(def?.segmentId ?? null);
      });
    }
    return () => {
      alive = false;
    };
  }, [rowId, direction]);
  useEffect(() => {
    if (!session || !rowId) return;
    void evaluateNewPass(session.sessionId, rowId, lateral).then((e) => {
      setIsRepeat(e.isRepeat);
      setRuleCode(e.rule.ok ? null : e.rule.code);
    });
  }, [session, rowId, lateral]);

  const markerItems = useMemo(
    () =>
      markers
        .filter((m) => !segmentId || m.segmentId === segmentId)
        .map((m) => ({ value: m.id, label: m.code, hint: m.description ?? undefined })),
    [markers, segmentId],
  );

  const start = async () => {
    if (!lotId || !rowId || !markerId) {
      showToast('CONTEXTO_INCOMPLETO', 'warn');
      return;
    }
    setBusy(true);
    const r = await controllerRuntime.startPass({
      lotId,
      rowId,
      lateral,
      direction,
      segmentId: segmentId ?? markers.find((m) => m.id === markerId)?.segmentId ?? null,
      markerId,
      repeatReason: isRepeat ? reason : null,
    });
    setBusy(false);
    if (!r.ok) {
      showToast(r.code, 'error');
      return;
    }
    showToast('PASADA_INICIADA', 'success');
    router.replace('/controller/pass');
  };

  return (
    <Screen
      header={<AppHeader title={S.newPass.title} back />}
      footer={
        <>
          <AppButton
            title={(isRepeat ? S.newPass.repeatLateral : S.newPass.start).toUpperCase()}
            variant="gold"
            onPress={start}
            loading={busy}
            disabled={!!ruleCode || !markerId}
          />
          <AppButton title={S.newPass.pairing} variant="secondary" compact onPress={() => router.push('/controller/pairing')} />
        </>
      }
    >
      <FadeIn>
        <View style={styles.cams}>
          {(['CAMERA_1', 'CAMERA_2'] as const).map((r) => (
            <View key={r} style={styles.cam}>
              <Text style={styles.camName}>{ROLE_LABEL[r]}</Text>
              <StatusPill label={LINK_LABEL[cameras[r].link]} tone={linkTone(cameras[r].link)} />
            </View>
          ))}
        </View>
      </FadeIn>
      <Card delay={60}>
        <PickerSheet
          label={S.newPass.lot}
          items={lots.map((l) => ({ value: l.id, label: l.code, hint: l.name }))}
          value={lotId}
          onChange={(v) => {
            setLotId(v);
            setRowId(null);
          }}
        />
        <PickerSheet
          label={S.newPass.row}
          items={rows.map((r) => ({ value: r.id, label: `${S.newPass.row} ${r.number}`, hint: S.newPass.plants(r.plantCount) }))}
          value={rowId}
          onChange={setRowId}
          disabled={!lotId}
        />
        <Text style={styles.label}>{S.newPass.lateral}</Text>
        <Segmented<LateralCode>
          options={[
            { value: 'LATERAL_A', label: LATERAL_LABEL.LATERAL_A },
            { value: 'LATERAL_B', label: LATERAL_LABEL.LATERAL_B },
          ]}
          value={lateral}
          onChange={setLateral}
        />
        <Text style={[styles.label, { marginTop: 14 }]}>{S.newPass.direction}</Text>
        <Segmented<Direction>
          options={[
            { value: 'ASCENDENTE', label: DIRECTION_LABEL.ASCENDENTE },
            { value: 'DESCENDENTE', label: DIRECTION_LABEL.DESCENDENTE },
          ]}
          value={direction}
          onChange={setDirection}
        />
      </Card>
      <Card delay={130}>
        <PickerSheet
          label={S.newPass.segment}
          items={segments.map((s) => ({ value: s.id, label: s.code, hint: `${s.startPlant}–${s.endPlant}` }))}
          value={segmentId}
          onChange={(v) => {
            setSegmentId(v);
            const first = markers.find((m) => m.segmentId === v && m.position === 'INICIO');
            if (first) setMarkerId(first.id);
          }}
          disabled={!rowId}
        />
        <PickerSheet label={S.newPass.marker} items={markerItems} value={markerId} onChange={setMarkerId} disabled={!rowId} />
      </Card>
      {isRepeat ? (
        <FadeIn from="scale">
          <Card tone="warn">
            <TextField label={S.newPass.repeatReason} value={reason} onChangeText={setReason} multiline />
          </Card>
        </FadeIn>
      ) : null}
      {ruleCode ? <Text style={styles.warn}>{messageFor(ruleCode)}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cams: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cam: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: 12, gap: 6 },
  camName: { fontSize: font.body, fontWeight: font.weightBold, color: colors.text },
  label: { fontSize: font.label, color: colors.textMuted, fontWeight: font.weightMedium, marginBottom: 6 },
  warn: { backgroundColor: colors.warnBg, padding: 12, borderRadius: radius.md, fontSize: font.body, color: colors.text },
});
