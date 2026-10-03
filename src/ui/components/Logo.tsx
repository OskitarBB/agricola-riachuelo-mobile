// src/ui/components/Logo.tsx — Logo de Agrícola Riachuelo con animación de entrada y "flotación" suave.
//
// QUÉ HACE: el logo aparece creciendo con un rebote y luego flota arriba/abajo lentamente (sensación viva
// en el login y el arranque). `size` controla el ancho; el alto respeta la proporción del archivo.

import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle, useAnimatedValue } from 'react-native';

const LOGO = require('../../../assets/images/logo-riachuelo.png');
const RATIO = 725 / 1225; // alto / ancho del archivo recortado

interface Props {
  size?: number;
  float?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Logo({ size = 260, float = true, style }: Props) {
  const enter = useAnimatedValue(0);
  const bob = useAnimatedValue(0);
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 6, bounciness: 12 }).start();
    if (!float) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, bob, float]);
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  return (
    <Animated.View style={[{ opacity: enter, transform: [{ scale }, { translateY }] }, style]}>
      <Image
        source={LOGO}
        style={{ width: size, height: size * RATIO }}
        contentFit="contain"
        accessibilityLabel="Agrícola Riachuelo"
      />
    </Animated.View>
  );
}
