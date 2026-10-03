// src/ui/components/ScanFrame.tsx — Marco animado para escanear el QR (esquinas que "respiran" y línea que recorre).

import { useEffect } from 'react';
import { Animated, Easing, StyleSheet, View, useAnimatedValue } from 'react-native';

import { colors } from '../theme';

export function ScanFrame({ size = 250 }: { size?: number }) {
  const pulse = useAnimatedValue(0);
  const line = useAnimatedValue(0);
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const b = Animated.loop(
      Animated.timing(line, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [pulse, line]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const ty = line.interpolate({ inputRange: [0, 1], outputRange: [8, size - 12] });
  const c = { position: 'absolute' as const, width: 46, height: 46, borderColor: colors.goldLight };
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale }] }}>
      <View style={[c, { top: 0, left: 0, borderTopWidth: 6, borderLeftWidth: 6, borderTopLeftRadius: 18 }]} />
      <View style={[c, { top: 0, right: 0, borderTopWidth: 6, borderRightWidth: 6, borderTopRightRadius: 18 }]} />
      <View style={[c, { bottom: 0, left: 0, borderBottomWidth: 6, borderLeftWidth: 6, borderBottomLeftRadius: 18 }]} />
      <View style={[c, { bottom: 0, right: 0, borderBottomWidth: 6, borderRightWidth: 6, borderBottomRightRadius: 18 }]} />
      <Animated.View style={[styles.line, { transform: [{ translateY: ty }] }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 14, right: 14, height: 3, borderRadius: 2, backgroundColor: colors.leaf, opacity: 0.9 },
});
