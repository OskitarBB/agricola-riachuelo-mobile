// src/ui/components/ConfirmDialog.tsx — Diálogo de confirmación animado (uso imperativo: await confirm({...})).
//
// QUÉ HACE: reemplaza Alert.alert para que el estilo, el tamaño de botones (≥ 56 dp) y los sonidos sean
// coherentes en Android e iOS. Se monta una vez en app/_layout.tsx (<ConfirmHost/>).

import { useEffect } from 'react';
import { Animated, Modal, StyleSheet, Text, View, useAnimatedValue } from 'react-native';
import { create } from 'zustand';

import { S } from '../strings';
import { colors, font, radius } from '../theme';
import { AppButton } from './AppButton';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string | null;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  visible: boolean;
  resolve: ((v: boolean) => void) | null;
}

const useConfirm = create<ConfirmState>(() => ({ visible: false, title: '', resolve: null }));

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().resolve?.(false);
    useConfirm.setState({ ...opts, visible: true, resolve });
  });
}

function close(value: boolean) {
  const s = useConfirm.getState();
  s.resolve?.(value);
  useConfirm.setState({ visible: false, resolve: null });
}

export function ConfirmHost() {
  const s = useConfirm();
  const scale = useAnimatedValue(0.85);
  const fade = useAnimatedValue(0);
  useEffect(() => {
    if (s.visible) {
      scale.setValue(0.85);
      fade.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 10 }),
        Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [s.visible, scale, fade]);
  return (
    <Modal visible={s.visible} transparent animationType="none" onRequestClose={() => close(false)}>
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Animated.View style={[styles.box, { transform: [{ scale }] }]}>
          <Text style={styles.title}>{s.title}</Text>
          {s.message ? <Text style={styles.message}>{s.message}</Text> : null}
          <View style={styles.actions}>
            {s.cancelText !== null ? (
              <AppButton title={s.cancelText ?? S.cancel} variant="secondary" onPress={() => close(false)} style={styles.btn} />
            ) : null}
            <AppButton
              title={s.confirmText ?? S.confirm}
              variant={s.danger ? 'danger' : 'primary'}
              onPress={() => close(true)}
              style={styles.btn}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: 22 },
  box: { width: '100%', maxWidth: 440, backgroundColor: colors.card, borderRadius: radius.lg, padding: 22 },
  title: { fontSize: 21, fontWeight: font.weightBold, color: colors.text, marginBottom: 8 },
  message: { fontSize: font.body, color: colors.textMuted, lineHeight: 23, marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 18 },
  btn: { flex: 1 },
});
