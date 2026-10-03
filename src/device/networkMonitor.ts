// src/device/networkMonitor.ts — Vigila la conectividad (expo-network, D-19) y la IP local.
//
// QUÉ HACE:
//  - Al cambiar la red, comprueba GET /health (authService.checkBackend) con una pequeña espera para no
//    saturar; así se actualiza el indicador "Con internet / Sin internet" y el aviso de revalidación (7.5).
//  - localIp(): IP del celular en el Wi-Fi (para el QR del controlador, maestro §14.2). Si devuelve vacío
//    o 0.0.0.0 (hotspot del controlador), PANT-13 permite escribirla a mano (Q-04).

import * as Network from 'expo-network';

import { checkBackend } from '../auth/authService';

let sub: { remove(): void } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let passActiveProvider: () => boolean = () => false;

export function setPassActiveProvider(fn: () => boolean): void {
  passActiveProvider = fn;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    checkBackend(passActiveProvider()).catch(() => undefined);
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

export async function localIp(): Promise<string | null> {
  try {
    const ip = await Network.getIpAddressAsync();
    return ip && ip !== '0.0.0.0' ? ip : null;
  } catch {
    return null;
  }
}
