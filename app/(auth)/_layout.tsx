// app/(auth)/_layout.tsx — Grupo de pantallas SIN sesión de usuario: login, registro, solicitud enviada y
// recuperación de contraseña (PANT-02 a PANT-05). La guarda está en app/_layout.tsx (Stack.Protected).

import { Stack } from 'expo-router';

import { colors } from '../../src/ui/theme';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.bg } }} />
  );
}
