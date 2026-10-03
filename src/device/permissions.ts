// src/device/permissions.ts — Consulta y solicitud de permisos según la función del celular (RF-14, PANT-07).
//
// QUÉ HACE: CÁMARA para Cámara 1/2 (fotos y lectura del QR); UBICACIÓN para el Controlador (GPS por
// secuencia). La "Red local" del iPhone no se puede consultar desde la app: se muestra cómo revisarla.
// También el controlador usa la cámara para nada: no se le pide (menos permisos = menos fricción).

import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

import type { DeviceRole } from '../domain/types';
import { logEvent } from '../diagnostics/eventLog';

export type PermissionKind = 'CAMERA' | 'LOCATION' | 'LOCAL_NETWORK';
export type PermissionState = 'GRANTED' | 'DENIED' | 'UNDETERMINED' | 'NOT_VERIFIABLE';

export interface PermissionItem {
  kind: PermissionKind;
  state: PermissionState;
  required: boolean;
  canAskAgain: boolean;
}

/** Permisos que necesita cada función (en ese orden). */
export function permissionsForRole(role: DeviceRole): PermissionKind[] {
  const list: PermissionKind[] = role === 'CONTROLADOR' ? ['LOCATION'] : ['CAMERA'];
  if (Platform.OS === 'ios') list.push('LOCAL_NETWORK');
  return list;
}

function map(status: string): PermissionState {
  if (status === 'granted') return 'GRANTED';
  if (status === 'denied') return 'DENIED';
  return 'UNDETERMINED';
}

export async function checkPermission(kind: PermissionKind): Promise<PermissionItem> {
  switch (kind) {
    case 'CAMERA': {
      const r = await Camera.getCameraPermissionsAsync();
      return { kind, state: map(r.status), required: true, canAskAgain: r.canAskAgain };
    }
    case 'LOCATION': {
      const r = await Location.getForegroundPermissionsAsync();
      return { kind, state: map(r.status), required: true, canAskAgain: r.canAskAgain };
    }
    case 'LOCAL_NETWORK':
      // iOS no informa su estado; no bloquea el avance (se revisa en Ajustes).
      return { kind, state: 'NOT_VERIFIABLE', required: false, canAskAgain: false };
  }
}

export async function requestPermission(kind: PermissionKind): Promise<PermissionItem> {
  let item: PermissionItem;
  switch (kind) {
    case 'CAMERA': {
      const r = await Camera.requestCameraPermissionsAsync();
      item = { kind, state: map(r.status), required: true, canAskAgain: r.canAskAgain };
      break;
    }
    case 'LOCATION': {
      const r = await Location.requestForegroundPermissionsAsync();
      item = { kind, state: map(r.status), required: true, canAskAgain: r.canAskAgain };
      break;
    }
    default:
      item = await checkPermission(kind);
  }
  logEvent('INFO', 'DEVICE', 'PERMISSION', { kind, state: item.state });
  return item;
}

export async function checkRolePermissions(role: DeviceRole): Promise<PermissionItem[]> {
  return Promise.all(permissionsForRole(role).map(checkPermission));
}

/** ¿Están concedidos todos los permisos obligatorios de la función? */
export async function rolePermissionsOk(role: DeviceRole): Promise<boolean> {
  const items = await checkRolePermissions(role);
  return items.every((i) => !i.required || i.state === 'GRANTED');
}

export function openAppSettings(): void {
  Linking.openSettings().catch(() => undefined);
}
