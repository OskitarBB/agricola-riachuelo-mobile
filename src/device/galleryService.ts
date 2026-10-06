// src/device/galleryService.ts — Fotos guardadas en el celular (galería, pedido del equipo).
//
// QUÉ HACE: lista las fotos del almacenamiento privado (sesión, prueba corta y modo prueba) y arma la ficha
// de cada una (calidad, métricas, rol, estado de transferencia) desde SQLite o desde el archivo .json que
// acompaña a las fotos de prueba. Permite compartir una foto y borrar SOLO las fotos de prueba (no son
// evidencia: RN-09/RN-21 protegen las demás).
// La ficha incluye remote_sync_status en el controlador (SINCRONIZADO = la plataforma Django la confirmó y está en
// Cloudinary). La app nunca descarga fotos ni resultados de la IA desde la nube (§28.10).

import * as Sharing from 'expo-sharing';

import type { CameraRole, LocalTransferStatus, QualityMetrics, QualityStatus, RemoteSyncStatus } from '../domain/types';
import { deleteAllTestPhotos, listStoredPhotos, readTestSidecar, type PhotoKind, type StoredPhoto } from '../storage/files';
import { getCaptureByFile, getQualityResult } from '../storage/repositories/captureRepo';

export type { StoredPhoto, PhotoKind };

export interface TestPhotoSidecar {
  takenAt: string;
  width: number;
  height: number;
  quality: QualityStatus;
  reasons: string[];
  metrics: QualityMetrics | null;
  auto: boolean;
}

export interface PhotoDetails {
  quality: QualityStatus | null;
  metrics: QualityMetrics | null;
  role: CameraRole | null;
  transfer: LocalTransferStatus | null;
  /** Solo en el controlador: estado respecto de la plataforma (null en cámaras y fotos de prueba). */
  cloud: RemoteSyncStatus | null;
  capturedAt: string | null;
  auto: boolean | null;
}

export function listPhotos(): StoredPhoto[] {
  return listStoredPhotos();
}

export async function photoDetails(p: StoredPhoto): Promise<PhotoDetails> {
  if (p.kind === 'TEST') {
    const s = readTestSidecar<TestPhotoSidecar>(p.uri);
    return {
      quality: s?.quality ?? null,
      metrics: s?.metrics ?? null,
      role: null,
      transfer: null,
      cloud: null,
      capturedAt: s?.takenAt ?? null,
      auto: s?.auto ?? null,
    };
  }
  const c = await getCaptureByFile(p.uri);
  if (!c) return { quality: null, metrics: null, role: null, transfer: null, cloud: null, capturedAt: null, auto: null };
  const q = await getQualityResult(c.captureId);
  return {
    quality: c.qualityStatus,
    metrics: q?.metrics ?? null,
    role: c.cameraRole,
    transfer: c.localTransferStatus,
    cloud: c.isTest ? null : c.remoteSyncStatus,
    capturedAt: c.capturedAt,
    auto: null,
  };
}

export async function sharePhoto(uri: string): Promise<void> {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/jpeg' });
}

export function deleteTestPhotos(): number {
  return deleteAllTestPhotos();
}
