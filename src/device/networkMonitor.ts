// src/device/networkMonitor.ts — Vigila la conectividad (expo-network, D-19) y la IP local.
//
// QUÉ HACE:
//  - Al cambiar la red, comprueba GET /health (authService.checkBackend) con una pequeña espera para no
//    saturar; así se actualiza el indicador "Con internet / Sin internet" y el aviso de revalidación (7.5).
//  - Fase 4: si el servidor responde, avisa al oyente registrado (src/boot.ts → sincronización automática, S-08).
//  - currentNetworkType(): Wi-Fi, datos móviles u otra (la sincronización automática es solo con Wi-Fi y la manual
//    avisa cuántos MB usará con datos móviles).
//  - localIp(): IP del celular en el Wi-Fi (para el QR del controlador, maestro §14.2). Si devuelve vacío
//    o 0.0.0.0 (hotspot del controlador), PANT-13 permite escribirla a mano (Q-04).

import * as Network from 'expo-network';

import { checkBackend } from '../auth/authService';

let sub: { remove(): void } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let passActiveProvider: () => boolean = () => false;
let onlineListener: (() => void) | null = null;

export function setPassActiveProvider(fn: () => boolean): void {
  passActiveProvider = fn;
}

/** Se llama cada vez que GET /health responde bien después de un cambio de red. */
export function setBackendOnlineListener(fn: (() => void) | null): void {
  onlineListener = fn;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    checkBackend(passActiveProvider())
      .then((online) => {
        if (online) onlineListener?.();
      })
      .catch(() => undefined);
  }, 800);
}

export function startNetworkMonitor(): void {
  if (sub) return;
  sub = Network.addNetworkStateListener(() => schedule());
  schedule();
}

export function stopNetworkMonitor(): void {
  sub?.remove();
  sub = null;
}

/** Vuelve a comprobar el servidor (p. ej. al volver la app a primer plano). */
export function recheckBackend(): void {
  schedule();
}

export type NetworkKind = 'WIFI' | 'DATOS_MOVILES' | 'OTRA' | 'SIN_RED';

export async function currentNetworkType(): Promise<NetworkKind> {
  try {
    const st = await Network.getNetworkStateAsync();
    if (st.isConnected === false || st.type === Network.NetworkStateType.NONE) return 'SIN_RED';
    if (st.type === Network.NetworkStateType.WIFI || st.type === Network.NetworkStateType.ETHERNET) return 'WIFI';
    if (st.type === Network.NetworkStateType.CELLULAR) return 'DATOS_MOVILES';
    return 'OTRA';
  } catch {
    return 'OTRA';
  }
}

export async function localIp(): Promise<string | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    return ip && ip !== '0.0.0.0' ? ip : null;
  } catch {
    return null;
  }
}
