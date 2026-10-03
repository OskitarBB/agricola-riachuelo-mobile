// src/ui/components/FadeIn.tsx — Animación de entrada (aparece y sube suavemente).
//
// QUÉ HACE: envuelve cualquier bloque para que entre con opacidad y desplazamiento. `delay` permite
// escalonar tarjetas y botones y darle dinamismo a cada pantalla sin afectar el rendimiento (driver nativo).

import { useEffect, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle, useAnimatedValue } from 'react-native';

interface Props {
  children: ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  from?: 'bottom' | 'top' | 'left' | 'right' | 'scale';
}

export function FadeIn({ children, delay = 0, distance = 18, duration = 420, style, from = 'bottom' }: Props) {
  const v = useAnimatedValue(0);
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay, duration]);
  const offset = v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  const transform =
    from === 'scale'
      ? [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }]
      : from === 'top'
        ? [{ translateY: Animated.multiply(offset, -1) }]
        : from === 'left'
          ? [{ translateX: Animated.multiply(offset, -1) }]
          : from === 'right'
            ? [{ translateX: offset }]
            : [{ translateY: offset }];
  return <Animated.View style={[{ opacity: v, transform }, style]}>{children}</Animated.View>;
}
