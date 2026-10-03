// src/ui/components/CheckList.tsx — Lista de selección múltiple con casillas grandes (CFG-3: "Lotes a trabajar").
//
// QUÉ HACE: cada fila (≥ 56 dp) muestra una casilla animada, el nombre, una pista (p. ej. "12/31 hileras
// completas") y una etiqueta de estado. Las filas `disabled` (lote completo en el ciclo) se ven atenuadas y no
// se pueden marcar. Suena "toggle" al marcar y "error" al tocar una bloqueada.

import { useEffect } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import { feedback } from '../feedback';
import { colors, font, radius, type Tone } from '../theme';
import { StatusPill } from './StatusPill';

export interface CheckItem {
  value: string;
  label: string;
  hint?: string;
  badge?: { label: string; tone: Tone };
  disabled?: boolean;
}

interface Props {
  items: CheckItem[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

function Row({ item, checked, onToggle }: { item: CheckItem; checked: boolean; onToggle: () => void }) {
  const s = useAnimatedValue(checked ? 1 : 0);
  useEffect(() => {
    Animated.spring(s, { toValue: checked ? 1 : 0, useNativeDriver: true, bounciness: 10, speed: 18 }).start();
  }, [checked, s]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!item.disabled }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        checked && styles.rowOn,
        item.disabled && styles.rowLocked,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        <Animated.Text style={[styles.tick, { transform: [{ scale: s }], opacity: s }]}>✓</Animated.Text>
      </View>
      <View style={styles.flex}>
        <Text style={[styles.label, item.disabled && styles.muted]}>{item.label}</Text>
        {item.hint ? <Text style={styles.hint}>{item.hint}</Text> : null}
      </View>
      {item.badge ? <StatusPill label={item.badge.label} tone={item.badge.tone} /> : null}
    </Pressable>
  );
}

export function CheckList({ items, selected, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      {items.map((item) => {
        const checked = selected.includes(item.value);
        return (
          <Row
            key={item.value}
            item={item}
            checked={checked}
            onToggle={() => {
              if (item.disabled) {
                feedback('error');
                return;
              }
              feedback('toggle');
              onChange(checked ? selected.filter((v) => v !== item.value) : [...selected, item.value]);
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: colors.brand, backgroundColor: colors.okBg },
  rowLocked: { opacity: 0.55 },
  box: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tick: { color: colors.textOnDark, fontSize: 18, fontWeight: font.weightBold },
  flex: { flex: 1 },
  label: { fontSize: 17, fontWeight: font.weightSemi, color: colors.text },
  muted: { color: colors.textMuted },
  hint: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
});
