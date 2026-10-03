// src/ui/components/Segmented.tsx — Selector de opciones con indicador deslizante animado.
//
// QUÉ HACE: muestra 2 a 4 opciones (p. ej. MANUAL / AUTOMÁTICO, LATERAL A / B). El fondo resaltado se
// desliza con resorte hacia la opción elegida y suena "toggle". Con `disabled` queda atenuado y sin interacción.

import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, useAnimatedValue } from 'react-native';

import { feedback } from '../feedback';
import { colors, font, radius } from '../theme';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}

export function Segmented<T extends string>({ options, value, onChange, disabled }: Props<T>) {
  const [width, setWidth] = useState(0);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const x = useAnimatedValue(0);
  const segW = options.length > 0 ? width / options.length : 0;

  useEffect(() => {
    Animated.spring(x, { toValue: idx * segW, useNativeDriver: true, speed: 16, bounciness: 8 }).start();
  }, [idx, segW, x]);

  return (
    <View
      style={[styles.wrap, disabled && styles.disabled]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 8)}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      {value !== null && segW > 0 ? (
        <Animated.View
          style={[styles.indicator, { width: segW, transform: [{ translateX: x }] }, disabled && styles.indicatorDisabled]}
        />
      ) : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={styles.opt}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            onPress={() => {
              if (disabled || active) return;
              feedback('toggle');
              onChange(o.value);
            }}
          >
            <Text style={[styles.text, active && styles.activeText, disabled && styles.disabledText]}>
              {o.label}
              {active ? ' ✓' : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 4, minHeight: 60 },
  disabled: { backgroundColor: colors.disabledBg, borderWidth: 1, borderColor: colors.border, opacity: 0.6 },
  indicator: { position: 'absolute', top: 4, bottom: 4, left: 4, backgroundColor: colors.brand, borderRadius: radius.sm },
  indicatorDisabled: { backgroundColor: colors.border },
  opt: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  text: { fontSize: font.body, fontWeight: font.weightSemi, color: colors.text },
  activeText: { color: colors.textOnDark },
  disabledText: { color: colors.disabledText },
});
