/** @jest-environment node */
// __tests__/quality.test.ts — Calidad técnica perfil Q0 (maestro Anexo B.1) sobre las 3 fotos de muestra de
// assets/sample/ (las mismas que usan las cámaras virtuales del simulador en Expo Go).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import jpeg from 'jpeg-js';

import { DEFAULT_CONFIG } from '../src/config/defaults';
import { decideQuality, exposureStats, laplacianVariance, type RawImage, regionRects, toGray } from '../src/device/quality';

const Q = DEFAULT_CONFIG.quality;
const profile = { version: Q.profileVersion, exposure: Q.exposure, sharpness: Q.sharpness };

function evaluate(name: string) {
  const d = jpeg.decode(readFileSync(join(__dirname, '..', 'assets', 'sample', name)), { useTArray: true });
  const img: RawImage = { width: d.width, height: d.height, data: d.data, channels: 4 };
  const gray = toGray(img);
  const exp = exposureStats(gray, Q.exposure.darkLevel, Q.exposure.brightLevel);
  // Nitidez: máximo de la varianza del Laplaciano en los recortes de la línea media.
  let best = 0;
  for (const r of regionRects(img.width, img.height, Q.sharpness.regionSize, Q.sharpness.regionCount)) {
    const crop = new Uint8Array(r.width * r.height);
    for (let y = 0; y < r.height; y++)
      crop.set(
        gray.subarray((r.originY + y) * img.width + r.originX, (r.originY + y) * img.width + r.originX + r.width),
        y * r.width,
      );
    best = Math.max(best, laplacianVariance(crop, r.width, r.height));
  }
  return decideQuality(exp, best, profile, { analyzedRegions: Q.sharpness.regionCount, durationMs: 0 });
}

test('funciones puras básicas', () => {
  expect(laplacianVariance(new Uint8Array(100).fill(128), 10, 10)).toBe(0);
  const rects = regionRects(4000, 3000, 512, 3);
  expect(rects).toHaveLength(3);
  for (const r of rects) expect(r.originX + r.width).toBeLessThanOrEqual(4000);
  expect(exposureStats(new Uint8Array([0, 255, 128, 128]), 20, 235)).toEqual({
    mean: 127.75,
    darkRatio: 0.25,
    brightRatio: 0.25,
  });
});

test('muestra útil → UTILIZABLE', () => {
  expect(evaluate('muestra_util.jpg').status).toBe('UTILIZABLE');
});

test('muestra oscura → REPETIR_EXPOSICION', () => {
  const r = evaluate('muestra_oscura.jpg');
  expect(r.status).toBe('REPETIR_EXPOSICION');
  expect(r.reasons).toContain('EXPOSICION_OSCURA');
});

test('muestra borrosa → REPETIR_NITIDEZ', () => {
  expect(evaluate('muestra_borrosa.jpg').status).toBe('REPETIR_NITIDEZ');
});
