// src/ui/components/AppHeader.tsx — Cabecera con degradado: título, usuario · acceso · función, y acciones.
//
// QUÉ HACE (maestro §7.9 y contexto §25.3):
//  - Siempre muestra quién está (usuario), el modo de acceso (con/sin internet) y la función del celular.
//  - En las pantallas principales muestra [Ajustes] y [Cerrar sesión] EN LA MISMA ZONA y altura.
//  - En las secundarias muestra "‹ Volver".
//  - Debajo, si corresponde, el aviso "Sin internet — acceso válido hasta …" o la revalidación (OfflineBanner).

import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppSession } from '../../auth/authStore';
import { feedback } from '../feedback';
import { useLogout } from '../hooks/useLogout';
import { ROLE_LABEL, S } from '../strings';
import { colors, font, radius } from '../theme';
import { OfflineBanner } from './OfflineBanner';

interface Props {
  title: string;
  back?: boolean;
  /** Pantalla principal de la función: muestra Ajustes y Cerrar sesión. */
  main?: boolean;
  /** Muestra solo "Cerrar sesión" a la derecha (pantalla de Ajustes: misma zona y altura, contexto §25.3). */
  showLogout?: boolean;
  right?: ReactNode;
}

function HeaderAction({ label, onPress, tone = 'light' }: { label: string; onPress: () => void; tone?: 'light' | 'gold' }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        feedback('tap');
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        tone === 'gold' && styles.actionGold,
        pressed && { opacity: 0.7, transform: [{ scale: 0.96 }] },
      ]}
    >
      <Text style={[styles.actionText, tone === 'gold' && { color: colors.brandDeep }]}>{label}</Text>
    </Pressable>
  );
}

export function AppHeader({ title, back, main, showLogout, right }: Props) {
  const insets = useSafeAreaInsets();
  const { user, mode, deviceRole } = useAppSession();
  const logout = useLogout();
  const subtitle = [
    user?.fullName,
    mode === 'OFFLINE' ? S.offline : mode === 'ONLINE' ? S.online : null,
    deviceRole ? ROLE_LABEL[deviceRole] : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View>
      <LinearGradient
        colors={[colors.brandDeep, colors.brand]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.wrap, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.topRow}>
          {back ? (
            <HeaderAction label={`‹ ${S.back}`} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          ) : (
            <View />
          )}
          {main ? (
            <View style={styles.actions}>
              <HeaderAction label={S.settings.title} onPress={() => router.push('/settings')} />
              <HeaderAction label={S.settings.logout} tone="gold" onPress={() => void logout()} />
            </View>
          ) : showLogout ? (
            <HeaderAction label={S.settings.logout} tone="gold" onPress={() => void logout()} />
          ) : (
            (right ?? <View />)
          )}
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </LinearGradient>
      <OfflineBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 16, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48, marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGold: { backgroundColor: colors.goldLight },
  actionText: { color: colors.textOnDark, fontSize: font.body, fontWeight: font.weightSemi },
  title: { color: colors.textOnDark, fontSize: font.title, fontWeight: font.weightBold },
  subtitle: { color: '#CFE8D5', fontSize: font.label, marginTop: 4 },
});
