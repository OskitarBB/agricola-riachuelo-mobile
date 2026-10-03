// app/camera/_layout.tsx — Pantallas de las funciones CÁMARA 1 / CÁMARA 2 (PANT-30, PANT-31, PANT-32).
//
// QUÉ HACE: al entrar inicia el agente de cámara (recupera un contexto abierto y reconecta con el
// controlador, 8.10) y el detector de estabilidad. La guarda (función de cámara) está en app/_layout.tsx.

import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { useAppSession } from '../../src/auth/authStore';
import { cameraAgent } from '../../src/camera/cameraAgent';
import { colors } from '../../src/ui/theme';

export default function CameraLayout() {
  const role = useAppSession((s) => s.deviceRole);
  useEffect(() => {
    if (role === 'CAMERA_1' || role === 'CAMERA_2') void cameraAgent.start(role);
  }, [role]);
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.brandDeep } }} />;
}
