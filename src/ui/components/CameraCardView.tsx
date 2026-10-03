// src/ui/components/CameraCardView.tsx — Tarjeta de una cámara en el controlador (PANT-13 y PANT-16, RF-42).
//
// QUÉ HACE: muestra enlace (con pulso si conecta o está inestable), usuario y modelo, batería, espacio,
// fotos pendientes, desfase de reloj y el último resultado. Al cambiar el último resultado, la tarjeta
// hace un pequeño "flash" de color para que el operador lo note sin leer.

import { useEffect } from 'react';
import { Animated, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import type { CameraCard } from '../../controller/controllerStore';
import { formatBytes, formatPct, LINK_LABEL, QUALITY_LABEL, ROLE_LABEL, S, SLOT_LABEL } from '../strings';
import { colors, font, linkTone, qualityTone, radius, shadow, slotTone, toneColors } from '../theme';
import { StatusPill } from './StatusPill';

interface Props {
  card: CameraCard;
  compact?: boolean;
}

export function CameraCardView({ card, compact }: Props) {
  const flash = useAnimatedValue(0);
  const lastKey = `${card.lastOutcome ?? ''}-${card.lastQuality ?? ''}`;
  useEffect(() => {
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 700, useNativeDriver: false }).start();
  }, [lastKey, flash]);
  const tone = card.lastOutcome ? slotTone(card.lastOutcome) : qualityTone(card.lastQuality);
  const bg = flash.interpolate({ inputRange: [0, 1], outputRange: [colors.card, toneColors(tone).bg] });
  return (
    <Animated.View style={[styles.card, shadow, { backgroundColor: bg }]}>
      <View style={styles.head}>
        <Text style={styles.role}>{ROLE_LABEL[card.role]}</Text>
        <StatusPill
          label={LINK_LABEL[card.link]}
          tone={linkTone(card.link)}
          pulse={card.link === 'INESTABLE' || card.link === 'EMPAREJANDO'}
        />
      </View>
      {card.deviceId ? (
        <>
          {!compact ? (
            <Text style={styles.sub}>
              {[card.userName, card.model, card.appVersion ? `v${card.appVersion}` : null].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <View style={styles.grid}>
            <Metric label={S.controller.battery} value={formatPct(card.batteryLevel)} />
            <Metric label={S.controller.space} value={formatBytes(card.freeSpaceBytes)} />
            <Metric label={S.pass.pendingFiles} value={String(card.pendingTransfers)} />
            <Metric label={S.pass.offset} value={card.clockOffsetMs === null ? '—' : `${card.clockOffsetMs} ms`} />
          </View>
          {card.lastOutcome || card.lastQuality ? (
            <View style={styles.last}>
              <Text style={styles.lastLabel}>{S.pass.lastResult}</Text>
              <StatusPill
                label={card.lastOutcome ? SLOT_LABEL[card.lastOutcome] : QUALITY_LABEL[card.lastQuality ?? 'CAPTURED']}
                tone={tone}
                pulse={card.lastOutcome === 'PENDIENTE'}
              />
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.waiting}>{S.pairing.waiting}</Text>
      )}
    </Animated.View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: 14, marginBottom: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  role: { fontSize: 19, fontWeight: font.weightBold, color: colors.text },
  sub: { fontSize: 15, color: colors.textMuted, marginTop: 6 },
  grid: { flexDirection: 'row', marginTop: 12 },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { fontSize: 17, fontWeight: font.weightBold, color: colors.text },
  metricLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  last: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  lastLabel: { fontSize: 15, color: colors.textMuted },
  waiting: { fontSize: font.body, color: colors.textMuted, marginTop: 10 },
});
