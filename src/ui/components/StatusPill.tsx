// src/ui/components/StatusPill.tsx — Etiqueta de estado con punto de color y TEXTO (RNF-09: no solo color).
//
// QUÉ HACE: muestra estados como CONECTADA, PERDIDA, UTILIZABLE… El punto "late" (pulso) cuando `pulse`
// es verdadero, para estados en curso (conectando, capturando, automático activo).

import { useEffect } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle, useAnimatedValue } from 'react-native';

import { font, radius, toneColors, type Tone } from '../theme';

interface Props {
  label: string;
  tone: Tone;
  pulse?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function StatusPill({ label, tone, pulse, big, style }: Props) {
  const c = toneColors(tone);
  const v = useAnimatedValue(1);
  useEffect(() => {
    if (!pulse) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, v]);
  return (
    <View style={[styles.pill, big && styles.big, { backgroundColor: c.bg }, style]}>
      <Animated.View style={[styles.dot, big && styles.bigDot, { backgroundColor: c.fg, opacity: v }]} />
      <Text style={[styles.text, big && styles.bigText, { color: c.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  big: { paddingHorizontal: 14, paddingVertical: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  bigDot: { width: 12, height: 12, borderRadius: 6 },
  text: { fontSize: font.label, fontWeight: font.weightBold, letterSpacing: 0.4 },
  bigText: { fontSize: 18 },
});
