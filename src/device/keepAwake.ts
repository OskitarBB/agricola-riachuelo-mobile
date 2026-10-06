// src/device/keepAwake.ts — Pantalla siempre encendida durante la pasada (RF-29, R-19).
//
// QUÉ HACE: reexporta useKeepAwake con una etiqueta por pantalla. Se usa en PANT-16 (pasada activa),
// PANT-31 (cámara en sesión) y PANT-32 (modo prueba). La captura NUNCA ocurre con la pantalla apagada.
// Fase 4: keepAwakeOn/Off mantienen la pantalla encendida mientras dura una sincronización manual (subir cientos de
// fotos toma minutos y, con la pantalla apagada, el sistema suspende la app y corta las subidas).

import { activateKeepAwakeAsync, deactivateKeepAwake, useKeepAwake } from 'expo-keep-awake';

export function useFieldKeepAwake(tag: string): void {
  useKeepAwake(`riachuelo-${tag}`);
}

export async function keepAwakeOn(tag: string): Promise<void> {
  try {
    await activateKeepAwakeAsync(`riachuelo-${tag}`);
  } catch {
    // No crítico: si el sistema no lo permite, la sincronización sigue mientras la app esté abierta.
  }
}

export async function keepAwakeOff(tag: string): Promise<void> {
  try {
    await deactivateKeepAwake(`riachuelo-${tag}`);
  } catch {
    // No crítico.
  }
}
