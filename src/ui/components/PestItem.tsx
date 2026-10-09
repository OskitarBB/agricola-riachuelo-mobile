// src/ui/components/PestItem.tsx — Tarjeta de una alerta de plaga («Ubicar plaga», ADR 0009).
//
// QUÉ HACE:
//  - PestBadge: estado con punto del MISMO color que el marcador del mapa y texto (RNF-09: no solo color).
//  - PestItem: estado, clase sugerida o confirmada, lugar (lote · hilera · lado · plantas), hora de la foto y
//    distancia con rumbo desde tu posición («35 m al noreste ↗»). Se usa en la lista y abajo del mapa.
//  - distanceLine(): el texto de distancia (o «Sin coordenadas» / «Buscando tu ubicación…»).

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CONFIG } from '../../config';
import { arrowFor, cardinal, formatDistance } from '../../domain/geo';
import { hasLocation, labelText, pestColor, placeText, type PestWithDistance } from '../../domain/pests';
import { formatDateTime } from '../../domain/time';
import { feedback } from '../feedback';
import { S } from '../strings';
import { colors, font, radius, shadow } from '../theme';

export function pestStatusText(status: string): string {
  return S.pests.status[status] ?? S.pests.status.PENDIENTE_REVISION;
}

export function PestBadge({ status }: { status: string }) {
  const c = pestColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: `${c}1F`, borderColor: `${c}66` }]}>
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Text style={[styles.badgeText, { color: c }]}>{pestStatusText(status)}</Text>
    </View>
  );
}

export function distanceLine(r: PestWithDistance, hasMe: boolean): { text: string; arrived: boolean } {
  if (!hasLocation(r)) return { text: `${S.pests.noLocation} · ${S.pests.noLocationHint}`, arrived: false };
  if (r.distanceM === null || r.bearingDeg === null) return { text: hasMe ? S.none : S.pests.waitingGps, arrived: false };
  if (r.distanceM <= CONFIG.pests.arrivedRadiusM) return { text: S.pests.youAreThere, arrived: true };
  const dir = S.pests.cardinal[cardinal(r.bearingDeg)] ?? '';
  return { text: `${S.pests.distance(formatDistance(r.distanceM), dir)} ${arrowFor(r.bearingDeg)}`, arrived: false };
}

interface Props {
  report: PestWithDistance;
  hasMe: boolean;
  onPress?: () => void;
  selected?: boolean;
  children?: ReactNode;
}

export function PestItem({ report, hasMe, onPress, selected, children }: Props) {
  const d = distanceLine(report, hasMe);
  const title = labelText(report.label) ?? pestStatusText(report.status);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={
        onPress
          ? () => {
              feedback('tap');
              onPress();
            }
          : undefined
      }
      style={({ pressed }) => [styles.card, shadow, selected && styles.selected, pressed && onPress && { opacity: 0.85 }]}
    >
      <View style={styles.top}>
        <PestBadge status={report.status} />
        <Text style={styles.time}>{formatDateTime(report.capturedAt)}</Text>
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.place} numberOfLines={2}>
        {placeText(report)}
      </Text>
      <Text style={[styles.distance, d.arrived && styles.arrived]}>{d.text}</Text>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selected: { borderColor: colors.gold },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  badgeText: { fontSize: font.label, fontWeight: font.weightBold },
  time: { fontSize: font.label, color: colors.textMuted },
  title: { fontSize: 19, fontWeight: font.weightBold, color: colors.text, marginTop: 8 },
  place: { fontSize: font.body, color: colors.textMuted, marginTop: 2 },
  distance: { fontSize: font.body, color: colors.brand, fontWeight: font.weightSemi, marginTop: 6 },
  arrived: { color: colors.ok },
});
