// app/(auth)/register.tsx — PANT-03 Crear cuenta (maestro §7.3, RF-01).
//
// QUÉ HACE: pide nombre completo, correo, celular (opcional), código de trabajador (opcional), contraseña,
// confirmación y aceptación del aviso de privacidad. Valida por campo (validation.ts) y envía la solicitud.
// La cuenta queda PENDIENTE_APROBACION hasta que el ADMINISTRADOR la apruebe en la web → PANT-04.
// Sin internet el botón queda deshabilitado.
// INTEGRACIÓN FUTURA: POST /api/v1/auth/register (Spring Boot); la aprobación se hace en la web (Angular).

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { register } from '../../src/auth/authService';
import { useAppSession } from '../../src/auth/authStore';
import { errorsByField, validateRegistration } from '../../src/auth/validation';
import { CONFIG } from '../../src/config';
import { AppButton } from '../../src/ui/components/AppButton';
import { AppHeader } from '../../src/ui/components/AppHeader';
import { Card } from '../../src/ui/components/Card';
import { Screen } from '../../src/ui/components/Screen';
import { TextField } from '../../src/ui/components/TextField';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { S } from '../../src/ui/strings';
import { colors, font, radius } from '../../src/ui/theme';

export default function RegisterScreen() {
  const online = useAppSession((s) => s.online);
  const [f, setF] = useState({
    fullName: '',
    email: '',
    phone: '',
    employeeCode: '',
    password: '',
    confirm: '',
    accepted: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setError(null);
    const errs = errorsByField(validateRegistration(f, CONFIG.auth.passwordMinLength));
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      feedback('error');
      return;
    }
    setBusy(true);
    const r = await register(f);
    setBusy(false);
    if (r.ok) {
      feedback('success');
      router.replace('/pending');
      return;
    }
    feedback('error');
    if (r.fieldErrors?.length) setErrors(errorsByField(r.fieldErrors));
    setError(messageFor(r.code));
  };

  return (
    <Screen
      header={<AppHeader title={S.register.title} back />}
      footer={<AppButton title={S.register.submit} onPress={submit} loading={busy} disabled={!online} />}
    >
      <Card delay={50}>
        <TextField
          label={S.register.fullName}
          value={f.fullName}
          onChangeText={set('fullName')}
          autoCapitalize="words"
          error={errors.fullName}
        />
        <TextField
          label={S.register.email}
          value={f.email}
          onChangeText={set('email')}
          autoCapitalize="none"
          keyboardType="email-address"
          error={errors.email}
        />
        <TextField
          label={S.register.phone}
          value={f.phone}
          onChangeText={set('phone')}
          keyboardType="phone-pad"
          error={errors.phone}
        />
        <TextField
          label={S.register.employeeCode}
          value={f.employeeCode}
          onChangeText={set('employeeCode')}
          autoCapitalize="characters"
        />
      </Card>
      <Card delay={120}>
        <TextField label={S.register.password} value={f.password} onChangeText={set('password')} secure error={errors.password} />
        <TextField label={S.register.confirm} value={f.confirm} onChangeText={set('confirm')} secure error={errors.confirm} />
      </Card>
      <Card delay={190}>
        <Text style={styles.privacy}>{S.register.privacy}</Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: f.accepted }}
          onPress={() => {
            feedback('toggle');
            setF((p) => ({ ...p, accepted: !p.accepted }));
          }}
          style={styles.check}
        >
          <View style={[styles.box, f.accepted && styles.boxOn]}>{f.accepted ? <Text style={styles.tick}>✓</Text> : null}</View>
          <Text style={styles.checkText}>{S.register.accept}</Text>
        </Pressable>
        {errors.accepted ? <Text style={styles.err}>{errors.accepted}</Text> : null}
      </Card>
      {!online ? <Text style={styles.err}>{messageFor('SIN_INTERNET')}</Text> : null}
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  privacy: { fontSize: font.body, color: colors.textMuted, lineHeight: 23, marginBottom: 12 },
  check: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  box: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  boxOn: { backgroundColor: colors.brand },
  tick: { color: '#fff', fontWeight: font.weightBold, fontSize: 18 },
  checkText: { fontSize: font.body, color: colors.text, fontWeight: font.weightMedium, flex: 1 },
  err: {
    color: colors.error,
    fontSize: font.body,
    marginTop: 6,
    backgroundColor: colors.errorBg,
    padding: 10,
    borderRadius: radius.sm,
  },
});
