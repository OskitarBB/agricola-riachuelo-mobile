// src/device/qualityPipeline.ts — Evaluación de calidad sobre una foto real (maestro §16.2, Anexo B.2).
//
// QUÉ HACE:
//  1) Exposición: copia reducida (analysisWidth px) de TODA la foto → luminancia media y % de píxeles
//     oscuros/saturados. Si falla → REPETIR_EXPOSICION (no se mide la nitidez).
//  2) Nitidez: 1–3 recortes cuadrados a resolución ORIGINAL en la línea media → varianza del Laplaciano;
//     se usa el máximo. Bajo el umbral → REPETIR_NITIDEZ.
//  3) Si todo tarda más de quality.timeoutMs → PENDIENTE_REVISION_TECNICA (la foto se acepta y se revisa).
//  4) Si la foto no se puede leer → ERROR_CAMARA (ARCHIVO_INVALIDO).
// Las copias temporales se borran al terminar. La foto original NUNCA se modifica.

import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageManipulatorContext } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

import type { QualityResult } from '../domain/types';
import {
  decideQuality,
  exposureStats,
  laplacianVariance,
  regionRects,
  toGray,
  type QualityProfile,
  type RawImage,
} from './quality';

export interface QualityPipelineConfig {
  timeoutMs: number;
  exposure: QualityProfile['exposure'] & { analysisWidth: number };
  sharpness: { regionSize: number; regionCount: 1 | 2 | 3; minLaplacianVariance: number };
}

async function decode(uri: string): Promise<RawImage> {
  const file = new File(uri);
  const bytes = await file.bytes();
  const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 64 });
  try {
    file.delete(); // copia temporal en caché
  } catch {
    // Ya no existe: no importa.
  }
  return { width: img.width, height: img.height, data: img.data as Uint8Array, channels: 3 };
}

async function render(ctx: ImageManipulatorContext): Promise<RawImage> {
  const ref = await ctx.renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  try {
    ref.release();
    ctx.release();
  } catch {
    // Liberación de memoria nativa: si falla, el recolector lo hará después.
  }
  return decode(saved.uri);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'TIMEOUT'> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'TIMEOUT'>((resolve) => {
    timer = setTimeout(() => resolve('TIMEOUT'), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** photoUri: foto original ya guardada; width y height: los que devolvió takePictureAsync. */
export async function evaluatePhoto(
  photoUri: string,
  width: number,
  height: number,
  cfg: QualityPipelineConfig,
  profileVersion: string,
): Promise<QualityResult> {
  const started = Date.now();
  const profile: QualityProfile = {
    version: profileVersion,
    exposure: cfg.exposure,
    sharpness: { minLaplacianVariance: cfg.sharpness.minLaplacianVariance },
  };
  const work = async (): Promise<QualityResult> => {
    // 1) Exposición sobre una copia reducida de toda la foto.
    const small = await render(ImageManipulator.manipulate(photoUri).resize({ width: cfg.exposure.analysisWidth }));
    const exp = exposureStats(toGray(small), cfg.exposure.darkLevel, cfg.exposure.brightLevel);
    const exposureFails =
      exp.mean < cfg.exposure.minMean ||
      exp.darkRatio > cfg.exposure.maxDarkRatio ||
      exp.mean > cfg.exposure.maxMean ||
      exp.brightRatio > cfg.exposure.maxBrightRatio;
    if (exposureFails) return decideQuality(exp, null, profile, { analyzedRegions: 0, durationMs: Date.now() - started });
    // 2) Nitidez en recortes a resolución original; se usa el máximo.
    let maxVar = 0;
    const rects = regionRects(width, height, cfg.sharpness.regionSize, cfg.sharpness.regionCount);
    for (const rect of rects) {
      const region = await render(ImageManipulator.manipulate(photoUri).crop(rect));
      maxVar = Math.max(maxVar, laplacianVariance(toGray(region), region.width, region.height));
    }
    return decideQuality(exp, maxVar, profile, { analyzedRegions: rects.length, durationMs: Date.now() - started });
  };
  try {
    const result = await withTimeout(work(), cfg.timeoutMs);
    if (result === 'TIMEOUT') {
      return { status: 'PENDIENTE_REVISION_TECNICA', reasons: ['TIEMPO_AGOTADO'], metrics: null, profileVersion };
    }
    return result;
  } catch {
    return { status: 'ERROR_CAMARA', reasons: ['ARCHIVO_INVALIDO'], metrics: null, profileVersion };
  }
}

/** Configuración de calidad a partir de CaptureContextConfig (PAIRED) o de CONFIG (controlador / modo prueba). */
export function pipelineConfigFrom(q: {
  timeoutMs: number;
  exposure: QualityPipelineConfig['exposure'];
  sharpness: QualityPipelineConfig['sharpness'];
}): QualityPipelineConfig {
  return { timeoutMs: q.timeoutMs, exposure: { ...q.exposure }, sharpness: { ...q.sharpness } };
}
