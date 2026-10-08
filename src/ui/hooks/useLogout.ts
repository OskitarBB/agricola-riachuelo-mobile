// src/ui/hooks/useLogout.ts — Acción "Cerrar sesión" (PANT-09 y cabecera), maestro §7.8; RN-19 modificada (ADR 0008).
//
// QUÉ HACE: pide confirmación y cierra la sesión de usuario (borra tokens, conserva datos de campo y el verificador
// sin internet), detiene los servicios y vuelve al login. Desde v0.4.5 una sesión de monitoreo abierta NO lo impide
// (pedido del equipo en la prueba de campo del 07/10/2026): el aviso lo explica, la pasada en curso del controlador
// se pausa antes de salir y la sesión queda guardada; al volver a entrar se recupera (8.10), igual que tras una
// revocación (7.8).

import { router } from 'expo-router';
import { useCallback } from 'react';

import { logout } from '../../auth/authService';
import { useAppSession } from '../../auth/authStore';
import { cameraAgent } from '../../camera/cameraAgent';
import { controllerRuntime } from '../../controller/controllerRuntime';
import { hasOpenMonitoringSession } from '../../device/deviceRole';
import { logEvent } from '../../diagnostics/eventLog';
import { confirm } from '../components/ConfirmDialog';
import { S } from '../strings';
import { showToast } from '../toast';

export function useLogout(): () => Promise<void> {
  return useCallback(async () => {
    const role = useAppSession.getState().deviceRole;
    const openSession = await hasOpenMonitoringSession(role);
    const ok = await confirm({
      title: S.settings.logout,
      message: openSession ? S.settings.logoutConfirmOpenSession : S.settings.logoutConfirm,
      confirmText: S.settings.logout,
      danger: true,
    });
    if (!ok) return;
    // La pasada en curso queda en pausa (y las cámaras lo saben) antes de cortar la red local.
    if (openSession && role === 'CONTROLADOR') await controllerRuntime.pause();
    const r = await logout();
    if (!r.ok) {
      showToast(r.code, 'error');
      return;
    }
    if (openSession) logEvent('INFO', 'AUTH', 'LOGOUT_WITH_OPEN_SESSION', { role });
    await controllerRuntime.shutdown();
    cameraAgent.stop();
    router.replace('/login');
  }, []);
}
