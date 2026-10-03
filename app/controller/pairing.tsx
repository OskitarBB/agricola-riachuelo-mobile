// app/controller/pairing.tsx — PANT-13 Vincular cámaras (maestro §14.2 y §14.6; RF-18).
//
// QUÉ HACE: muestra el QR GRANDE (IP, puertos, sesión y token), la IP con opción de escribirla a mano
// (Q-04, si no se detecta) y una tarjeta por cámara (estado, usuario, modelo, versión, batería, espacio).
// Acciones: "Regenerar QR" (el anterior deja de valer), "Liberar CÁMARA X" (solo desconectada y sin pasada
// abierta; exige repetir la prueba corta) y "Continuar" (con ambas CONECTADA: a la prueba corta si falta;
// si no, vuelve a la pantalla de origen).
// En Expo Go las dos cámaras son VIRTUALES y se conectan solas al mostrar el QR.

import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { useController } from '../../src/controller/controllerStore';
import type { CameraRole } from '../../src/domain/types';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { CameraCardView } from '../../src/ui/components/CameraCardView';
import { Card } from '../../src/ui/components/Card';
import { confirm } from '../../src/ui/components/ConfirmDialog';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { InfoRow } from '../../src/ui/components/InfoRow';
import { QrCodeView } from '../../src/ui/components/QrCodeView';
import { Screen } from '../../src/ui/components/Screen';
import { SimulatorTools } from '../../src/ui/components/SimulatorTools';
import { TextField } from '../../src/ui/components/TextField';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { ROLE_LABEL, S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function PairingScreen() {
  const { qr, cameras, session, pass, serverError } = useController();
  const [ipOpen, setIpOpen] = useState(false);
  const [ip, setIp] = useState('');
  const bothConnected = cameras.CAMERA_1.link === 'CONECTADA' && cameras.CAMERA_2.link === 'CONECTADA';

  useEffect(() => {
    void controllerRuntime.openPairing().then((r) => {
      if (!r.ok) showToast(r.code, 'error');
    });
  }, []);

  // Sonido al conectar cada cámara.
  const linkKey = `${cameras.CAMERA_1.link}-${cameras.CAMERA_2.link}`;
  useEffect(() => {
    if (bothConnected) feedback('success');
  }, [linkKey, bothConnected]);

  const release = async (role: CameraRole) => {
    const ok = await confirm({
      title: S.pairing.release(ROLE_LABEL[role]),
      message: S.pairing.releaseConfirm(ROLE_LABEL[role]),
      danger: true,
      confirmText: S.pairing.release(ROLE_LABEL[role]),
    });
    if (!ok) return;
    const r = await controllerRuntime.releaseCamera(role);
    if (!r.ok) showToast(r.code, 'warn');
  };

  const proceed = () => {
    if (!session) return;
    if (!session.shortTestPassedAt) router.replace('/controller/short-test');
    else if (pass && ['ACTIVE', 'PAUSED'].includes(pass.status)) router.replace('/controller/pass');
    else router.replace('/controller/new-pass');
  };

  const regenerate = async () => {
    const ok = await confirm({ title: S.pairing.regenerate, confirmText: S.pairing.regenerate });
    if (ok) await controllerRuntime.regenerateQr();
  };

  return (
    <Screen
      header={<AppHeader title={S.pairing.title} back />}
      footer={<AppButton title={S.pairing.continue} onPress={proceed} disabled={!bothConnected} />}
    >
      <Card delay={40}>
        {qr ? <QrCodeView value={qr.text} size={250} /> : <Text style={styles.wait}>{S.preparing}</Text>}
        {serverError ? <Text style={styles.err}>{messageFor(serverError)}</Text> : null}
        <View style={{ marginTop: 12 }}>
          <InfoRow label={S.pairing.host} value={qr?.payload.host} strong />
          <InfoRow label={S.pairing.ports} value={qr ? `${qr.payload.controlPort} · ${qr.payload.filePort}` : null} />
        </View>
        <View style={styles.row}>
          <AppButton title={S.pairing.regenerate} variant="secondary" compact style={styles.flex} onPress={regenerate} />
          <AppButton
            title={S.pairing.manualIp}
            variant="ghost"
            compact
            style={styles.flex}
            onPress={() => setIpOpen((o) => !o)}
          />
        </View>
        {ipOpen ? (
          <FadeIn>
            <View style={{ marginTop: 12 }}>
              <TextField
                label={S.pairing.manualIp}
                value={ip}
                onChangeText={setIp}
                keyboardType="decimal-pad"
                placeholder="192.168.0.10"
              />
              <AppButton
                title={S.pairing.applyIp}
                compact
                disabled={!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())}
                onPress={() => {
                  controllerRuntime.setManualIp(ip);
                  setIpOpen(false);
                }}
              />
            </View>
          </FadeIn>
        ) : null}
      </Card>

      {(['CAMERA_1', 'CAMERA_2'] as const).map((r, i) => (
        <FadeIn key={r} delay={120 + i * 80}>
          <CameraCardView card={cameras[r]} />
          {cameras[r].deviceId && (cameras[r].link === 'PERDIDA' || cameras[r].link === 'DESCONECTADA') ? (
            <AppButton
              title={S.pairing.release(ROLE_LABEL[r])}
              variant="danger"
              compact
              style={{ marginBottom: 12 }}
              onPress={() => void release(r)}
            />
          ) : null}
        </FadeIn>
      ))}

      <SimulatorTools />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wait: { textAlign: 'center', fontSize: font.body, color: colors.textMuted, padding: 40 },
  err: {
    color: colors.error,
    backgroundColor: colors.errorBg,
    padding: 10,
    borderRadius: radius.sm,
    marginTop: 10,
    fontSize: font.body,
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  flex: { flex: 1 },
});
