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
/**
 * Instancia de <CameraView> que avisó onCameraReady. Se guarda la INSTANCIA (no un booleano) porque React vuelve a
 * llamar al ref con null y luego con el mismo componente cada vez que la pantalla se redibuja (ref en línea): con un
 * booleano, el primer redibujo dejaba la cámara «no lista» para siempre y cada orden respondía ERROR_CAMARA al
 * instante (prueba corta reprobada en 0,0 s). onCameraReady solo se dispara una vez por montaje.
 */
let readyInstance: CameraView | null = null;
const readyListeners = new Set<(ready: boolean) => void>();

function notify(): void {
  const ready = isCameraReady();
  readyListeners.forEach((l) => l(ready));
}

export function registerCamera(ref: CameraView | null): void {
  if (ref === cameraRef) return;
  cameraRef = ref;
  notify();
}

export function setCameraReady(ready: boolean): void {
  readyInstance = ready ? cameraRef : null;
  notify();
}

export function isCameraReady(): boolean {
  return cameraRef !== null && readyInstance === cameraRef;
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
  if (!cameraRef || !isCameraReady()) throw new Error('Cámara no disponible');
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
