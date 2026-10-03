// src/config/index.ts — Configuración efectiva de la app (CONFIG) y versiones visibles.
//
// QUÉ HACE: parte de DEFAULT_CONFIG y aplica:
//  1) pairing.requireSameAppVersion = (ENV.appEnv === 'piloto')  → regla RN-17.
//  2) (controlador) el perfil de calidad publicado por el backend en el bootstrap, si existe → applyQualityProfile().
// Las cámaras NO usan su propia configuración de captura/calidad durante una sesión: usan la que
// reciben en PAIRED (decisión D-21). Ver src/camera/cameraAgent.ts.

import Constants from 'expo-constants';

import { CONFIG_VERSION, DEFAULT_CONFIG, type AppConfig } from './defaults';
import { ENV } from './env';

export { CONFIG_VERSION, ENV };
export type { AppConfig };

/** Copia profunda simple (solo datos JSON). */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const CONFIG: AppConfig = (() => {
  const cfg = clone(DEFAULT_CONFIG);
  cfg.pairing.requireSameAppVersion = ENV.appEnv === 'piloto';
  return cfg;
})();

/** Versión de la app según app.json (expo.version). */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

/** Versión del protocolo local (sección 14). */
export const PROTOCOL_VERSION_LABEL = `v${CONFIG.protocol.version}`;

/**
 * Aplica los parámetros de calidad publicados por el backend (BootstrapResponse.qualityProfile).
 * Solo se aceptan claves conocidas y numéricas; lo demás se ignora (no se inventan parámetros).
 * INTEGRACIÓN FUTURA: se llama desde src/api/bootstrapApi.ts cuando el backend real publique el perfil (Q-11).
 */
export function applyQualityProfile(profile: { version: string; params: Record<string, number> } | null): void {
  if (!profile) return;
  const q = CONFIG.quality;
  const e = q.exposure as unknown as Record<string, number>;
  const s = q.sharpness as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(profile.params)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (key in e) e[key] = value;
    else if (key in s && key !== 'regionCount') s[key] = value;
    else if (key === 'timeoutMs') q.timeoutMs = value;
  }
  q.profileVersion = profile.version;
}
