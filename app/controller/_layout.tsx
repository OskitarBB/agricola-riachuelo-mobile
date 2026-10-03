// app/controller/_layout.tsx — Pantallas del CONTROLADOR (PANT-10 a PANT-21).
//
// QUÉ HACE: al entrar inicia el runtime del controlador (recupera una sesión abierta tras un cierre o
// reinicio, 8.10) y define la navegación. "Cambiar marcador" (PANT-17) se abre como hoja modal.
// La guarda (función CONTROLADOR) está en app/_layout.tsx.

import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { controllerRuntime } from '../../src/controller/controllerRuntime';
import { colors } from '../../src/ui/theme';

export default function ControllerLayout() {
  useEffect(() => {
    void controllerRuntime.init();
  }, []);
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="marker" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
