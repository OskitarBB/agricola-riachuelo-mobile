// src/ui/hooks/useLogout.ts — Acción "Cerrar sesión" (PANT-09 y cabecera), maestro §7.8 y RN-19.
//
// QUÉ HACE: si este celular tiene una sesión de monitoreo abierta, NO deja salir (mensaje
// SESION_ABIERTA_IMPIDE_SALIR). Si no, pide confirmación, cierra la sesión de usuario (borra tokens,
// conserva datos de campo y el verificador sin internet), detiene los servicios y vuelve al login.

import { router } from 'expo-router';
import { useCallback } from 'react';

import { logout } from '../../auth/authService';
import { useAppSession } from '../../auth/authStore';
import { cameraAgent } from '../../camera/cameraAgent';
import { controllerRuntime } from '../../controller/controllerRuntime';
import { hasOpenMonitoringSession } from '../../device/deviceRole';
import { confirm } from '../components/ConfirmDialog';
import { S } from '../strings';
import { showToast } from '../toast';

export function useLogout(): () => Promise<void> {
  return useCallback(async () => {
    const role = useAppSession.getState().deviceRole;
    if (await hasOpenMonitoringSession(role)) {
      showToast('SESION_ABIERTA_IMPIDE_SALIR', 'warn');
      return;
    }
    const ok = await confirm({
      title: S.settings.logout,
      message: S.settings.logoutConfirm,
      confirmText: S.settings.logout,
      danger: true,
    });
    if (!ok) return;
    const r = await logout(false);
    if (!r.ok) {
      showToast(r.code, 'error');
      return;
    }
    await controllerRuntime.shutdown();
    cameraAgent.stop();
    router.replace('/login');
  }, []);
}
