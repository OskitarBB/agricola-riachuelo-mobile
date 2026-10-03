// src/camera/testModeService.ts — Modo prueba de cámara en un solo celular (PANT-32; RF-32, RF-33).
//
// QUÉ HACE: toma una foto real, la guarda en test/{fecha}/{uuid}.jpg, evalúa la CALIDAD con el perfil
// vigente (CONFIG.quality) y guarda una ficha .json al lado (calidad, métricas, si fue automática).
// NO crea datos de sesión (no toca captures ni la cola de transferencia): las fotos de prueba no son evidencia
// y se pueden borrar desde la galería.

import { CONFIG } from '../config';
import { newId } from '../domain/ids';
import type { QualityResult } from '../domain/types';
import { takeToFile } from '../device/cameraService';
import { evaluatePhoto, pipelineConfigFrom } from '../device/qualityPipeline';
import type { TestPhotoSidecar } from '../device/galleryService';
import { logEvent } from '../diagnostics/eventLog';
import { dateKey, testPhotoPath, writeJson } from '../storage/files';
import { File } from 'expo-file-system';

export interface TestShot {
  uri: string;
  quality: QualityResult;
  captureMs: number;
  totalMs: number;
  width: number;
  height: number;
}

export async function takeTestPhoto(auto: boolean): Promise<TestShot> {
  const started = Date.now();
  const id = newId();
  const dest = testPhotoPath(dateKey(), id);
  const photo = await takeToFile(dest, { jpegQuality: CONFIG.capture.jpegQuality, shutterSound: CONFIG.capture.shutterSound });
  const quality = await evaluatePhoto(
    photo.uri,
    photo.width,
    photo.height,
    pipelineConfigFrom(CONFIG.quality),
    CONFIG.quality.profileVersion,
  );
  const sidecar: TestPhotoSidecar = {
    takenAt: photo.capturedAt,
    width: photo.width,
    height: photo.height,
    quality: quality.status,
    reasons: quality.reasons,
    metrics: quality.metrics,
    auto,
  };
  writeJson(new File(dest.uri.replace(/\.jpg$/i, '.json')), sidecar);
  const totalMs = Date.now() - started;
  logEvent('INFO', 'CAPTURE', 'TEST_PHOTO', { q: quality.status, ms: quality.metrics?.durationMs ?? null, auto });
  return { uri: photo.uri, quality, captureMs: photo.durationMs, totalMs, width: photo.width, height: photo.height };
}
