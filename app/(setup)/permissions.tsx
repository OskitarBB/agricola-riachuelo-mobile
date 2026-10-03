// app/(setup)/permissions.tsx — PANT-07 Permisos de la función (maestro §9; RF-14).
//
// QUÉ HACE: lista los permisos que necesita la función elegida con su estado (Concedido / Denegado / Sin decidir):
//  - Cámara (Cámara 1/2): fotos y lectura del QR.   - Ubicación (Controlador): GPS por secuencia.
//  - Red local (iPhone, todas): iOS no informa el estado; se indica dónde revisarlo en Ajustes.
// "Conceder" pide el permiso; si fue negado para siempre, "Abrir Ajustes". No se continúa sin los
// permisos obligatorios. Al volver de Ajustes se vuelve a comprobar (useFocusEffect + AppState).

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { useAppSession } from '../../src/auth/authStore';
import { refreshPermissions } from '../../src/boot';
import {
  checkRolePermissions,
  openAppSettings,
  requestPermission,
  type PermissionItem,
  type PermissionKind,
} from '../../src/device/permissions';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { Screen } from '../../src/ui/components/Screen';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { S } from '../../src/ui/strings';
import { colors, font } from '../../src/ui/theme';

const LABEL: Record<PermissionKind, string> = {
  CAMERA: S.permissions.camera,
  LOCATION: S.permissions.location,
  LOCAL_NETWORK: S.permissions.localNetwork,
};
const ICON: Record<PermissionKind, string> = { CAMERA: '📷', LOCATION: '📍', LOCAL_NETWORK: '📶' };
const DENIED_CODE: Record<PermissionKind, string> = {
  CAMERA: 'PERMISO_CAMARA',
  LOCATION: 'PERMISO_UBICACION',
  LOCAL_NETWORK: 'PERMISO_RED_LOCAL',
};

export default function PermissionsScreen() {
  const role = useAppSession((s) => s.deviceRole);
  const [items, setItems] = useState<PermissionItem[]>([]);

  const load = useCallback(async () => {
    if (!role) return;
    setItems(await checkRolePermissions(role));
  }, [role]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void load());
    return () => sub.remove();
  }, [load]);

  const allOk = items.length > 0 && items.every((i) => !i.required || i.state === 'GRANTED');

  const grant = async (kind: PermissionKind) => {
    const r = await requestPermission(kind);
    feedback(r.state === 'GRANTED' ? 'success' : 'error');
    await load();
  };

  const proceed = async () => {
    if (await refreshPermissions()) router.replace('/');
  };

  return (
    <Screen
      header={<AppHeader title={S.permissions.title} back />}
      footer={<AppButton title={S.continue} onPress={proceed} disabled={!allOk} />}
    >
      {items.map((it, i) => {
        const granted = it.state === 'GRANTED';
        const tone = granted ? 'ok' : it.state === 'NOT_VERIFIABLE' ? 'info' : it.state === 'DENIED' ? 'error' : 'warn';
        const label =
          it.state === 'GRANTED'
            ? S.permissions.granted
            : it.state === 'DENIED'
              ? S.permissions.denied
              : it.state === 'NOT_VERIFIABLE'
                ? S.permissions.notVerifiable
                : S.permissions.undetermined;
        return (
          <Card key={it.kind} delay={80 + i * 90} tone={tone}>
            <View style={styles.row}>
              <Text style={styles.icon}>{ICON[it.kind]}</Text>
              <View style={styles.flex}>
                <Text style={styles.title}>{LABEL[it.kind]}</Text>
                <StatusPill label={label} tone={tone} />
              </View>
            </View>
            {it.kind === 'LOCAL_NETWORK' ? <Text style={styles.hint}>{S.permissions.localNetworkHint}</Text> : null}
            {!granted && it.kind !== 'LOCAL_NETWORK' ? (
              <View style={styles.actions}>
                {it.state === 'DENIED' && !it.canAskAgain ? (
                  <>
                    <Text style={styles.hint}>{messageFor(DENIED_CODE[it.kind])}</Text>
                    <AppButton title={S.permissions.openSettings} variant="secondary" onPress={openAppSettings} />
                  </>
                ) : (
                  <AppButton title={S.permissions.grant} onPress={() => void grant(it.kind)} />
                )}
              </View>
            ) : null}
            {it.kind === 'LOCAL_NETWORK' ? (
              <AppButton title={S.permissions.openSettings} variant="ghost" compact onPress={openAppSettings} />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { fontSize: 34, marginRight: 14 },
  title: { fontSize: 20, fontWeight: font.weightBold, color: colors.text },
  hint: { fontSize: font.body, color: colors.textMuted, marginTop: 10 },
  actions: { marginTop: 12, gap: 8 },
});
