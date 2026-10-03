// src/device/quality.ts — Métricas y decisión de calidad (funciones puras, perfil Q0). Maestro Anexo B.1.
//
// QUÉ HACE: decide si una foto es TÉCNICAMENTE utilizable (no decide plagas: RN-14).
// Flujo en la app: (1) copia reducida a analysisWidth → jpeg-js → luminanceStats; si la exposición falla,
// termina. (2) recortes a resolución original (regionRects) → jpeg-js → laplacianVariance → se usa el máximo.

import type { QualityMetrics, QualityReason, QualityResult } from '../domain/types';

export interface RawImage {
  width: number;
  height: number;
  /** Píxeles intercalados RGB (3 canales) o RGBA (4 canales), como entrega jpeg-js con useTArray. */
  data: Uint8Array;
  channels: 3 | 4;
}

export interface ExposureStats {
  mean: number;
  darkRatio: number;
  brightRatio: number;
}

export interface QualityProfile {
  version: string;
  exposure: {
    darkLevel: number;
    brightLevel: number;
    minMean: number;
    maxMean: number;
    maxDarkRatio: number;
    maxBrightRatio: number;
  };
  sharpness: { minLaplacianVariance: number };
}

/** Luminancia Rec. 601: Y = 0,299 R + 0,587 G + 0,114 B. */
export function toGray(img: RawImage): Uint8Array {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const c = img.channels;
  const d = img.data;
  for (let i = 0, p = 0; i < n; i++, p += c) {
    out[i] = (299 * d[p] + 587 * d[p + 1] + 114 * d[p + 2] + 500) / 1000;
  }
  return out;
}

export function exposureStats(gray: Uint8Array, darkLevel: number, brightLevel: number): ExposureStats {
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < gray.length; i++) {
    const y = gray[i];
    sum += y;
    if (y <= darkLevel) dark++;
    else if (y >= brightLevel) bright++;
  }
  const n = gray.length || 1;
  return { mean: sum / n, darkRatio: dark / n, brightRatio: bright / n };
}

/** Varianza de la respuesta al Laplaciano de 4 vecinos [0 1 0; 1 −4 1; 0 1 0] sobre píxeles interiores. */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const v = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export interface Rect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** Recortes cuadrados sobre la línea media horizontal (25 %, 50 % y 75 % del ancho), dentro de la imagen. */
export function regionRects(imgWidth: number, imgHeight: number, regionSize: number, count: 1 | 2 | 3): Rect[] {
  const size = Math.max(16, Math.min(regionSize, imgWidth, imgHeight));
  const centers = count === 1 ? [0.5] : count === 2 ? [0.33, 0.67] : [0.25, 0.5, 0.75];
  const originY = Math.round((imgHeight - size) / 2);
  return centers.map((c) => {
    const cx = Math.round(imgWidth * c);
    const originX = Math.min(Math.max(0, cx - Math.floor(size / 2)), imgWidth - size);
    return { originX, originY, width: size, height: size };
  });
}

/** Decide el resultado. La exposición se evalúa primero porque una foto oscura también parece borrosa (sección 16). */
export function decideQuality(
  exposure: ExposureStats,
  laplacianVar: number | null,
  profile: QualityProfile,
  extra: { analyzedRegions: number; durationMs: number },
): QualityResult {
  const e = profile.exposure;
  const reasons: QualityReason[] = [];
  if (exposure.mean < e.minMean || exposure.darkRatio > e.maxDarkRatio) reasons.push('EXPOSICION_OSCURA');
  else if (exposure.mean > e.maxMean || exposure.brightRatio > e.maxBrightRatio) reasons.push('EXPOSICION_SATURADA');
  const metrics: QualityMetrics = {
    luminanceMean: Math.round(exposure.mean * 10) / 10,
    darkRatio: Math.round(exposure.darkRatio * 1000) / 1000,
    brightRatio: Math.round(exposure.brightRatio * 1000) / 1000,
    laplacianVariance: laplacianVar === null ? -1 : Math.round(laplacianVar * 10) / 10,
    analyzedRegions: extra.analyzedRegions,
    durationMs: Math.round(extra.durationMs),
  };
  if (reasons.length > 0) return { status: 'REPETIR_EXPOSICION', reasons, metrics, profileVersion: profile.version };
  if (laplacianVar === null) throw new Error('Falta la nitidez cuando la exposición es correcta');
  if (laplacianVar < profile.sharpness.minLaplacianVariance) {
    return { status: 'REPETIR_NITIDEZ', reasons: ['NITIDEZ_BAJA'], metrics, profileVersion: profile.version };
  }
  return { status: 'UTILIZABLE', reasons: [], metrics, profileVersion: profile.version };
}
