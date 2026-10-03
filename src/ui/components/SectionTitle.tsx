// src/ui/components/SectionTitle.tsx — Título corto de sección (menos texto, más estado: contexto §25.6).

import { StyleSheet, Text } from 'react-native';

import { colors, font } from '../theme';

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.t}>{children}</Text>;
}

const styles = StyleSheet.create({
  t: {
    fontSize: 15,
    fontWeight: font.weightBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 6,
  },
});
