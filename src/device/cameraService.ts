// src/device/cameraService.ts — Toma de fotos con la cámara física (RF-29, RF-30, RF-32).
//
// QUÉ HACE: la pantalla que muestra <CameraView> (PANT-31 o PANT-32) registra su referencia aquí.
// takeToFile() dispara takePictureAsync({ quality, exif: false, shutterSound }), MUEVE la foto de la caché
// a su destino definitivo (el nombre es el captureId), y devuelve md5, tamaño y dimensiones (maestro §14.7).
// Así el agente de cámara (src/camera/cameraAgent.ts) puede capturar sin conocer la pantalla.

import type { CameraView } from 'expo-camera';
import type { File } from 'expo-file-system';

import { nowIso } from '../domain/time';
import { fileFacts, moveFile } from '../storage/files';

let cameraRef: CameraView | null = null;
let cameraReady = false;
const readyListeners = new Set<(ready: boolean) => void>();

export function registerCamera(ref: CameraView | null): void {
  cameraRef = ref;
  if (!ref) setCameraReady(false);
}

export function setCameraReady(ready: boolean): void {
  cameraReady = ready && cameraRef !== null;
  readyListeners.forEach((l) => l(cameraReady));
}

export function isCameraReady(): boolean {
  return cameraReady && cameraRef !== null;
}

export function onCameraReady(l: (ready: boolean) => void): () => void {
  readyListeners.add(l);
  return () => readyListeners.delete(l);
}

export interface TakenPhoto {
  uri: string;
  width: number;
  height: number;
  sizeBytes: number;
  md5: string;
  capturedAt: string;
  durationMs: number;
}

/** Toma una foto y la guarda en `destination` (la foto original nunca se recomprime). */
export async function takeToFile(destination: File, opts: { jpegQuality: number; shutterSound: boolean }): Promise<TakenPhoto> {
  if (!cameraRef || !cameraReady) throw new Error('Cámara no disponible');
  const started = Date.now();
  const capturedAt = nowIso();
  const pic = await cameraRef.takePictureAsync({ quality: opts.jpegQuality, exif: false, shutterSound: opts.shutterSound });
  const moved = moveFile(pic.uri, destination);
  const facts = fileFacts(moved.uri);
  return {
    uri: moved.uri,
    width: pic.width,
    height: pic.height,
    sizeBytes: facts.sizeBytes,
    md5: facts.md5,
    capturedAt,
    durationMs: Date.now() - started,
  };
}
