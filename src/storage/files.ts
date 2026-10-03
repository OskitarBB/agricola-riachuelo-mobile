// src/storage/files.ts — Rutas y operaciones de archivos de fotos (maestro §12.4).
//
// QUÉ HACE:
//  - Define dónde vive cada tipo de foto dentro del almacenamiento PRIVADO de la app (Paths.document):
//      captures/{sessionId}/{passId}/{captureId}.jpg   fotos de evidencia (cámara: original; controlador: copia recibida)
//      short-test/{sessionId}/{captureId}.jpg          fotos de la prueba corta (se borran al cerrar, RN-21)
//      test/{fecha}/{uuid}.jpg (+ .json)               fotos del modo prueba de cámara (PANT-32)
//      incoming/{captureId}.part                       recepción en curso en el controlador
//      diagnostics/diagnostico_{deviceId}_{fecha}.json exportaciones de diagnóstico
//  - Mueve la foto de takePictureAsync (caché) a su destino, calcula md5 y tamaño (file.md5 / file.size).
//  - Lista las fotos para la galería.
// REGLAS: el nombre del archivo es el captureId (nunca la hora); la foto original nunca se recomprime.

import { Directory, File, Paths } from 'expo-file-system';

export type PhotoKind = 'SESSION' | 'SHORT_TEST' | 'TEST';

function dir(...parts: string[]): Directory {
  const d = new Directory(Paths.document, ...parts);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

/** Crea (si no existe) un subdirectorio de Paths.document y lo devuelve. */
export function ensureDir(...parts: string[]): Directory {
  return dir(...parts);
}

export function capturePath(sessionId: string, passId: string, captureId: string): File {
  return new File(dir('captures', sessionId, passId), `${captureId}.jpg`);
}

export function shortTestPath(sessionId: string, captureId: string): File {
  return new File(dir('short-test', sessionId), `${captureId}.jpg`);
}

export function testPhotoPath(dateKey: string, id: string): File {
  return new File(dir('test', dateKey), `${id}.jpg`);
}

export function incomingPath(captureId: string): File {
  return new File(dir('incoming'), `${captureId}.part`);
}

export function diagnosticsPath(deviceId: string, dateKey: string): File {
  return new File(dir('diagnostics'), `diagnostico_${deviceId}_${dateKey}.json`);
}

/** Directorio temporal de calidad (copias reducidas y recortes; se borran al terminar). */
export function qualityCacheDir(): Directory {
  const d = new Directory(Paths.cache, 'quality');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export interface FileFacts {
  uri: string;
  sizeBytes: number;
  md5: string;
}

/** Mueve un archivo (p. ej. la foto en caché de takePictureAsync) a su destino definitivo. */
export function moveFile(sourceUri: string, destination: File): File {
  const src = new File(sourceUri);
  if (destination.exists) destination.delete();
  src.moveSync(destination);
  return destination;
}

/** Copia un archivo (simulador: foto de muestra → directorio de la cámara virtual). */
export function copyFile(sourceUri: string, destination: File): File {
  const src = new File(sourceUri);
  if (destination.exists) destination.delete();
  src.copySync(destination);
  return destination;
}

/** md5 y tamaño del archivo (viajan con la foto y se verifican al recibirla). */
export function fileFacts(uri: string): FileFacts {
  const f = new File(uri);
  const md5 = f.md5;
  if (!f.exists || !md5) throw new Error('Archivo no disponible');
  return { uri: f.uri, sizeBytes: f.size, md5 };
}

export function fileExists(uri: string | null): boolean {
  if (!uri) return false;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function deleteFileIfExists(uri: string | null): boolean {
  if (!uri) return false;
  try {
    const f = new File(uri);
    if (f.exists) {
      f.delete();
      return true;
    }
  } catch {
    // Archivo ya liberado.
  }
  return false;
}

export function deleteDirIfExists(...parts: string[]): void {
  try {
    const d = new Directory(Paths.document, ...parts);
    if (d.exists) d.delete();
  } catch {
    // Nada que borrar.
  }
}

/** Espacio libre del celular en bytes (Paths.availableDiskSpace). */
export function freeSpaceBytes(): number | null {
  try {
    const v = Paths.availableDiskSpace;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeJson(file: File, data: unknown): void {
  if (!file.exists) file.create({ intermediates: true });
  file.write(JSON.stringify(data, null, 2));
}

export function readJson<T>(file: File): T | null {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as T) : null;
  } catch {
    return null;
  }
}

/** Clave de fecha local AAAA-MM-DD para carpetas de prueba y diagnósticos. */
export function dateKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface StoredPhoto {
  uri: string;
  name: string; // captureId o uuid
  kind: PhotoKind;
  folder: string; // sesión o fecha
  modifiedAt: number;
  sizeBytes: number;
}

function walk(d: Directory, kind: PhotoKind, folder: string, out: StoredPhoto[]): void {
  for (const item of d.list()) {
    if (item instanceof Directory) {
      walk(item, kind, folder || item.name, out);
    } else if (item.name.toLowerCase().endsWith('.jpg')) {
      out.push({
        uri: item.uri,
        name: item.name.replace(/\.jpg$/i, ''),
        kind,
        folder,
        modifiedAt: item.modificationTime ?? 0,
        sizeBytes: item.size ?? 0,
      });
    }
  }
}

/** Lista todas las fotos guardadas en el celular (galería), de la más reciente a la más antigua. */
export function listStoredPhotos(): StoredPhoto[] {
  const out: StoredPhoto[] = [];
  const roots: [string, PhotoKind][] = [
    ['captures', 'SESSION'],
    ['short-test', 'SHORT_TEST'],
    ['test', 'TEST'],
  ];
  for (const [name, kind] of roots) {
    const d = new Directory(Paths.document, name);
    if (d.exists) walk(d, kind, '', out);
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Lee la ficha .json que acompaña a una foto de prueba (calidad y métricas). */
export function readTestSidecar<T>(photoUri: string): T | null {
  return readJson<T>(new File(photoUri.replace(/\.jpg$/i, '.json')));
}

/** Borra todas las fotos de prueba (PANT-32 "se pueden borrar"; no son evidencia). */
export function deleteAllTestPhotos(): number {
  const d = new Directory(Paths.document, 'test');
  if (!d.exists) return 0;
  const photos: StoredPhoto[] = [];
  walk(d, 'TEST', '', photos);
  d.delete();
  return photos.length;
}
