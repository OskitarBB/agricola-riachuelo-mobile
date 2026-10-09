// src/domain/pests.ts — Alertas de plaga para «Ubicar plaga» (ADR 0009). TypeScript puro, sin Expo ni React.
//
// QUÉ HACE:
//  - Tipos de GET /api/v1/mobile/pest-reports (plataforma v1.3, ADR-W-007): casos con ubicación y capas del fundo.
//  - Qué estados llegan a la app: confirmado por la IA o por el especialista, posible plaga y «en revisión» (la IA
//    sugirió un indicio y el especialista aún no decide). Descartados y evidencia insuficiente NO llegan.
//  - withDistance()/sortReports(): distancia y rumbo desde la posición del celular; orden: primero lo confirmado,
//    después lo más cerca (sin posición: lo más reciente).
//  - Etiquetas de clase legibles (chanchito_blanco → «Chanchito blanco»). La IA «sugiere indicios», no diagnostica.

import { bearingDeg, distanceM, isValidLatLon, type LatLon } from './geo';
import type { ISODateString, UUID } from './types';

export type PestStatus = 'CONFIRMADO_POR_IA' | 'CONFIRMADO_POR_ESPECIALISTA' | 'POSIBLE_PLAGA' | 'PENDIENTE_REVISION';
export const PEST_STATUSES: readonly PestStatus[] = [
  'CONFIRMADO_POR_ESPECIALISTA',
  'CONFIRMADO_POR_IA',
  'POSIBLE_PLAGA',
  'PENDIENTE_REVISION',
];

export interface PestReport {
  caseId: UUID;
  /** Llega como texto: un estado nuevo del servidor se muestra como «En revisión» (contrato: agregar sí, quitar no). */
  status: string;
  statusLabel: string;
  origin: string;
  /** Clase sugerida por la IA o confirmada por el especialista (p. ej. chanchito_blanco); puede faltar. */
  label: string | null;
  maxConfidence: number | null;
  capturedAt: ISODateString;
  decidedAt: ISODateString | null;
  lot: { id: string; code: string; name: string };
  row: { id: string; number: number; plantCount: number };
  lateralCode: string;
  lateralLabel: string;
  segment: { id: string; code: string; startPlant: number; endPlant: number } | null;
  marker: { id: string; code: string } | null;
  lat: number | null;
  lon: number | null;
  gpsAccuracyM: number | null;
  /** GPS (del controlador), MARCADOR (coordenadas del marcador: aproximada) o NINGUNA. */
  locationSource: string;
  observation: string;
  /** URL firmada de la miniatura (vence); sin internet no se ve. */
  thumbnailUrl: string | null;
}

export interface FarmLot {
  id: string;
  code: string;
  name: string;
  color: string;
  /** GeoJSON Polygon en WGS84 ([lon, lat]) o null si aún no se dibujó en la web. */
  geometry: { type: 'Polygon'; coordinates: number[][][] } | null;
}
export interface FarmRow {
  id: string;
  lot: string;
  number: number;
  plants: number;
  /** [lat, lon] del marcador de inicio y de fin, o null. */
  ini: [number, number] | null;
  fin: [number, number] | null;
}
export interface FarmPoint {
  id: number | string;
  name: string;
  kind: string;
  kindLabel: string;
  description: string;
  lat: number;
  lon: number;
}
export interface FarmLayers {
  lots: FarmLot[];
  rows: FarmRow[];
  points: FarmPoint[];
  /** [lat, lon] del centro del fundo. */
  center: [number, number];
}

export interface PestReportsResponse {
  reports: PestReport[];
  farm: FarmLayers;
  days: number;
  serverTime: ISODateString;
}

/** Centro del fundo (14°01'40.1"S 75°41'57.2"W): mismo valor que la web (CENTRO_FUNDO). */
export const FARM_CENTER: [number, number] = [-14.027806, -75.699222];

export function isPestStatus(s: string): s is PestStatus {
  return (PEST_STATUSES as readonly string[]).includes(s);
}

/** Confirmado (por la IA o por el especialista): el encargado debe ir. */
export function isConfirmed(status: string): boolean {
  return status === 'CONFIRMADO_POR_IA' || status === 'CONFIRMADO_POR_ESPECIALISTA';
}

/** Colores del marcador en el mapa: los mismos tonos que la web (estado de revisión, no gravedad; W-12). */
export const PEST_COLOR: Record<PestStatus, string> = {
  CONFIRMADO_POR_ESPECIALISTA: '#d92d20',
  CONFIRMADO_POR_IA: '#c11574',
  POSIBLE_PLAGA: '#ef6820',
  PENDIENTE_REVISION: '#d9a21b',
};

export function pestColor(status: string): string {
  return isPestStatus(status) ? PEST_COLOR[status] : PEST_COLOR.PENDIENTE_REVISION;
}

const LABELS: Record<string, string> = {
  chanchito_blanco: 'Chanchito blanco',
  melaza_fumagina: 'Melaza / fumagina',
};

/** «chanchito_blanco» → «Chanchito blanco»; una clase nueva se muestra legible sin cambiar la app. */
export function labelText(label: string | null | undefined): string | null {
  if (!label) return null;
  const known = LABELS[label];
  if (known) return known;
  const t = label.replace(/[_-]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

export function hasLocation(r: Pick<PestReport, 'lat' | 'lon'>): r is PestReport & { lat: number; lon: number } {
  return isValidLatLon(r.lat, r.lon);
}

export interface PestWithDistance extends PestReport {
  distanceM: number | null;
  bearingDeg: number | null;
}

export function withDistance(reports: readonly PestReport[], me: LatLon | null): PestWithDistance[] {
  return reports.map((r) => {
    if (!me || !hasLocation(r)) return { ...r, distanceM: null, bearingDeg: null };
    const to = { lat: r.lat, lon: r.lon };
    return { ...r, distanceM: distanceM(me, to), bearingDeg: bearingDeg(me, to) };
  });
}

const RANK: Record<PestStatus, number> = {
  CONFIRMADO_POR_ESPECIALISTA: 0,
  CONFIRMADO_POR_IA: 0,
  POSIBLE_PLAGA: 1,
  PENDIENTE_REVISION: 2,
};

/** Primero lo confirmado, luego posible plaga y en revisión; dentro de cada grupo lo más cerca (o lo más reciente). */
export function sortReports(list: readonly PestWithDistance[]): PestWithDistance[] {
  return [...list].sort((a, b) => {
    const ra = isPestStatus(a.status) ? RANK[a.status] : 3;
    const rb = isPestStatus(b.status) ? RANK[b.status] : 3;
    if (ra !== rb) return ra - rb;
    if (a.distanceM !== null && b.distanceM !== null && a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
    if (a.distanceM !== null && b.distanceM === null) return -1;
    if (a.distanceM === null && b.distanceM !== null) return 1;
    return b.capturedAt.localeCompare(a.capturedAt);
  });
}

export type PestFilter = 'TODAS' | 'CONFIRMADAS' | 'POSIBLES';

export function filterReports<T extends PestReport>(list: readonly T[], f: PestFilter): T[] {
  if (f === 'CONFIRMADAS') return list.filter((r) => isConfirmed(r.status));
  if (f === 'POSIBLES') return list.filter((r) => r.status === 'POSIBLE_PLAGA' || r.status === 'PENDIENTE_REVISION');
  return [...list];
}

/** Lugar en palabras: «Lote L1 · Hilera 12 · Lado A · plantas 1–25». */
export function placeText(r: PestReport): string {
  const parts = [`Lote ${r.lot.code}`, `Hilera ${r.row.number}`];
  if (r.lateralLabel) parts.push(r.lateralLabel);
  if (r.segment) parts.push(`plantas ${r.segment.startPlant}–${r.segment.endPlant}`);
  return parts.join(' · ');
}
