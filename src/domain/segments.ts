// src/domain/segments.ts — Segmentos FIJOS por hilera (plataforma v1.4, ADR-W-010; app ADR 0011). Funciones puras.
//
// QUÉ HACE:
//  - La web define una cantidad fija de segmentos por hilera (10 por defecto, ≈20 m cada uno en una hilera de 200 m)
//    y la envía en el bootstrap (segmentRules.perRow). Los DOS laterales comparten los mismos segmentos.
//  - rowLayout(): ¿la hilera cumple el reparto estándar? (n de N, sin huecos ni solapes) — aviso, nunca bloquea.
//  - segmentPosition()/segmentLabel(): «S3 de 10» en las pantallas del controlador.
//  - nextSegmentStep(): el siguiente segmento en el sentido de la pasada y el MARCADOR DEL LÍMITE que se cruza. Los
//    marcadores de la web están al INICIO de cada segmento (más «Hxx fin»), así que:
//      ASCENDENTE  (planta 1 → N): al cruzar el inicio de S4 se entra a S4  → marcador «S4 inicio», segmento S4.
//      DESCENDENTE (planta N → 1): al cruzar el inicio de S4 se entra a S3  → marcador «S4 inicio», segmento S3.
//    Así el segmento de las fotos siguientes es el correcto también en el LATERAL B (que va de vuelta).
//  - passDirectionFor(): LATERAL A ascendente; LATERAL B en sentido contrario al último A cerrado (coverage.ts).
// No toca SQLite ni la red: se prueba en __tests__/segments.test.ts.

import { segmentsInWalkOrder } from './coverage';
import type { Direction, FieldRow, LateralCode, Marker, Segment } from './types';

/** Cantidad fija por defecto si el servidor todavía no la envía (plataforma < v1.4). */
export const DEFAULT_SEGMENTS_PER_ROW = 10;

export type RowLayoutIssue = 'SIN_SEGMENTOS' | 'EXCEDE_LIMITE' | 'FALTAN_SEGMENTOS' | 'HUECOS' | 'SOLAPES';

export interface RowLayout {
  count: number;
  /** Segmentos esperados: la cantidad fija (o una por planta si la hilera es más corta). */
  expected: number;
  standard: boolean;
  issues: RowLayoutIssue[];
  /** Plantas sin segmento [desde, hasta]. */
  gaps: [number, number][];
}

function byPlant(segments: Segment[]): Segment[] {
  return [...segments].sort((a, b) => a.startPlant - b.startPlant || a.endPlant - b.endPlant || a.code.localeCompare(b.code));
}

export function rowLayout(row: Pick<FieldRow, 'plantCount'>, segments: Segment[], perRow: number): RowLayout {
  const expected = Math.max(1, Math.min(perRow, row.plantCount));
  const sorted = byPlant(segments);
  const gaps: [number, number][] = [];
  const issues: RowLayoutIssue[] = [];
  let next = 1;
  let overlap = false;
  for (const s of sorted) {
    if (s.startPlant > next) gaps.push([next, Math.min(s.startPlant - 1, row.plantCount)]);
    if (s.startPlant < next) overlap = true;
    next = Math.max(next, s.endPlant + 1);
  }
  if (sorted.length && next <= row.plantCount) gaps.push([next, row.plantCount]);
  if (!sorted.length) issues.push('SIN_SEGMENTOS');
  else if (sorted.length > perRow) issues.push('EXCEDE_LIMITE');
  else if (sorted.length < expected) issues.push('FALTAN_SEGMENTOS');
  if (gaps.length && sorted.length) issues.push('HUECOS');
  if (overlap) issues.push('SOLAPES');
  return { count: sorted.length, expected, standard: issues.length === 0, issues, gaps };
}

export interface SegmentPosition {
  /** 1 = el de la planta 1 (siempre en orden de plantas, no del recorrido). */
  index: number;
  count: number;
  expected: number;
}

export function segmentPosition(segments: Segment[], segmentId: string | null, perRow: number): SegmentPosition | null {
  if (!segmentId) return null;
  const sorted = byPlant(segments);
  const i = sorted.findIndex((s) => s.id === segmentId);
  return i < 0 ? null : { index: i + 1, count: sorted.length, expected: Math.max(sorted.length, perRow) };
}

/** «H05 S3 · 3 de 10» (o solo el código si el segmento no está en la lista). */
export function segmentLabel(segment: Segment | null, segments: Segment[], perRow: number): string {
  if (!segment) return '—';
  const p = segmentPosition(segments, segment.id, perRow);
  return p ? `${segment.code} · ${p.index} de ${p.count}` : segment.code;
}

/** Largo aproximado del segmento en metros (null si la hilera no tiene largo). */
export function approxMeters(row: Pick<FieldRow, 'plantCount' | 'lengthM'> | null, segment: Segment): number | null {
  if (!row?.lengthM || !row.plantCount) return null;
  return Math.round((row.lengthM * (segment.endPlant - segment.startPlant + 1)) / row.plantCount);
}

/** Marcador físico entre dos segmentos contiguos (lower antes que upper en plantas). */
export function boundaryMarker(lower: Segment, upper: Segment, markers: Marker[]): Marker | null {
  const atUpperStart = markers.find((m) => m.segmentId === upper.id && (m.position === 'INICIO' || m.position === 'INTERMEDIO'));
  if (atUpperStart) return atUpperStart;
  return markers.find((m) => m.segmentId === lower.id && m.position === 'FIN') ?? null;
}

export interface SegmentStep {
  segment: Segment;
  marker: Marker | null;
  /** Posición del segmento al que se entra (en orden de plantas). */
  position: SegmentPosition | null;
}

/**
 * Siguiente segmento en el sentido de la pasada y el marcador del límite que se cruza. null si ya está en el
 * último segmento del recorrido o la hilera no tiene segmentos. Si el segmento actual no se conoce, propone el
 * primero del recorrido.
 */
export function nextSegmentStep(
  segments: Segment[],
  markers: Marker[],
  currentSegmentId: string | null,
  direction: Direction,
  perRow: number = DEFAULT_SEGMENTS_PER_ROW,
): SegmentStep | null {
  const order = segmentsInWalkOrder(segments, direction);
  if (!order.length) return null;
  const i = order.findIndex((s) => s.id === currentSegmentId);
  if (i === order.length - 1) return null;
  if (i < 0) {
    const first = order[0];
    const wanted = direction === 'ASCENDENTE' ? 'INICIO' : 'FIN';
    const own = markers.filter((m) => m.segmentId === first.id);
    return {
      segment: first,
      marker: own.find((m) => m.position === wanted) ?? own[0] ?? null,
      position: segmentPosition(segments, first.id, perRow),
    };
  }
  const current = order[i];
  const next = order[i + 1];
  const marker =
    direction === 'ASCENDENTE' ? boundaryMarker(current, next, markers) : boundaryMarker(next, current, markers);
  return {
    segment: next,
    marker: marker ?? markers.find((m) => m.segmentId === next.id) ?? null,
    position: segmentPosition(segments, next.id, perRow),
  };
}

/** Sentido de la pasada: A ascendente; B el contrario al último A cerrado (o descendente si no se sabe). */
export function passDirectionFor(lateral: LateralCode, directionB: Direction | null): Direction {
  if (lateral === 'LATERAL_A') return 'ASCENDENTE';
  return directionB ?? 'DESCENDENTE';
}
