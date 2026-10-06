// app/change-password.tsx — PANT-06 Cambiar contraseña (maestro §7.6; RF-06, RF-08; RN-04).
//
// QUÉ HACE: pide contraseña actual, nueva y confirmación (política: 8+ caracteres con letras y números).
// Si viene de una contraseña TEMPORAL es obligatorio: solo se puede cambiarla o cerrar sesión.
// Al cambiarla con internet se crea el verificador para entrar sin internet y se continúa.
// Plataforma Django: POST /api/v1/auth/change-password (204). Django además rechaza contraseñas comunes, solo
// numéricas o parecidas al nombre o correo (PASSWORD_POLICY): su motivo se muestra debajo de "Nueva contraseña".

import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { changePassword, logout } from '../src/auth/authService';
import { useAppSession } from '../src/auth/authStore';
import { errorsByField, validateChangePassword } from '../src/auth/validation';
import { CONFIG } from '../src/config';
import { AppButton } from '../src/ui/components/AppButton';
import { AppHeader } from '../src/ui/components/AppHeader';
import { Card } from '../src/ui/components/Card';
import { Screen } from '../src/ui/components/Screen';
import { TextField } from '../src/ui/components/TextField';
import { feedback } from '../src/ui/feedback';
import { messageFor } from '../src/ui/messages';
import { S } from '../src/ui/strings';
import { colors, font, radius } from '../src/ui/theme';
import { showToast } from '../src/ui/toast';

export default function ChangePasswordScreen() {
  const status = useAppSession((s) => s.status);
  const online = useAppSession((s) => s.online);
  const mandatory = status === 'CAMBIO_CONTRASENA_REQUERIDO';
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setError(null);
    const errs = errorsByField(validateChangePassword(f, CONFIG.auth.passwordMinLength));
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      feedback('error');
      return;
    }
    setBusy(true);
    const r = await changePassword(f.current, f.next);
    setBusy(false);
    if (!r.ok) {
      feedback('error');
      // Motivos por campo del servidor (newPassword / currentPassword) debajo de su caja.
      const server: Record<string, string> = {};
      for (const fe of r.fieldErrors ?? []) {
        if (fe.field === 'newPassword') server.next = fe.message;
        if (fe.field === 'currentPassword') server.current = fe.message;
      }
      if (r.code === 'CONTRASENA_ACTUAL_INCORRECTA') server.current = messageFor(r.code);
      setErrors(server);
      setError(Object.keys(server).length > 0 ? null : messageFor(r.code));
      return;
    }
    showToast(S.changePassword.done, 'success');
    router.replace('/');
  };

  const doLogout = async () => {
    await logout(false);
    router.replace('/login');
  };

  return (
    <Screen
      header={<AppHeader title={S.changePassword.title} back={!mandatory} />}
      footer={
        <>
          <AppButton title={S.save} onPress={submit} loading={busy} disabled={!online} />
          {mandatory ? <AppButton title={S.changePassword.logout} variant="secondary" onPress={doLogout} /> : null}
        </>
      }
    >
      {mandatory ? <Text style={styles.notice}>{S.changePassword.mandatory}</Text> : null}
      <Card delay={60}>
        <TextField
          label={S.changePassword.current}
          value={f.current}
          onChangeText={set('current')}
          secure
          error={errors.current}
        />
        <TextField label={S.changePassword.next} value={f.next} onChangeText={set('next')} secure error={errors.next} />
        <Text style={styles.hint}>{S.changePassword.rules}</Text>
        <TextField
          label={S.changePassword.confirm}
          value={f.confirm}
          onChangeText={set('confirm')}
          secure
          error={errors.confirm}
        />
      </Card>
      {!online ? <Text style={styles.err}>{messageFor('SIN_INTERNET')}</Text> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textMuted, fontSize: font.label, marginTop: -4, marginBottom: 10 },
  notice: {
    backgroundColor: colors.warnBg,
    color: colors.text,
    padding: 14,
    borderRadius: radius.md,
    fontSize: font.body,
    marginBottom: 12,
    fontWeight: font.weightMedium,
  },
  err: {
    color: colors.error,
    backgroundColor: colors.errorBg,
    padding: 12,
    borderRadius: radius.sm,
    fontSize: font.body,
    marginTop: 4,
  },
});
