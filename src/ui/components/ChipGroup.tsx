// src/ui/components/ChipGroup.tsx — Grupo de chips seleccionables (p. ej. intervalo 1 s · 2 s · 3 s · 5 s).
//
// QUÉ HACE: el chip elegido se resalta con un pequeño "rebote". Con `disabled` todo el grupo queda con fondo
// blanco/transparente y atenuado, sin interacción (regla del modo MANUAL, contexto §25.1/25.7).

import { useEffect } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import { feedback } from '../feedback';
import { colors, font, radius } from '../theme';

interface Props<T extends string | number> {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}

function Chip({ label, active, disabled, onPress }: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  const s = useAnimatedValue(1);
  useEffect(() => {
    if (active) {
      Animated.sequence([
        Animated.timing(s, { toValue: 1.08, duration: 110, useNativeDriver: true }),
        Animated.spring(s, { toValue: 1, useNativeDriver: true, bounciness: 12 }),
      ]).start();
    }
  }, [active, s]);
  return (
    <Animated.View style={{ transform: [{ scale: s }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active, disabled: !!disabled }}
        onPress={disabled ? undefined : onPress}
        style={[styles.chip, active && !disabled && styles.active, disabled && styles.disabled]}
      >
        <Text style={[styles.text, active && !disabled && styles.activeText, disabled && styles.disabledText]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function ChipGroup<T extends string | number>({ options, value, onChange, disabled }: Props<T>) {
  return (
    <View style={styles.wrap} pointerEvents={disabled ? 'none' : 'auto'}>
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          label={o.label}
          active={o.value === value}
          disabled={disabled}
          onPress={() => {
            feedback('toggle');
            onChange(o.value);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    minHeight: 52,
    minWidth: 68,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.brand,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { backgroundColor: colors.brand },
  disabled: { backgroundColor: 'transparent', borderColor: colors.border, opacity: 0.55 },
  text: { fontSize: 17, fontWeight: font.weightSemi, color: colors.brand },
  activeText: { color: colors.textOnDark },
  disabledText: { color: colors.disabledText },
});
