// app/(setup)/role.tsx — PANT-08 Función del dispositivo (maestro §7.9; RF-12, RF-13; RN-15).
//
// QUÉ HACE: tres tarjetas grandes y animadas: Controlador, Cámara 1 y Cámara 2, con una línea de qué hace
// cada una y los datos del equipo. Al confirmar se guarda en app_meta.device_role (persiste) y se pasa a
// PANT-07 (permisos de esa función). Desde Ajustes, el cambio se bloquea con sesión abierta o pendientes.

import { router } from 'expo-router';
import { Animated, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import { useAppSession } from '../../src/auth/authStore';
import { cameraAgent } from '../../src/camera/cameraAgent';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import type { DeviceRole } from '../../src/domain/types';
import { canChangeRole, saveDeviceRole } from '../../src/device/deviceRole';
import { rolePermissionsOk } from '../../src/device/permissions';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { feedback } from '../../src/ui/feedback';
import { ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, radius, shadow } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

const ICON: Record<DeviceRole, string> = { CONTROLADOR: '🎛️', CAMERA_1: '📷', CAMERA_2: '📸' };
const ROLES: DeviceRole[] = ['CONTROLADOR', 'CAMERA_1', 'CAMERA_2'];

function RoleCard({ role, active, onPress, delay }: { role: DeviceRole; active: boolean; onPress: () => void; delay: number }) {
  const s = useAnimatedValue(1);
  return (
    <FadeIn delay={delay}>
      <Animated.View style={{ transform: [{ scale: s }] }}>
        <Pressable
          accessibilityRole="button"
          onPressIn={() => Animated.spring(s, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
          onPressOut={() => Animated.spring(s, { toValue: 1, useNativeDriver: true, bounciness: 10 }).start()}
          onPress={onPress}
          style={[styles.role, shadow, active && styles.roleActive]}
        >
          <Text style={styles.icon}>{ICON[role]}</Text>
          <View style={styles.flex}>
            <Text style={[styles.roleTitle, active && { color: colors.textOnDark }]}>{ROLE_LABEL[role]}</Text>
            <Text style={[styles.roleDesc, active && { color: '#D7F0DD' }]}>{S.role.descriptions[role]}</Text>
          </View>
          <Text style={[styles.chev, active && { color: colors.goldLight }]}>{active ? '✓' : '›'}</Text>
        </Pressable>
      </Animated.View>
    </FadeIn>
  );
}

export default function RoleScreen() {
  const { deviceRole, identity } = useAppSession();

  const choose = async (role: DeviceRole) => {
    feedback('tap');
    if (role === deviceRole) {
      router.replace('/permissions');
      return;
    }
    const rule = await canChangeRole(deviceRole);
    if (!rule.ok) {
      showToast(rule.code, 'warn');
      return;
    }
    const ok = await confirm({
      title: S.role.confirmTitle,
      message: S.role.confirmBody(ROLE_LABEL[role]),
      confirmText: S.role.useAs(ROLE_LABEL[role]),
    });
    if (!ok) return;
    // Al cambiar de función se detienen los servicios de la anterior (no se borra ningún dato).
    await controllerRuntime.shutdown();
    cameraAgent.stop();
    await saveDeviceRole(role);
    useAppSession.getState().set({ deviceRole: role, permissionsOk: await rolePermissionsOk(role) });
    feedback('success');
    router.replace('/permissions');
  };

  return (
    <Screen header={<AppHeader title={S.role.title} back={!!deviceRole} />}>
      {ROLES.map((r, i) => (
        <RoleCard key={r} role={r} active={deviceRole === r} delay={80 + i * 90} onPress={() => void choose(r)} />
      ))}
      <Card title={S.role.deviceData} delay={380}>
        <InfoRow label={S.role.model} value={identity?.model} />
        <InfoRow
          label={S.role.system}
          value={identity ? `${identity.platform === 'ios' ? 'iOS' : 'Android'} ${identity.osVersion}` : null}
        />
        <InfoRow label={S.settings.appVersion} value={identity?.appVersion} />
        <InfoRow label={S.settings.deviceId} value={identity?.deviceId.slice(0, 8)} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 14,
    minHeight: 96,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  roleActive: { backgroundColor: colors.brand, borderColor: colors.gold },
  icon: { fontSize: 36, marginRight: 14 },
  roleTitle: { fontSize: 21, fontWeight: font.weightBold, color: colors.text },
  roleDesc: { fontSize: font.body, color: colors.textMuted, marginTop: 4 },
  chev: { fontSize: 28, color: colors.brand, marginLeft: 10, fontWeight: font.weightBold },
});
