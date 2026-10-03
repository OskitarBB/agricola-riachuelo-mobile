// app/(setup)/role.tsx — PANT-08 Función del dispositivo (maestro §7.9; RF-12, RF-13; RN-15; ADR 0005).
//
// QUÉ HACE: después de CADA inicio de sesión (y desde Ajustes › Cambiar función) el operador elige qué será
// este celular: CONTROLADOR, CÁMARA 1 o CÁMARA 2. Tres tarjetas grandes y animadas con una línea de qué hace
// cada función, lo que necesita (permiso y Wi-Fi) y la marca "Actual" en la función guardada. Se toca una
// tarjeta y se confirma con "Usar como …" (botón fijo abajo). Al confirmar:
//  - misma función → continúa (pasa por PANT-07 solo si falta algún permiso, maestro §7.4 paso 6);
//  - otra función → RN-15 con decideRoleChange (src/domain/rules.ts): una sesión de monitoreo abierta o fotos
//    por enviar al controlador BLOQUEAN (aviso arriba y candado en las tarjetas); la cola de sincronización
//    pendiente solo AVISA mientras la Fase 4 no exista. Se detienen los servicios de la función anterior (no se
//    borra ningún dato), se guarda app_meta.device_role y se pasa a PANT-07 o directo a la pantalla principal:
//    Controlador → PANT-10; Cámara 1/2 → PANT-30 (vincular por QR) o PANT-31 si ya está unida a una sesión.
// Recién iniciada la sesión no hay "Volver": la cabecera ofrece "Cerrar sesión" en la misma zona (§25.3).

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useAnimatedValue } from 'react-native';

import { useAppSession } from '../../src/auth/authStore';
import { cameraAgent } from '../../src/camera/cameraAgent';
import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { decideRoleChange, type RoleChangeBlockCode, type RoleChangeDecision } from '../../src/domain/rules';
import type { DeviceRole } from '../../src/domain/types';
import { loadRoleChangeContext, saveDeviceRole, type RoleChangeContext } from '../../src/device/deviceRole';
import { rolePermissionsOk } from '../../src/device/permissions';
import { logEvent } from '../../src/diagnostics/eventLog';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { Screen } from '../../src/ui/components/Screen';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, radius, shadow } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

const ICON: Record<DeviceRole, string> = { CONTROLADOR: '🎛️', CAMERA_1: '📷', CAMERA_2: '📸' };
const ROLES: DeviceRole[] = ['CONTROLADOR', 'CAMERA_1', 'CAMERA_2'];

interface RoleCardProps {
  role: DeviceRole;
  selected: boolean;
  current: boolean;
  locked: boolean;
  onPress: () => void;
  delay: number;
}

function RoleCard({ role, selected, current, locked, onPress, delay }: RoleCardProps) {
  const s = useAnimatedValue(1);
  return (
    <FadeIn delay={delay}>
      <Animated.View style={{ transform: [{ scale: s }] }}>
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel={ROLE_LABEL[role]}
          accessibilityState={{ selected, disabled: locked }}
          onPressIn={() => Animated.spring(s, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
          onPressOut={() => Animated.spring(s, { toValue: 1, useNativeDriver: true, bounciness: 10 }).start()}
          onPress={onPress}
          style={[styles.role, shadow, selected && styles.roleSelected, locked && styles.roleLocked]}
        >
          <Text style={[styles.icon, locked && styles.dim]}>{ICON[role]}</Text>
          <View style={styles.flex}>
            <View style={styles.titleRow}>
              <Text style={[styles.roleTitle, selected && styles.onDark, locked && styles.dim]}>{ROLE_LABEL[role]}</Text>
              {current ? <StatusPill label={S.role.current} tone={selected ? 'ok' : 'info'} /> : null}
              {locked ? <StatusPill label={`🔒 ${S.role.locked}`} tone="warn" /> : null}
            </View>
            <Text style={[styles.roleDesc, selected && styles.onDarkMuted]}>{S.role.descriptions[role]}</Text>
            <Text style={[styles.needs, selected && styles.onDarkMuted]}>{S.role.needs[role]}</Text>
          </View>
          <View style={[styles.radio, selected && styles.radioOn]}>
            {selected ? <Text style={styles.radioMark}>✓</Text> : null}
          </View>
        </Pressable>
      </Animated.View>
    </FadeIn>
  );
}

export default function RoleScreen() {
  const { deviceRole, identity, roleChoicePending } = useAppSession();
  const [selected, setSelected] = useState<DeviceRole | null>(deviceRole);
  const [ctx, setCtx] = useState<RoleChangeContext | null>(null);
  const [busy, setBusy] = useState(false);
  // Recién iniciada la sesión (o primer uso): sin "Volver", con "Cerrar sesión".
  const afterLogin = roleChoicePending || !deviceRole;

  // Se recalcula al volver a la pantalla (p. ej., después de cerrar una sesión de monitoreo).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadRoleChangeContext(deviceRole).then((c) => {
        if (alive) setCtx(c);
      });
      return () => {
        alive = false;
      };
    }, [deviceRole]),
  );

  const decide = (target: DeviceRole): RoleChangeDecision | null =>
    ctx ? decideRoleChange({ current: deviceRole, target, ...ctx }) : null;

  // Los bloqueos de RN-15 dependen del celular, no de la función elegida: un solo aviso arriba.
  const blockCode: RoleChangeBlockCode | null =
    ROLES.map(decide).find((d): d is Extract<RoleChangeDecision, { kind: 'BLOCKED' }> => d?.kind === 'BLOCKED')?.code ?? null;
  const selectedDecision = selected ? decide(selected) : null;

  /** Guarda la función en el store y entra: a PANT-07 si falta un permiso; si no, a la pantalla principal. */
  const enter = async (role: DeviceRole) => {
    const permissionsOk = await rolePermissionsOk(role);
    useAppSession.getState().set({ deviceRole: role, permissionsOk, roleChoicePending: false });
    router.replace(permissionsOk ? '/' : '/permissions');
  };

  const proceed = async () => {
    if (!selected || busy) return;
    const d = decide(selected);
    if (!d) return;
    if (d.kind === 'BLOCKED') {
      feedback('error');
      showToast(d.code, 'warn');
      return;
    }
    setBusy(true);
    try {
      if (d.kind === 'SAME') {
        feedback('success');
        await enter(selected);
        return;
      }
      if (deviceRole) {
        const message = [S.role.confirmBody(ROLE_LABEL[selected]), ...d.warnings.map((w) => messageFor(w))].join('\n\n');
        const ok = await confirm({ title: S.role.confirmTitle, message, confirmText: S.role.useAs(ROLE_LABEL[selected]) });
        if (!ok) return;
      }
      // Al cambiar de función se detienen los servicios de la anterior (no se borra ningún dato).
      await controllerRuntime.shutdown();
      cameraAgent.stop();
      await saveDeviceRole(selected);
      if (d.warnings.length > 0) {
        logEvent('INFO', 'DEVICE', 'ROLE_CHANGE_WITH_WARNINGS', { from: deviceRole, to: selected, warnings: d.warnings });
      }
      feedback('success');
      await enter(selected);
    } finally {
      setBusy(false);
    }
  };

  const onCardPress = (role: DeviceRole) => {
    const d = decide(role);
    if (d?.kind === 'BLOCKED') {
      feedback('error');
      showToast(d.code, 'warn');
      return;
    }
    feedback('toggle');
    setSelected(role);
  };

  return (
    <Screen
      header={<AppHeader title={S.role.title} back={!afterLogin} showLogout={afterLogin} />}
      footer={
        <AppButton
          title={selected ? S.role.useAs(ROLE_LABEL[selected]) : S.role.choose}
          onPress={proceed}
          loading={busy}
          disabled={!selected || !ctx || selectedDecision?.kind === 'BLOCKED'}
          sound="none"
        />
      }
    >
      <FadeIn>
        <Text style={styles.prompt}>{S.role.prompt}</Text>
      </FadeIn>
      {blockCode ? (
        <Card tone="warn" delay={40}>
          <Text style={styles.notice}>{messageFor(blockCode)}</Text>
        </Card>
      ) : null}
      {ROLES.map((r, i) => (
        <RoleCard
          key={r}
          role={r}
          selected={selected === r}
          current={deviceRole === r}
          locked={decide(r)?.kind === 'BLOCKED'}
          delay={80 + i * 90}
          onPress={() => onCardPress(r)}
        />
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
  prompt: { fontSize: font.big, fontWeight: font.weightBold, color: colors.text, marginBottom: 14 },
  notice: { fontSize: font.body, color: colors.text },
  role: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 14,
    minHeight: 104,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  roleSelected: { backgroundColor: colors.brand, borderColor: colors.gold },
  roleLocked: { backgroundColor: colors.cardAlt },
  icon: { fontSize: 36, marginRight: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  roleTitle: { fontSize: 21, fontWeight: font.weightBold, color: colors.text },
  roleDesc: { fontSize: font.body, color: colors.textMuted, marginTop: 4 },
  needs: { fontSize: font.label, color: colors.textMuted, marginTop: 4, fontWeight: font.weightMedium },
  onDark: { color: colors.textOnDark },
  onDarkMuted: { color: '#D7F0DD' },
  dim: { opacity: 0.45 },
  radio: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.goldLight, borderColor: colors.goldLight },
  radioMark: { fontSize: 18, fontWeight: font.weightBold, color: colors.brandDeep },
});
