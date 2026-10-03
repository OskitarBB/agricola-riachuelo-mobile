// src/ui/components/InfoRow.tsx — Fila "Etiqueta ........ Valor" (estado antes que texto, contexto §25.6).

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, font } from '../theme';

interface Props {
  label: string;
  value?: string | number | null;
  right?: ReactNode;
  strong?: boolean;
  dark?: boolean;
}

export function InfoRow({ label, value, right, strong, dark }: Props) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, dark && { color: '#CFE3D3' }]}>{label}</Text>
      {right ?? (
        <Text style={[styles.value, strong && styles.strong, dark && { color: colors.textOnDark }]} numberOfLines={1}>
          {value === null || value === undefined || value === '' ? '—' : String(value)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, gap: 12 },
  label: { fontSize: font.body, color: colors.textMuted, flexShrink: 1 },
  value: { fontSize: font.body, color: colors.text, fontWeight: font.weightMedium, flexShrink: 1, textAlign: 'right' },
  strong: { fontWeight: font.weightBold, fontSize: 18 },
});
