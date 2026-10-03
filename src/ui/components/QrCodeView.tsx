// src/ui/components/QrCodeView.tsx — Dibuja el QR de emparejamiento (maestro §14.2) con react-native-svg.
//
// QUÉ HACE: genera la matriz con qrcode-generator (MIT, JavaScript puro: funciona en Expo Go) y la dibuja
// como un solo <Path>. Nivel de corrección M y margen blanco (zona de silencio) para lectura fácil en campo.
// Aparece con una animación de escala cada vez que cambia (p. ej. "Regenerar QR").

import qrcodeGenerator from 'qrcode-generator';
import { useEffect, useMemo } from 'react';
import { Animated, StyleSheet, View, useAnimatedValue } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors, radius } from '../theme';

interface Props {
  value: string;
  size?: number;
}

export function QrCodeView({ value, size = 260 }: Props) {
  const { path, count } = useMemo(() => {
    const qr = qrcodeGenerator(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { path: d, count: n + 8 };
  }, [value]);

  const s = useAnimatedValue(0);
  useEffect(() => {
    s.setValue(0);
    Animated.spring(s, { toValue: 1, useNativeDriver: true, bounciness: 10 }).start();
  }, [value, s]);

  return (
    <Animated.View
      style={[styles.wrap, { opacity: s, transform: [{ scale: s.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }]}
    >
      <View style={styles.inner}>
        <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
          <Rect x={0} y={0} width={count} height={count} fill="#FFFFFF" />
          <Path d={path} fill={colors.brandDeep} />
        </Svg>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  inner: { padding: 10, backgroundColor: '#fff', borderRadius: radius.lg, borderWidth: 3, borderColor: colors.gold },
});
