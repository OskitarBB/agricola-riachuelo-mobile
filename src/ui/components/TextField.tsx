// src/ui/components/TextField.tsx — Caja de texto con etiqueta, error por campo y animación de foco.
//
// QUÉ HACE: al enfocar, la línea inferior se ilumina (verde) con una transición; si hay error se pinta en
// rojo y el campo "tiembla" una vez para llamar la atención. Para contraseñas incluye Mostrar/Ocultar.

import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextInput, type TextInputProps, useAnimatedValue } from 'react-native';

import { feedback } from '../feedback';
import { S } from '../strings';
import { colors, font, radius } from '../theme';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  secure?: boolean;
}

export function TextField({ label, error, secure, onFocus, onBlur, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const focus = useAnimatedValue(0);
  const shake = useAnimatedValue(0);

  useEffect(() => {
    Animated.timing(focus, { toValue: focused ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [focused, focus]);

  useEffect(() => {
    if (!error) return;
    Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [error, shake]);

  const borderColor = error
    ? colors.error
    : focus.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.brandLight] });

  return (
    <Animated.View
      style={[styles.wrap, { transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-6, 6] }) }] }]}
    >
      <Text style={styles.label}>{label}</Text>
      <Animated.View style={[styles.box, { borderColor }]}>
        <TextInput
          {...rest}
          secureTextEntry={secure ? hidden : false}
          placeholderTextColor={colors.disabledText}
          style={styles.input}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
        {secure ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              feedback('toggle');
              setHidden((h) => !h);
            }}
            style={styles.toggle}
          >
            <Text style={styles.toggleText}>{hidden ? S.login.show : S.login.hide}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: font.label, color: colors.textMuted, fontWeight: font.weightMedium, marginBottom: 6 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    minHeight: 56,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontSize: 17, color: colors.text, paddingVertical: 12 },
  toggle: { paddingLeft: 10, paddingVertical: 8 },
  toggleText: { color: colors.brand, fontWeight: font.weightSemi, fontSize: font.label },
  error: { color: colors.error, fontSize: font.label, marginTop: 6, fontWeight: font.weightMedium },
});
