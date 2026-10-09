// app/index.tsx — PANT-01 Arranque y distribuidor de rutas (maestro §6.4).
//
// QUÉ HACE: muestra el logo animado con "Preparando…" mientras se migra la base de datos y se carga la
// sesión. Luego redirige: sin sesión → login; contraseña temporal → cambio; especialista fitosanitario (sin rol de
// campo) → «Ubicar plaga» (ADR 0009); sin función o recién iniciada
// la sesión → función (PANT-08, ADR 0005); faltan permisos → permisos; controlador → panel; cámara → cámara en
// sesión (si tiene contexto abierto) o escanear QR. Si la migración falla: mensaje y "Exportar diagnóstico".
// Esta pantalla también es el "ancla" a la que vuelve Stack.Protected cuando cambia el estado de sesión.

import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { useAppSession } from '../src/auth/authStore';
import { bootApp } from '../src/boot';
import { canDoFieldWork } from '../src/domain/types';
import { hasOpenMonitoringSession } from '../src/device/deviceRole';
import { exportAndShareDiagnostics } from '../src/diagnostics/exportDiagnostics';
import { AppButton } from '../src/ui/components/AppButton';
import { Logo } from '../src/ui/components/Logo';
import { messageFor } from '../src/ui/messages';
import { S } from '../src/ui/strings';
import { colors, font } from '../src/ui/theme';

const MIN_SPLASH_MS = 1100;

function Dots() {
  // useState con inicializador: los valores animados se crean una sola vez por montaje.
  const [v] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));
  useEffect(() => {
    const anims = v.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 380, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 380, useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [v]);
  return (
    <View style={styles.dots}>
      {v.map((d, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: d, transform: [{ scale: d }] }]} />
      ))}
    </View>
  );
}

export default function BootScreen() {
  const { booted, bootError, status, deviceRole, permissionsOk, roleChoicePending, user } = useAppSession();
  const field = canDoFieldWork(user?.roles);
  const [minDone, setMinDone] = useState(false);
  useEffect(() => {
    // La pantalla se monta al arrancar: basta con esperar el mínimo desde el montaje.
    const t = setTimeout(() => setMinDone(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  const route = useCallback(async () => {
    if (!booted || bootError || !minDone) return;
    if (status === 'SIN_SESION') return router.replace('/login');
    if (status === 'CAMBIO_CONTRASENA_REQUERIDO') return router.replace('/change-password');
    // ADR 0009: el especialista entra solo a «Ubicar plaga» (no elige función ni monitorea).
    if (!field) return router.replace('/pests');
    // ADR 0005: después de cada inicio de sesión se elige (o confirma) la función del celular.
    if (!deviceRole || roleChoicePending) return router.replace('/role');
    if (!permissionsOk) return router.replace('/permissions');
    if (deviceRole === 'CONTROLADOR') return router.replace('/controller');
    const open = await hasOpenMonitoringSession(deviceRole);
    router.replace(open ? '/camera/live' : '/camera');
  }, [booted, bootError, minDone, status, deviceRole, permissionsOk, roleChoicePending, field]);

  // Se vuelve a evaluar cada vez que esta pantalla recibe el foco (p. ej. tras cerrar sesión o cambiar función).
  useFocusEffect(
    useCallback(() => {
      void route();
    }, [route]),
  );

  return (
    <LinearGradient colors={[colors.brandDeep, colors.brand, '#2E8B47']} style={styles.flex}>
      <View style={styles.center}>
        <Logo size={290} />
        <Text style={styles.app}>{S.appName}</Text>
        {bootError ? (
          <View style={styles.error}>
            <Text style={styles.errorText}>{messageFor(bootError)}</Text>
            <AppButton title={S.retry} variant="gold" onPress={() => void bootApp()} />
            <AppButton
              title={S.settings.exportDiagnostics}
              variant="secondary"
              onPress={() => void exportAndShareDiagnostics()}
            />
          </View>
        ) : (
          <>
            <Dots />
            <Text style={styles.preparing}>{S.preparing}</Text>
          </>
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  app: { color: colors.textOnDark, fontSize: 22, fontWeight: font.weightBold, marginTop: 18, letterSpacing: 0.6 },
  preparing: { color: '#D3EBD8', fontSize: font.body, marginTop: 10 },
  dots: { flexDirection: 'row', gap: 10, marginTop: 28 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.goldLight },
  error: { marginTop: 24, width: '100%', gap: 12 },
  errorText: { color: colors.textOnDark, fontSize: font.body, textAlign: 'center' },
});
