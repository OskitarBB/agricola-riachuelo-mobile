// src/device/batteryService.ts — Nivel de batería (RF-46).
//
// QUÉ HACE: lee el nivel (0..100 %) para el monitor, los avisos y las reglas de inicio/pausa (RN-10).
// Devuelve null si el sistema no lo informa (simuladores): null no bloquea ninguna regla.

import * as Battery from 'expo-battery';

export async function batteryPct(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? Math.round(level * 100) : null;
  } catch {
    return null;
  }
}

export type BatteryLevelState = 'OK' | 'AVISO' | 'CRITICO';

export function batteryState(pct: number | null, warnPct: number, pausePct: number): BatteryLevelState {
  if (pct === null) return 'OK';
  if (pct < pausePct) return 'CRITICO';
  if (pct < warnPct) return 'AVISO';
  return 'OK';
}
