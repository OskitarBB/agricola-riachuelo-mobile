// app/_layout.tsx — Raíz de la navegación (Expo Router) con rutas protegidas (maestro §8.11, D-17).
//
// QUÉ HACE:
//  - Arranca la app (src/boot.ts) y muestra PANT-01 (app/index.tsx) mientras tanto.
//  - Define el Stack y las GUARDAS con Stack.Protected:
//      (auth)/*          solo SIN sesión de usuario
//      change-password   con sesión (única ruta en CAMBIO_CONTRASENA_REQUERIDO)
//      (setup)/*, settings, gallery   solo AUTENTICADO
//      controller/*      AUTENTICADO + función CONTROLADOR
//      camera/*          AUTENTICADO + función de cámara
//  - Monta los avisos globales (toast) y el diálogo de confirmación.

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppSession } from '../src/auth/authStore';
import { bootApp } from '../src/boot';
import { ConfirmHost } from '../src/ui/components/ConfirmDialog';
import { ToastHost } from '../src/ui/components/ToastHost';
import { colors } from '../src/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const { booted, status, deviceRole } = useAppSession();

  useEffect(() => {
    void bootApp();
    // El arranque animado (PANT-01) reemplaza al splash nativo apenas React dibuja.
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => undefined), 150);
    return () => clearTimeout(t);
  }, []);

  const signedOut = booted && status === 'SIN_SESION';
  const mustChange = booted && status === 'CAMBIO_CONTRASENA_REQUERIDO';
  const authed = booted && status === 'AUTENTICADO';
  const isController = authed && deviceRole === 'CONTROLADOR';
  const isCamera = authed && (deviceRole === 'CAMERA_1' || deviceRole === 'CAMERA_2');

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={mustChange || authed}>
          <Stack.Screen name="change-password" />
        </Stack.Protected>
        <Stack.Protected guard={authed}>
          <Stack.Screen name="(setup)" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="gallery" />
        </Stack.Protected>
        <Stack.Protected guard={isController}>
          <Stack.Screen name="controller" />
        </Stack.Protected>
        <Stack.Protected guard={isCamera}>
          <Stack.Screen name="camera" />
        </Stack.Protected>
      </Stack>
      <ToastHost />
      <ConfirmHost />
    </SafeAreaProvider>
  );
}
