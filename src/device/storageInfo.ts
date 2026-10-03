// src/device/storageInfo.ts — Espacio libre del celular (RF-46, RNF-13).
//
// QUÉ HACE: informa el espacio libre y su estado frente a los umbrales de configuración (aviso, inicio, pausa).

import { freeSpaceBytes } from '../storage/files';

export function freeSpace(): number | null {
  return freeSpaceBytes();
}

export type SpaceState = 'OK' | 'AVISO' | 'CRITICO';

export function spaceState(bytes: number | null, warnBytes: number, pauseBytes: number): SpaceState {
  if (bytes === null) return 'OK';
  if (bytes < pauseBytes) return 'CRITICO';
  if (bytes < warnBytes) return 'AVISO';
  return 'OK';
}
