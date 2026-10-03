// src/ui/components/PickerSheet.tsx — Selector en hoja inferior animada (lote, hilera, segmento, marcador).
//
// QUÉ HACE: muestra un campo con el valor elegido; al tocarlo sube una hoja con la lista (botones grandes,
// RF-16: todo se elige sin internet desde los catálogos locales).

import { useEffect, useState } from 'react';
import { Animated, FlatList, Modal, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { feedback } from '../feedback';
import { S } from '../strings';
import { colors, font, radius } from '../theme';

export interface PickerItem {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  label: string;
  items: PickerItem[];
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function PickerSheet({ label, items, value, onChange, disabled, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const y = useAnimatedValue(600);
  useEffect(() => {
    if (open) {
      y.setValue(600);
      Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 4 }).start();
    }
  }, [open, y]);
  const selected = items.find((i) => i.value === value);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => {
          feedback('tap');
          setOpen(true);
        }}
        style={({ pressed }) => [styles.field, disabled && styles.disabled, pressed && { opacity: 0.8 }]}
      >
        <Text style={[styles.value, !selected && { color: colors.disabledText }]} numberOfLines={1}>
          {selected ? selected.label : (placeholder ?? S.newPass.choose)}
        </Text>
        <Text style={styles.chev}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY: y }] }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{label}</Text>
          <FlatList
            data={items}
            keyExtractor={(i) => i.value}
            style={{ maxHeight: 420 }}
            renderItem={({ item }) => {
              const active = item.value === value;
              return (
                <Pressable
                  onPress={() => {
                    feedback('toggle');
                    onChange(item.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.itemText, active && { color: colors.textOnDark }]}>{item.label}</Text>
                  {item.hint ? <Text style={[styles.itemHint, active && { color: '#D8F0DD' }]}>{item.hint}</Text> : null}
                </Pressable>
              );
            }}
          />
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: font.label, color: colors.textMuted, fontWeight: font.weightMedium, marginBottom: 6 },
  field: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  value: { flex: 1, fontSize: 17, color: colors.text, fontWeight: font.weightMedium },
  chev: { fontSize: 18, color: colors.brand },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 48, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  sheetTitle: { fontSize: 19, fontWeight: font.weightBold, color: colors.text, marginBottom: 10 },
  item: {
    minHeight: 56,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: colors.cardAlt,
    justifyContent: 'center',
  },
  itemActive: { backgroundColor: colors.brand },
  itemText: { fontSize: 17, color: colors.text, fontWeight: font.weightSemi },
  itemHint: { fontSize: 15, color: colors.textMuted, marginTop: 2 },
});
