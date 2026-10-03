// app/(setup)/_layout.tsx — Configuración del celular después del login: función (PANT-08) y permisos (PANT-07).

import { Stack } from 'expo-router';

import { colors } from '../../src/ui/theme';

export default function SetupLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.bg } }} />
  );
}
