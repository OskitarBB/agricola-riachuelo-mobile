// src/ui/components/Card.tsx — Tarjeta blanca con sombra y entrada animada.
//
// QUÉ HACE: agrupa datos de una misma cosa (cámara, sesión, catálogos). Con `delay` se escalonan las
// tarjetas al abrir la pantalla. `tone` pinta un borde lateral de color para estados importantes.

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, font, radius, shadow, toneColors, type Tone } from '../theme';
import { FadeIn } from './FadeIn';

interface Props {
  children: ReactNode;
  title?: string;
  right?: ReactNode;
  delay?: number;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
  dark?: boolean;
}

export function Card({ children, title, right, delay = 0, tone, style, dark }: Props) {
  return (
    <FadeIn delay={delay}>
      <View
        style={[
          styles.card,
          dark && styles.dark,
          tone ? { borderLeftWidth: 6, borderLeftColor: toneColors(tone).fg } : null,
          shadow,
          style,
        ]}
      >
        {title || right ? (
          <View style={styles.header}>
            {title ? <Text style={[styles.title, dark && { color: colors.textOnDark }]}>{title}</Text> : <View />}
            {right}
          </View>
        ) : null}
        {children}
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 14 },
  dark: { backgroundColor: colors.brandDeep },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: 18, fontWeight: font.weightBold, color: colors.text },
});
