// src/device/preferences.ts — Preferencias de interfaz del celular (sonidos y vibración).
//
// QUÉ HACE: guarda en app_meta (ui_sounds, ui_haptics) y aplica al instante en src/ui/feedback.ts.
// Son preferencias del celular (no del usuario) y no viajan al backend.

import { getFeedbackPrefs, setFeedbackPrefs } from '../ui/feedback';
import { setMeta } from '../storage/repositories/appMetaRepo';

export async function setSoundsEnabled(on: boolean): Promise<void> {
  setFeedbackPrefs({ ...getFeedbackPrefs(), sounds: on });
  await setMeta('ui_sounds', on ? '1' : '0');
}

export async function setHapticsEnabled(on: boolean): Promise<void> {
  setFeedbackPrefs({ ...getFeedbackPrefs(), haptics: on });
  await setMeta('ui_haptics', on ? '1' : '0');
}
