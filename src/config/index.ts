// src/config/index.ts — Configuración efectiva de la app (CONFIG) y versiones visibles.
//
// QUÉ HACE: parte de DEFAULT_CONFIG y aplica:
//  1) pairing.requireSameAppVersion = (ENV.appEnv === 'piloto')  → regla RN-17.
//  2) (controlador) el perfil de calidad publicado por el backend en el bootstrap, si existe → applyQualityProfile().
//     El perfil se guarda en app_meta (quality_profile_json) y se vuelve a aplicar al arrancar (src/boot.ts),
//     así las cámaras reciben en PAIRED el mismo perfil aunque se haya reiniciado el controlador sin internet.
// Las cámaras NO usan su propia configuración de captura/calidad durante una sesión: usan la que
// reciben en PAIRED (decisión D-21). Ver src/camera/cameraAgent.ts.

import Constants from 'expo-constants';

import { CONFIG_VERSION, DEFAULT_CONFIG, type AppConfig } from './defaults';
import { apiHostLabel, ENV, isSecureApiUrl } from './env';

export { apiHostLabel, CONFIG_VERSION, ENV, isSecureApiUrl };
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

export interface QualityProfileDto {
  version: string;
  params: Record<string, number>;
}

/**
 * Aplica los parámetros de calidad publicados por el backend (BootstrapResponse.qualityProfile).
 * Siempre parte de los valores por defecto (si el backend deja de publicar un perfil, vuelve a Q0).
 * Solo se aceptan claves conocidas y numéricas; lo demás se ignora (no se inventan parámetros).
 */
export function applyQualityProfile(profile: QualityProfileDto | null): void {
  CONFIG.quality = clone(DEFAULT_CONFIG.quality);
  if (!profile) return;
  const q = CONFIG.quality;
  const e = q.exposure as unknown as Record<string, number>;
  const s = q.sharpness as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(profile.params ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (key in e) e[key] = value;
    else if (key in s && key !== 'regionCount') s[key] = value;
    else if (key === 'timeoutMs') q.timeoutMs = value;
  }
  if (typeof profile.version === 'string' && profile.version.trim()) q.profileVersion = profile.version.trim().slice(0, 20);
}

/** Lee el perfil guardado (JSON de app_meta) y lo aplica. Un JSON dañado se ignora (queda Q0). */
export function applyStoredQualityProfile(json: string | null): void {
  if (!json) return;
  try {
    const parsed = JSON.parse(json) as QualityProfileDto | null;
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'string') applyQualityProfile(parsed);
  } catch {
    applyQualityProfile(null);
  }
}
