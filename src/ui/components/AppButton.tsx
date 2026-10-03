// src/ui/components/AppButton.tsx — Botón de la app con animación, sonido y vibración.
//
// QUÉ HACE: al presionar se "hunde" (escala con resorte), suena (tap/confirm/shutter según la variante) y
// vibra levemente. Altura mínima 56 dp (R-15). Muestra un indicador de carga y queda deshabilitado
// (fondo blanco atenuado) cuando no se puede usar.
// Variantes: primary (acción principal), secondary, danger, ghost, gold y huge (CAPTURAR).

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  useAnimatedValue,
} from 'react-native';

import { feedback, type SoundName } from '../feedback';
import { colors, font, radius, shadow, touch } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold' | 'huge' | 'dark';

interface Props {
  title: string;
  onPress?: () => void | Promise<void>;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  sound?: SoundName | 'none';
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  testID?: string;
}

const PALETTE: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.brand, fg: colors.textOnDark, border: colors.brand },
  secondary: { bg: colors.card, fg: colors.brand, border: colors.brand },
  danger: { bg: colors.error, fg: colors.textOnDark, border: colors.error },
  ghost: { bg: 'transparent', fg: colors.brand, border: 'transparent' },
  gold: { bg: colors.gold, fg: colors.brandDeep, border: colors.gold },
  huge: { bg: colors.brand, fg: colors.textOnDark, border: colors.brandDeep },
  dark: { bg: colors.brandDeep, fg: colors.textOnDark, border: colors.brandDeep },
};

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  sound,
  style,
  compact,
  testID,
}: Props) {
  const scale = useAnimatedValue(1);
  const inactive = disabled || loading;
  const p = PALETTE[variant];
  const defaultSound: SoundName =
    variant === 'huge' ? 'shutter' : variant === 'primary' || variant === 'gold' ? 'confirm' : 'tap';

  const pressIn = () => Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 10 }).start();

  const handlePress = () => {
    if (inactive) return;
    const s = sound ?? defaultSound;
    if (s !== 'none') feedback(s);
    void onPress?.();
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!inactive, busy: !!loading }}
        onPressIn={inactive ? undefined : pressIn}
        onPressOut={inactive ? undefined : pressOut}
        onPress={handlePress}
        style={[
          styles.base,
          variant === 'huge' && styles.huge,
          compact && styles.compact,
          {
            backgroundColor: inactive ? colors.disabledBg : p.bg,
            borderColor: inactive ? colors.border : p.border,
          },
          variant !== 'ghost' && !inactive && shadow,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? colors.brand : colors.textOnDark} />
        ) : (
          <View style={styles.row}>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text
              numberOfLines={2}
              style={[styles.text, variant === 'huge' && styles.hugeText, { color: inactive ? colors.disabledText : p.fg }]}
            >
              {title}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.minHeight,
    borderRadius: radius.md,
    borderWidth: 2,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { minHeight: 48, paddingVertical: 8, paddingHorizontal: 14 },
  huge: { minHeight: 96, borderRadius: radius.xl, borderWidth: 3 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  icon: { marginRight: 8 },
  text: { fontSize: font.body, fontWeight: font.weightSemi, textAlign: 'center', letterSpacing: 0.3 },
  hugeText: { fontSize: 28, fontWeight: font.weightBold, letterSpacing: 2 },
});
