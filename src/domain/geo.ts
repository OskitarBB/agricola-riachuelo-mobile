// src/domain/geo.ts — Cálculos de ubicación para «Ubicar plaga» (ADR 0009). TypeScript puro, sin Expo ni React.
//
// QUÉ HACE:
//  - distanceM(): distancia en metros entre dos puntos WGS84 (fórmula del semiverseno; suficiente para un fundo).
//  - bearingDeg() y cardinal(): rumbo de A hacia B (0° = norte, sentido horario) y su nombre corto (N, NE, E…).
//  - formatDistance(): "35 m", "1,2 km" (coma decimal, Perú).
//  - googleMapsWalkingUrl(): enlace universal de Google Maps con la ruta a pie hasta el punto ("Cómo llegar").
//  - isValidLatLon(): descarta coordenadas nulas, fuera de rango o (0, 0).

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function isValidLatLon(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return !(lat === 0 && lon === 0);
}

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo inicial de A hacia B en grados [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lon - a.lon);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;
export type Cardinal = (typeof CARDINALS)[number];

/** Punto cardinal (8 rumbos, en español: O = oeste). */
export function cardinal(deg: number): Cardinal {
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[i];
}

/** Flecha que apunta al rumbo (para la lista; el mapa muestra la línea). */
export function arrowFor(deg: number): string {
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  if (m < 1_000) return `${Math.max(1, Math.round(m))} m`;
  const km = m / 1_000;
  return `${(km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace('.', ',')} km`;
}

/**
 * Google Maps «Cómo llegar» a pie (URL universal: abre la app de Google Maps si está instalada o el navegador).
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 */
export function googleMapsWalkingUrl(lat: number, lon: number): string {
  const dest = `${lat.toFixed(7)},${lon.toFixed(7)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=walking`;
}

/** Abrir el punto en Google Maps (sin ruta), por si «Cómo llegar» no encuentra camino peatonal. */
export function googleMapsPointUrl(lat: number, lon: number): string {
  const q = `${lat.toFixed(7)},${lon.toFixed(7)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
