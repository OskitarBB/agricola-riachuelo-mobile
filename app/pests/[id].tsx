// app/pests/[id].tsx — PANT-41 Detalle de una alerta de plaga (ADR 0009).
//
// QUÉ HACE: muestra la foto (miniatura firmada por la plataforma; se ve con internet), el estado de revisión, la clase
// sugerida o confirmada (la IA «sugiere indicios», no diagnostica), el lugar en palabras (lote, hilera, lado, plantas
// y marcador), de dónde viene la ubicación y su precisión, y la distancia y dirección desde tu posición. Botones:
// «Cómo llegar» (Google Maps a pie), «Ver punto en Google Maps» y «Ver en el mapa» (PANT-40 con esta alerta elegida).
// Si la alerta ya no está en la lista (p. ej., el especialista la descartó) lo dice y ofrece volver.

import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppSession } from '../../src/auth/authStore';
import { hasLocation, labelText, withDistance } from '../../src/domain/pests';
import { formatDateTime } from '../../src/domain/time';
import { openPointInMaps, openWalkingDirections } from '../../src/pests/openMaps';
import { loadPests, usePests, watchMyPosition } from '../../src/pests/pestService';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { distanceLine, PestBadge } from '../../src/ui/components/PestItem';
import { Screen } from '../../src/ui/components/Screen';
import { S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function PestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { cache, me } = usePests();
  const { online } = useAppSession();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      let stop: (() => void) | null = null;
      void loadPests();
      void watchMyPosition().then((s) => {
        if (alive) stop = s;
        else s();
      });
      return () => {
        alive = false;
        stop?.();
      };
    }, []),
  );

  const report = useMemo(() => {
    const r = cache?.data.reports.find((x) => x.caseId === id);
    return r ? withDistance([r], me)[0] : null;
  }, [cache, id, me]);

  if (!report) {
    return (
      <Screen header={<AppHeader title={S.pests.title} back />}>
        <Card tone="warn">
          <Text style={styles.body}>{S.pests.notFound}</Text>
        </Card>
        <AppButton
          title={S.back}
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/pests'))}
        />
      </Screen>
    );
  }

  const located = hasLocation(report);
  const d = distanceLine(report, !!me);
  const title = labelText(report.label) ?? S.pests.status[report.status] ?? S.pests.status.PENDIENTE_REVISION;
  const source = S.pests.locationSource[report.locationSource] ?? S.pests.locationSource.NINGUNA;
  const pct = report.maxConfidence !== null ? Math.round(report.maxConfidence * 100) : null;

  const go = async () => {
    if (!located) return;
    const ok = await openWalkingDirections(report.lat as number, report.lon as number, report.caseId);
    if (!ok) showToast('MAPS_NO_DISPONIBLE', 'error');
  };
  const point = async () => {
    if (!located) return;
    const ok = await openPointInMaps(report.lat as number, report.lon as number);
    if (!ok) showToast('MAPS_NO_DISPONIBLE', 'error');
  };

  return (
    <Screen
      header={<AppHeader title={title} back />}
      footer={
        located ? (
          <>
            <AppButton title={S.pests.howToGo} onPress={go} />
            <View style={styles.row}>
              <AppButton
                title={S.pests.seeOnMap}
                variant="secondary"
                compact
                style={styles.flex}
                onPress={() => router.navigate({ pathname: '/pests', params: { focus: report.caseId } })}
              />
              <AppButton title={S.pests.openInMaps} variant="secondary" compact style={styles.flex} onPress={point} />
            </View>
          </>
        ) : undefined
      }
    >
      <Card delay={20}>
        <View style={styles.top}>
          <PestBadge status={report.status} />
          {pct !== null ? <Text style={styles.muted}>{S.pests.aiHint(pct)}</Text> : null}
        </View>
        <Text style={[styles.distance, d.arrived && styles.arrived]}>{d.text}</Text>
        {report.thumbnailUrl && online ? (
          <Image
            source={{ uri: report.thumbnailUrl }}
            style={styles.photo}
            contentFit="cover"
            transition={200}
            accessibilityLabel={S.pests.photo}
          />
        ) : (
          <Text style={styles.muted}>{S.pests.photoOffline}</Text>
        )}
      </Card>

      <Card title={S.pests.place} delay={80}>
        <InfoRow label={S.pests.lot} value={`${report.lot.code} — ${report.lot.name}`} />
        <InfoRow label={S.pests.row} value={report.row.number} strong />
        <InfoRow label={S.pests.side} value={report.lateralLabel || report.lateralCode} />
        {report.segment ? (
          <InfoRow label={S.pests.plants} value={`${report.segment.startPlant}–${report.segment.endPlant}`} strong />
        ) : null}
        {report.marker ? <InfoRow label={S.pests.marker} value={report.marker.code} /> : null}
      </Card>

      <Card title={S.pests.location} delay={140}>
        <Text style={styles.body}>{source}</Text>
        {report.gpsAccuracyM !== null && report.locationSource === 'GPS' ? (
          <Text style={styles.muted}>{S.pests.accuracy(report.gpsAccuracyM)}</Text>
        ) : null}
        {!located ? <Text style={styles.muted}>{S.pests.noLocationHint}</Text> : null}
        {me?.accuracyM ? <InfoRow label={S.pests.myGps} value={S.pests.accuracy(me.accuracyM)} /> : null}
        <InfoRow label={S.pests.capturedAt} value={formatDateTime(report.capturedAt)} />
        {report.decidedAt ? <InfoRow label={S.pests.decidedAt} value={formatDateTime(report.decidedAt)} /> : null}
      </Card>

      {report.observation ? (
        <Card title={S.pests.observation} delay={200}>
          <Text style={styles.body}>{report.observation}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  muted: { fontSize: font.label, color: colors.textMuted, marginTop: 6 },
  body: { fontSize: font.body, color: colors.text },
  distance: { fontSize: font.big, fontWeight: font.weightBold, color: colors.brand, marginTop: 10 },
  arrived: { color: colors.ok },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, marginTop: 12, backgroundColor: colors.cardAlt },
});
