// src/ui/components/StabilityRing.tsx — Indicador circular de estabilidad de la cámara.
//
// QUÉ HACE: un anillo que se llena según qué tan quieto está el celular (0 a 100 %) y cambia de color:
// verde = "Quieta" (puede disparar en automático), ámbar/rojo = "En movimiento". Siempre con texto.

import { useEffect } from 'react';
import { Animated, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { S } from '../strings';
import { colors, font } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  score: number; // 0..1
  stable: boolean;
  size?: number;
  dark?: boolean;
}

export function StabilityRing({ score, stable, size = 92, dark }: Props) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const v = useAnimatedValue(score);
  useEffect(() => {
    Animated.timing(v, { toValue: score, duration: 160, useNativeDriver: false }).start();
  }, [score, v]);
  const dashOffset = v.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] });
  const color = stable ? colors.ok : score > 0.5 ? colors.gold : colors.error;
  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={dark ? 'rgba(255,255,255,0.25)' : colors.border}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text style={[styles.pct, { color: dark ? '#fff' : colors.text }]}>{Math.round(score * 100)}%</Text>
      </View>
      <Text style={[styles.label, { color }]}>{stable ? S.camera.stable : S.camera.moving}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  pct: { fontSize: 18, fontWeight: font.weightBold },
  label: { marginTop: 6, fontSize: font.label, fontWeight: font.weightBold },
});
