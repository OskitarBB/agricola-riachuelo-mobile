// src/domain/pictureSize.ts — Elección de la resolución de captura (maestro Q-15 y riesgo «fotos demasiado grandes»).
//
// QUÉ HACE: de la lista de getAvailablePictureSizesAsync() de expo-camera elige la MAYOR resolución que no supere
// capture.maxMegapixels, prefiriendo 4:3 (formato del sensor: no recorta el campo de visión). Sin esto Android usa la
// resolución máxima del sensor (50–108 MP en muchos celulares nuevos): fotos de 15–30 MB que tardan en llegar al
// controlador por Wi-Fi, superan el límite de Cloudinary Free (10 MB, 25 MP) y saturan la app del controlador.
// Puro (sin Expo): se prueba en __tests__/pictureSize.test.ts.

export interface ParsedSize {
  value: string;
  width: number;
  height: number;
  megapixels: number;
}

/** "4000x3000" → { width: 4000, height: 3000, megapixels: 12 }. Los presets de iOS ("Photo", "High"…) → null. */
export function parsePictureSize(value: string): ParsedSize | null {
  const m = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/.exec(value);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!(a > 0 && b > 0)) return null;
  const width = Math.max(a, b);
  const height = Math.min(a, b);
  return { value, width, height, megapixels: (width * height) / 1_000_000 };
}

/**
 * Mejor tamaño ≤ maxMegapixels con 5 % de tolerancia: los «12 MP» reales son 4032×3024 (12,19 MP) o, en sensores de
 * 50 MP con agrupación de píxeles, 4080×3072 (12,53 MP).
 * Prefiere 4:3; si no hay ninguno 4:3 dentro del límite, el más grande de cualquier forma.
 * Devuelve null si no se puede decidir (lista vacía o solo presets): entonces no se fija `pictureSize`.
 */
export function choosePictureSize(available: readonly string[], maxMegapixels: number): string | null {
  const limit = maxMegapixels * 1.05;
  const sizes = available.map(parsePictureSize).filter((s): s is ParsedSize => s !== null && s.megapixels <= limit);
  if (sizes.length === 0) return null;
  const is43 = (s: ParsedSize) => Math.abs(s.width / s.height - 4 / 3) < 0.02;
  const pool = sizes.some(is43) ? sizes.filter(is43) : sizes;
  pool.sort((x, y) => y.megapixels - x.megapixels);
  return pool[0].value;
}
