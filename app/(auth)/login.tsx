// app/(auth)/login.tsx — PANT-02 Iniciar sesión (maestro §7.4 y §7.5; RF-02 a RF-05, RF-10).
//
// QUÉ HACE: logo animado de Agrícola Riachuelo, correo y contraseña (con mostrar/ocultar), indicador
// "Con internet / Sin internet" y versión de la app. Un solo botón "Ingresar":
//  - con internet → login contra el backend (o el simulado) y preparación del acceso sin internet;
//  - sin respuesta del servidor → intenta automáticamente el login sin internet (RN-03);
//  - tras 5 fallos sin internet → bloqueo de 15 min con hora de fin visible (RN-20).
// Enlaces: "Crear cuenta" (PANT-03) y "¿Olvidaste tu contraseña?" (PANT-05).

import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEMO_ACCOUNTS } from '../../src/api/mock/mockBackend';
import { login } from '../../src/auth/authService';
import { useAppSession } from '../../src/auth/authStore';
import { errorsByField, validateLogin } from '../../src/auth/validation';
import { APP_VERSION, ENV } from '../../src/config';
import { formatTime } from '../../src/domain/time';
import { AppButton } from '../../src/ui/components/AppButton';
import { FadeIn } from '../../src/ui/components/FadeIn';
import { Logo } from '../../src/ui/components/Logo';
import { StatusPill } from '../../src/ui/components/StatusPill';
import { TextField } from '../../src/ui/components/TextField';
import { feedback } from '../../src/ui/feedback';
import { messageFor } from '../../src/ui/messages';
import { S } from '../../src/ui/strings';
import { colors, font, radius, shadow } from '../../src/ui/theme';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const online = useAppSession((s) => s.online);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<null | 'CONNECTING' | 'PREPARING_OFFLINE' | 'CHECKING_OFFLINE'>(null);

  const submit = async () => {
    setError(null);
    const errs = errorsByField(validateLogin({ email, password }));
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      feedback('error');
      return;
    }
    const r = await login(email, password, setPhase);
    setPhase(null);
    if (r.ok) {
      feedback('success');
      router.replace('/');
      return;
    }
    feedback('error');
    if (r.code === 'BLOQUEADO_TEMPORAL' && r.until) setError(`${messageFor(r.code)} ${S.login.lockedUntil(formatTime(r.until))}`);
    else setError(messageFor(r.code));
  };

  return (
    <LinearGradient colors={[colors.brandDeep, colors.brand, colors.bg]} locations={[0, 0.42, 0.42]} style={styles.flex}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoWrap}>
            <Logo size={250} />
            <FadeIn delay={250}>
              <Text style={styles.subtitle}>{S.login.subtitle}</Text>
            </FadeIn>
          </View>

          <FadeIn delay={350} distance={40}>
            <View style={[styles.card, shadow]}>
              <View style={styles.cardHead}>
                <Text style={styles.title}>{S.login.title}</Text>
                <StatusPill label={online ? S.online : S.offline} tone={online ? 'ok' : 'warn'} pulse={!online} />
              </View>
              <TextField
                label={S.login.email}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                returnKeyType="next"
                error={fieldErrors.email}
              />
              <TextField
                label={S.login.password}
                value={password}
                onChangeText={setPassword}
                secure
                textContentType="password"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                error={fieldErrors.password}
              />
              {error ? (
                <FadeIn from="scale">
                  <Text style={styles.error}>{error}</Text>
                </FadeIn>
              ) : null}
              {phase === 'PREPARING_OFFLINE' ? <Text style={styles.phase}>{S.login.preparingOffline}</Text> : null}
              <AppButton title={S.login.submit} onPress={submit} loading={phase !== null} />
              <View style={styles.links}>
                <AppButton title={S.login.createAccount} variant="ghost" compact onPress={() => router.push('/register')} />
                <AppButton title={S.login.forgot} variant="ghost" compact onPress={() => router.push('/forgot-password')} />
              </View>
            </View>
          </FadeIn>

          {ENV.useMockApi ? (
            <FadeIn delay={600}>
              <Text style={styles.demoTitle}>{S.login.demoHint}</Text>
              <View style={styles.demoRow}>
                {DEMO_ACCOUNTS.map((a) => (
                  <Pressable
                    key={a.email}
                    style={({ pressed }) => [styles.demo, pressed && { opacity: 0.7 }]}
                    onPress={() => {
                      feedback('toggle');
                      setEmail(a.email);
                      setPassword(a.password);
                      setFieldErrors({});
                      setError(null);
                    }}
                  >
                    <Text style={styles.demoText}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
            </FadeIn>
          ) : null}

          <Text style={styles.version}>
            {S.company} · {S.version} {APP_VERSION}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 18 },
  logoWrap: { alignItems: 'center', marginBottom: 18 },
  subtitle: { color: '#E1F2E5', fontSize: font.body, marginTop: 10, fontWeight: font.weightMedium, letterSpacing: 0.4 },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 20 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: font.title, fontWeight: font.weightBold, color: colors.text },
  error: {
    color: colors.error,
    backgroundColor: colors.errorBg,
    padding: 12,
    borderRadius: radius.sm,
    fontSize: font.body,
    marginBottom: 12,
    fontWeight: font.weightMedium,
  },
  phase: { color: colors.info, fontSize: font.body, marginBottom: 10, textAlign: 'center' },
  links: { marginTop: 8, gap: 2 },
  demoTitle: { textAlign: 'center', color: colors.textMuted, fontSize: 15, marginTop: 22, marginBottom: 8 },
  demoRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 8 },
  demo: {
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  demoText: { color: colors.brand, fontWeight: font.weightSemi, fontSize: 15 },
  version: { textAlign: 'center', color: colors.textMuted, fontSize: 15, marginTop: 24 },
});
