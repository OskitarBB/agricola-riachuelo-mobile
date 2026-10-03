// src/ui/feedback.ts — Sonidos y vibración de los botones (pedido del equipo, CFG-2: ui.*).
//
// QUÉ HACE: precarga sonidos cortos (assets/sounds/*.wav) con expo-audio y los reproduce al tocar botones:
//   tap (toque), confirm (acción principal), success (operación correcta), error (algo falló),
//   shutter (captura), toggle (selección). Agrega vibración ligera con expo-haptics.
// Respeta el modo silencio del iPhone (playsInSilentMode: false) y se mezcla con otros audios.
// El operador puede apagar sonidos y vibración en Ajustes (app_meta.ui_sounds / ui_haptics).

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

export type SoundName = 'tap' | 'confirm' | 'success' | 'error' | 'shutter' | 'toggle';

const SOURCES: Record<SoundName, number> = {
  tap: require('../../assets/sounds/tap.wav'),
  confirm: require('../../assets/sounds/confirm.wav'),
  success: require('../../assets/sounds/success.wav'),
  error: require('../../assets/sounds/error.wav'),
  shutter: require('../../assets/sounds/shutter.wav'),
  toggle: require('../../assets/sounds/toggle.wav'),
};

const players: Partial<Record<SoundName, AudioPlayer>> = {};
let prefs = { sounds: true, haptics: true };
let ready = false;

export function setFeedbackPrefs(p: { sounds: boolean; haptics: boolean }): void {
  prefs = { ...p };
}

export function getFeedbackPrefs(): { sounds: boolean; haptics: boolean } {
  return { ...prefs };
}

export async function preloadSounds(): Promise<void> {
  if (ready) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false });
  } catch {
    // Si el modo de audio no se puede fijar, se usan los valores del sistema.
  }
  for (const name of Object.keys(SOURCES) as SoundName[]) {
    try {
      const p = createAudioPlayer(SOURCES[name]);
      p.volume = name === 'tap' || name === 'toggle' ? 0.45 : 0.7;
      players[name] = p;
    } catch {
      // Sin audio disponible: la app sigue funcionando sin sonidos.
    }
  }
  ready = true;
}

export function playSound(name: SoundName): void {
  if (!prefs.sounds) return;
  const p = players[name];
  if (!p) return;
  try {
    void p
      .seekTo(0)
      .then(() => p.play())
      .catch(() => p.play());
  } catch {
    // Nunca interrumpir la acción por un sonido.
  }
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'warning' | 'error' | 'selection'): void {
  if (!prefs.haptics) return;
  const run = () => {
    switch (kind) {
      case 'light':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      case 'medium':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      case 'warning':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      case 'error':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      default:
        return Haptics.selectionAsync();
    }
  };
  run().catch(() => undefined);
}

/** Atajo: sonido + vibración coherentes. */
export function feedback(kind: 'tap' | 'confirm' | 'success' | 'error' | 'shutter' | 'toggle'): void {
  playSound(kind);
  haptic(
    kind === 'success'
      ? 'success'
      : kind === 'error'
        ? 'error'
        : kind === 'confirm' || kind === 'shutter'
          ? 'medium'
          : kind === 'toggle'
            ? 'selection'
            : 'light',
  );
}
