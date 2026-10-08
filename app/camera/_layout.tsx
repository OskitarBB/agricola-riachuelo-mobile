// app/camera/_layout.tsx — Pantallas de las funciones CÁMARA 1 / CÁMARA 2 (PANT-30, PANT-31, PANT-32).
//
// QUÉ HACE: al entrar inicia el agente de cámara (recupera un contexto abierto y reconecta con el
// controlador, 8.10) y el detector de estabilidad. La guarda (función de cámara) está en app/_layout.tsx.
// v0.4.5: cuando el controlador cierra la sesión de monitoreo (SESSION_CLOSED), la cámara vuelve a PANT-08 para
// elegir la función del celular, desde cualquiera de sus pantallas.

import { router, Stack } from 'expo-router';
import { useEffect } from 'react';

import { useAppSession } from '../../src/auth/authStore';
import { cameraAgent } from '../../src/camera/cameraAgent';
import { useCameraLive } from '../../src/camera/cameraStore';
import { colors } from '../../src/ui/theme';
import { showToast } from '../../src/ui/toast';

export default function CameraLayout() {
  const role = useAppSession((s) => s.deviceRole);
  useEffect(() => {
    if (role === 'CAMERA_1' || role === 'CAMERA_2') void cameraAgent.start(role);
  }, [role]);
  const sessionEnded = useCameraLive((s) => s.sessionEnded);
  useEffect(() => {
    if (!sessionEnded) return;
    useCameraLive.setState({ sessionEnded: false });
    showToast('SESION_CERRADA', 'info');
    useAppSession.getState().set({ roleChoicePending: true });
    router.replace('/role');
  }, [sessionEnded]);
  return <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.brandDeep } }} />;
}
