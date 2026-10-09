// app/pests/_layout.tsx — «Ubicar plaga» (ADR 0009): mapa/lista de alertas y detalle de cada una.
// La guarda (usuario AUTENTICADO: operador, administrador o especialista) está en app/_layout.tsx.

import { Stack } from 'expo-router';

import { colors } from '../../src/ui/theme';

export default function PestsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.bg } }} />
  );
}
