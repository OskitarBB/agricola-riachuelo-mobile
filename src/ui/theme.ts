// src/ui/theme.ts — Tema visual (colores, tipografía, espacios, sombras).
//
// Paleta inspirada en el logo de Agrícola Riachuelo (verde hoja, verde profundo, dorado del marco, azul del río).
// Reglas de campo (R-15, RNF-09): contraste alto, textos ≥ 16 pt, botones ≥ 48 dp, y todo estado con
// TEXTO además de color (nunca solo color).

import { Platform } from 'react-native';

import type { CameraLinkStatus, QualityStatus, RemoteSyncStatus, SlotOutcome } from '../domain/types';

export const colors = {
  brandDeep: '#0E3B24',
  brand: '#1F6B3A',
  brandLight: '#7CB518',
  leaf: '#8DC63F',
  gold: '#D9A21B',
  goldLight: '#F3D27A',
  river: '#2F80ED',
  bg: '#F3F6F1',
  card: '#FFFFFF',
  cardAlt: '#EEF3EA',
  text: '#10221A',
  textMuted: '#5B6B61',
  textOnDark: '#FFFFFF',
  border: '#D7E0D3',
  ok: '#1E9E4A',
  okBg: '#E3F5E9',
  warn: '#C98A00',
  warnBg: '#FFF4D6',
  error: '#C73A3A',
  errorBg: '#FDE7E7',
  info: '#2F6FD6',
  infoBg: '#E5EEFC',
  neutral: '#6B7A70',
  neutralBg: '#ECEFEC',
  overlay: 'rgba(8, 24, 16, 0.55)',
  disabledBg: '#FFFFFF',
  disabledText: '#A7B2AB',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const font = {
  /** Tamaño mínimo de texto en campo: 16 (R-15). */
  body: 16,
  small: 16,
  label: 15,
  title: 24,
  hero: 30,
  big: 20,
  weightBold: '800' as const,
  weightSemi: '700' as const,
  weightMedium: '600' as const,
};

export const shadow = Platform.select({
  ios: { shadowColor: '#0B2416', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  default: { elevation: 4 },
});

export const touch = { minHeight: 56 } as const;

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';

export function toneColors(tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case 'ok':
      return { fg: colors.ok, bg: colors.okBg };
    case 'warn':
      return { fg: colors.warn, bg: colors.warnBg };
    case 'error':
      return { fg: colors.error, bg: colors.errorBg };
    case 'info':
      return { fg: colors.info, bg: colors.infoBg };
    default:
      return { fg: colors.neutral, bg: colors.neutralBg };
  }
}

export function linkTone(link: CameraLinkStatus): Tone {
  if (link === 'CONECTADA') return 'ok';
  if (link === 'INESTABLE' || link === 'EMPAREJANDO') return 'warn';
  if (link === 'PERDIDA') return 'error';
  return 'neutral';
}

export function qualityTone(q: QualityStatus | null): Tone {
  if (!q) return 'neutral';
  if (q === 'UTILIZABLE') return 'ok';
  if (q === 'PENDIENTE_REVISION_TECNICA' || q === 'CAPTURED') return 'info';
  if (q === 'ERROR_CAMARA') return 'error';
  return 'warn';
}

/** Estado de una foto respecto de la plataforma (galería del controlador). */
export function cloudTone(s: RemoteSyncStatus | null): Tone {
  if (s === 'SINCRONIZADO') return 'ok';
  if (s === 'ERROR_SINCRONIZACION') return 'error';
  if (s === 'SUBIENDO') return 'info';
  return 'neutral';
}

export function slotTone(o: SlotOutcome | null): Tone {
  if (!o) return 'neutral';
  if (o === 'OK_RECIBIDA') return 'ok';
  if (o === 'OK_PENDIENTE_ARCHIVO' || o === 'PENDIENTE') return 'info';
  if (o === 'RECHAZADA_CALIDAD') return 'warn';
  return 'error';
}
