// app/(auth)/forgot-password.tsx — PANT-05 Recuperar contraseña vía administrador (maestro §7.7, RF-07).
//
// QUÉ HACE: pide el correo y envía la solicitud. SIEMPRE muestra el mismo mensaje neutro (no revela si el
// correo existe). El administrador asigna una contraseña temporal en la web; al entrar con ella, la app
// obliga a cambiarla (PANT-06). Requiere internet.
// Plataforma Django: POST /api/v1/auth/password-reset-requests (202 siempre); el pedido aparece en la web del administrador.

import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { requestPasswordReset } from '../../src/auth/authService';
import { useAppSession } from '../../src/auth/authStore';
import { isValidEmail } from '../../src/auth/validation';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { Screen } from '../../src/ui/components/Screen';
import { TextField } from '../../src/ui/components/TextField';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';

export default function ForgotPasswordScreen() {
  const online = useAppSession((s) => s.online);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isValidEmail(email)) {
      feedback('error');
      setError(S.forgot.invalidEmail);
      return;
    }
    setError(null);
    setBusy(true);
    const r = await requestPasswordReset(email);
    setBusy(false);
    if (!r.ok) {
      feedback('error');
      setError(messageFor(r.code));
      return;
    }
    feedback('success');
    setSent(true);
  };

  return (
    <Screen
      header={<AppHeader title={S.forgot.title} back />}
      footer={<AppButton title={S.forgot.submit} onPress={submit} loading={busy} disabled={!online || sent} />}
    >
      <Card delay={60}>
        <TextField
          label={S.forgot.email}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          error={error}
        />
      </Card>
      {!online ? <Text style={styles.warn}>{messageFor('SIN_INTERNET')}</Text> : null}
      {sent ? (
        <FadeIn from="scale">
          <Text style={styles.ok}>{S.forgot.neutral}</Text>
        </FadeIn>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ok: {
    backgroundColor: colors.okBg,
    color: colors.ok,
    padding: 14,
    borderRadius: radius.md,
    fontSize: font.body,
    fontWeight: font.weightMedium,
    lineHeight: 23,
  },
  warn: { backgroundColor: colors.warnBg, color: colors.warn, padding: 14, borderRadius: radius.md, fontSize: font.body },
});
