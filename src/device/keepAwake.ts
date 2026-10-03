// src/device/keepAwake.ts — Pantalla siempre encendida durante la pasada (RF-29, R-19).
//
// QUÉ HACE: reexporta useKeepAwake con una etiqueta por pantalla. Se usa en PANT-16 (pasada activa),
// PANT-31 (cámara en sesión) y PANT-32 (modo prueba). La captura NUNCA ocurre con la pantalla apagada.

import { useKeepAwake } from 'expo-keep-awake';

export function useFieldKeepAwake(tag: string): void {
  useKeepAwake(`riachuelo-${tag}`);
}
