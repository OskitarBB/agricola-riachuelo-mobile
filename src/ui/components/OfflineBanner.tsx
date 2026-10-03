// src/ui/components/OfflineBanner.tsx — Aviso de acceso sin internet y revalidación (maestro §7.5).
//
// QUÉ HACE:
//  - Sesión OFFLINE: franja "Sin internet — acceso válido hasta <fecha>".
//  - Si vuelve el internet (y no hay pasada ACTIVE): aviso no bloqueante REAUTENTICACION_REQUERIDA con
//    botón "Validar" que abre una ventana de contraseña; al validar, el modo pasa a ONLINE sin salir de la pantalla.

import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { reauthenticate } from '../../auth/authService';
import { useAppSession } from '../../auth/authStore';
import { formatDateTime } from '../../domain/time';
import { messageFor } from '../messages';
import { S } from '../strings';
import { colors, font, radius } from '../theme';
import { showToast } from '../toast';
import { AppButton } from './AppButton';
import { FadeIn } from './FadeIn';
import { TextField } from './TextField';

export function OfflineBanner() {
  const { mode, offlineValidUntil, reauthSuggested, status } = useAppSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status !== 'AUTENTICADO' || mode !== 'OFFLINE') return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await reauthenticate(password);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setPassword('');
      showToast(S.reauth.done, 'success');
    } else {
      setError(messageFor(r.code));
    }
  };

  return (
    <FadeIn from="top" distance={10}>
      <View style={[styles.banner, reauthSuggested && styles.reauth]}>
        <Text style={styles.text}>
          {reauthSuggested
            ? messageFor('REAUTENTICACION_REQUERIDA')
            : `${S.offline} — ${S.settings.offlineUntil.toLowerCase()} ${formatDateTime(offlineValidUntil)}`}
        </Text>
        {reauthSuggested ? <AppButton title={S.reauth.action} variant="gold" compact onPress={() => setOpen(true)} /> : null}
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.box}>
            <Text style={styles.title}>{S.reauth.title}</Text>
            <TextField label={S.login.password} secure value={password} onChangeText={setPassword} error={error} autoFocus />
            <View style={styles.row}>
              <AppButton title={S.cancel} variant="secondary" onPress={() => setOpen(false)} style={styles.flex} />
              <AppButton
                title={S.reauth.action}
                onPress={submit}
                loading={busy}
                disabled={password.length === 0}
                style={styles.flex}
              />
            </View>
          </View>
        </View>
      </Modal>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 12,
    marginTop: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.warnBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reauth: { backgroundColor: colors.infoBg },
  text: { flex: 1, color: colors.text, fontSize: font.label, fontWeight: font.weightMedium },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 22 },
  box: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 20 },
  title: { fontSize: 20, fontWeight: font.weightBold, color: colors.text, marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
