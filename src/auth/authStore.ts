// src/auth/authStore.ts — Estado de sesión de usuario y del celular para la interfaz (Zustand).
//
// QUÉ HACE: guarda en memoria lo que las pantallas necesitan leer rápido: estado de autenticación,
// usuario, modo (con/sin internet), función del celular, permisos listos y si el arranque terminó.
// La fuente de verdad persistente está en SecureStore/SQLite; authService actualiza este store.
// roleChoicePending (ADR 0005): después de CADA inicio de sesión con usuario y contraseña se muestra
// PANT-08 para elegir la función del celular (Controlador, Cámara 1 o Cámara 2). Al reabrir la app con la
// sesión guardada (7.11) no se activa: se entra directo a la función guardada.

import { create } from 'zustand';

import type { AuthState, DeviceIdentity, DeviceRole } from '../domain/types';

export interface AppSessionState extends AuthState {
  booted: boolean;
  bootError: string | null;
  identity: DeviceIdentity | null;
  deviceRole: DeviceRole | null;
  permissionsOk: boolean;
  /** Hay internet y el backend responde (para avisos y botones que lo requieren). */
  online: boolean;
  /** Mostrar el aviso REAUTENTICACION_REQUERIDA (sesión OFFLINE y volvió el internet). */
  reauthSuggested: boolean;
  /** true justo después de iniciar sesión: PANT-08 debe confirmar la función antes de entrar (ADR 0005). */
  roleChoicePending: boolean;
  set(patch: Partial<Omit<AppSessionState, 'set' | 'reset'>>): void;
  reset(): void;
}

const initialAuth: AuthState = {
  status: 'SIN_SESION',
  mode: null,
  user: null,
  lastOnlineAuthAt: null,
  offlineValidUntil: null,
};

export const useAppSession = create<AppSessionState>((set) => ({
  ...initialAuth,
  booted: false,
  bootError: null,
  identity: null,
  deviceRole: null,
  permissionsOk: false,
  online: false,
  reauthSuggested: false,
  roleChoicePending: false,
  set: (patch) => set(patch),
  reset: () => set({ ...initialAuth, reauthSuggested: false, roleChoicePending: false }),
}));

/** Lectura fuera de React (servicios). */
export const appSession = () => useAppSession.getState();
