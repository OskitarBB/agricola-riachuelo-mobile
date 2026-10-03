// src/ui/components/ToastHost.tsx — Muestra los avisos de src/ui/toast.ts (entra desde arriba y se va solo).
//
// Se monta UNA vez en app/_layout.tsx. También escucha los avisos del controlador (controllerStore.notice).

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, useAnimatedValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useController } from '../../controller/controllerStore';
import { CONFIG } from '../../config';
import { colors, font, radius, shadow } from '../theme';
import { hideToast, showToast, useToast, type ToastKind } from '../toast';

const BG: Record<ToastKind, string> = { info: colors.info, success: colors.ok, warn: colors.warn, error: colors.error };

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const { id, text, kind } = useToast();
  const notice = useController((s) => s.notice);
  const y = useAnimatedValue(-140);
  const lastNotice = useRef(0);

  // Avisos del controlador → toast.
  useEffect(() => {
    if (notice && notice.id !== lastNotice.current) {
      lastNotice.current = notice.id;
      showToast(notice.code, notice.kind === 'warn' ? 'warn' : notice.kind);
    }
  }, [notice]);

  useEffect(() => {
    if (!text) {
      Animated.timing(y, { toValue: -140, duration: 220, useNativeDriver: true }).start();
      return;
    }
    Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 8 }).start();
    const t = setTimeout(hideToast, CONFIG.ui.toastDurationMs);
    return () => clearTimeout(t);
  }, [id, text, y]);

  return (
    <Animated.View
      pointerEvents={text ? 'auto' : 'none'}
      style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]}
    >
      <Pressable onPress={hideToast} style={[styles.toast, { backgroundColor: BG[kind] }, shadow]}>
        <Text style={styles.text}>{text ?? ''}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 14, right: 14, zIndex: 1000 },
  toast: { borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16 },
  text: { color: '#fff', fontSize: font.body, fontWeight: font.weightSemi, textAlign: 'center' },
});
