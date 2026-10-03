// src/ui/components/Screen.tsx — Contenedor base de cada pantalla (área segura, fondo y desplazamiento).
//
// QUÉ HACE: aplica márgenes seguros (notch), el fondo de la app y, si `scroll`, un ScrollView que se ajusta
// al teclado. `footer` queda FIJO abajo (acciones críticas visibles sin desplazarse, R-15).

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';

interface Props {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  bg?: string;
}

export function Screen({ children, header, footer, scroll = true, contentStyle, bg = colors.bg }: Props) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: footer ? 16 : insets.bottom + 24 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.flex, contentStyle]}>{children}</View>
  );
  return (
    <View style={[styles.flex, { backgroundColor: bg }]}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 10,
  },
});
