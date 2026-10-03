// src/ui/components/AnimatedCounter.tsx — Número que "salta" cuando cambia (contadores de secuencias).

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import { colors, font } from '../theme';

interface Props {
  value: number;
  label: string;
  color?: string;
}

export function AnimatedCounter({ value, label, color = colors.text }: Props) {
  const s = useAnimatedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    Animated.sequence([
      Animated.timing(s, { toValue: 1.3, duration: 120, useNativeDriver: true }),
      Animated.spring(s, { toValue: 1, useNativeDriver: true, bounciness: 14 }),
    ]).start();
  }, [value, s]);
  return (
    <View style={styles.wrap}>
      <Animated.Text style={[styles.value, { color, transform: [{ scale: s }] }]}>{value}</Animated.Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center' },
  value: { fontSize: 30, fontWeight: font.weightBold },
  label: { fontSize: 15, color: colors.textMuted, marginTop: 2 },
});
