// __tests__/segments.test.ts — v0.6.0 (ADR 0011): segmentos fijos por hilera (src/domain/segments.ts).
// Hilera estándar de la plataforma v1.4: 133 plantas (≈200 m), 10 segmentos, marcador al inicio de cada segmento
// («Hxx Sk inicio»: INICIO el primero, INTERMEDIO el resto) y «Hxx fin» (FIN) en el último.

import { startPointOf } from '../src/domain/coverage';
import {
  approxMeters,
  nextSegmentStep,
  passDirectionFor,
  rowLayout,
  segmentLabel,
  segmentPosition,
} from '../src/domain/segments';
import type { Marker, MarkerPosition, Segment } from '../src/domain/types';

/** Reparto estándar como lo hace la web (campo/services.rangos_division). */
function standardRow(plants = 133, parts = 10): { segments: Segment[]; markers: Marker[] } {
  const base = Math.floor(plants / parts);
  const rest = plants % parts;
  const segments: Segment[] = [];
  const markers: Marker[] = [];
  let start = 1;
  for (let i = 1; i <= parts; i++) {
    const len = base + (i <= rest ? 1 : 0);
    const id = `R-S${i}`;
    segments.push({ id, rowId: 'R', code: `H05 S${i}`, startPlant: start, endPlant: start + len - 1, isPilot: false });
    const position: MarkerPosition = i === 1 ? 'INICIO' : 'INTERMEDIO';
    markers.push({ id: `R-M${i}`, rowId: 'R', segmentId: id, code: `H05 S${i} inicio`, description: null, position, lat: null, lon: null });
    start += len;
  }
  markers.push({ id: `R-M${parts + 1}`, rowId: 'R', segmentId: `R-S${parts}`, code: 'H05 fin', description: null, position: 'FIN', lat: null, lon: null });
  // Desordenados a propósito: las funciones no deben depender del orden de llegada.
  return { segments: [...segments].reverse(), markers };
}

describe('reparto estándar de la hilera', () => {
  test('133 plantas en 10 segmentos contiguos: estándar', () => {
    const { segments } = standardRow();
    const l = rowLayout({ plantCount: 133 }, segments, 10);
    expect(l).toEqual({ count: 10, expected: 10, standard: true, issues: [], gaps: [] });
  });

  test('hilera antigua «completa» o con huecos: aviso (no bloquea)', () => {
    const one: Segment[] = [{ id: 'X', rowId: 'R', code: 'H05 completa', startPlant: 1, endPlant: 133, isPilot: false }];
    expect(rowLayout({ plantCount: 133 }, one, 10).issues).toEqual(['FALTAN_SEGMENTOS']);
    const gap: Segment[] = [{ id: 'X', rowId: 'R', code: 'S1', startPlant: 180, endPlant: 204, isPilot: true }];
    const l = rowLayout({ plantCount: 385 }, gap, 10);
    expect(l.issues).toEqual(['FALTAN_SEGMENTOS', 'HUECOS']);
    expect(l.gaps).toEqual([
      [1, 179],
      [205, 385],
    ]);
    expect(rowLayout({ plantCount: 133 }, [], 10).issues).toEqual(['SIN_SEGMENTOS']);
  });

  test('más segmentos que la cantidad fija y solapes', () => {
    const { segments } = standardRow(133, 12);
    expect(rowLayout({ plantCount: 133 }, segments, 10).issues).toEqual(['EXCEDE_LIMITE']);
    const overlap: Segment[] = [
      { id: 'A', rowId: 'R', code: 'A', startPlant: 1, endPlant: 70, isPilot: false },
      { id: 'B', rowId: 'R', code: 'B', startPlant: 60, endPlant: 133, isPilot: false },
    ];
    expect(rowLayout({ plantCount: 133 }, overlap, 2).issues).toEqual(['SOLAPES']);
  });

  test('hilera más corta que la cantidad fija: un segmento por planta es el estándar', () => {
    const { segments } = standardRow(7, 7);
    expect(rowLayout({ plantCount: 7 }, segments, 10).standard).toBe(true);
  });
});

describe('posición y metros del segmento', () => {
  const { segments } = standardRow();
  test('«3 de 10» en orden de plantas', () => {
    expect(segmentPosition(segments, 'R-S3', 10)).toEqual({ index: 3, count: 10, expected: 10 });
    expect(segmentLabel(segments.find((s) => s.id === 'R-S3') ?? null, segments, 10)).toBe('H05 S3 · 3 de 10');
    expect(segmentLabel(null, segments, 10)).toBe('—');
  });

  test('≈20 m por segmento en una hilera de 200 m', () => {
    const s1 = segments.find((s) => s.id === 'R-S1')!; // 14 plantas
    const s10 = segments.find((s) => s.id === 'R-S10')!; // 13 plantas
    expect(approxMeters({ plantCount: 133, lengthM: 200 }, s1)).toBe(21);
    expect(approxMeters({ plantCount: 133, lengthM: 200 }, s10)).toBe(20);
    expect(approxMeters({ plantCount: 133, lengthM: null }, s1)).toBeNull();
  });
});

describe('siguiente segmento en el sentido de la pasada', () => {
  const { segments, markers } = standardRow();

  test('LATERAL A (ascendente): S3 → S4 al cruzar «S4 inicio»', () => {
    const s = nextSegmentStep(segments, markers, 'R-S3', 'ASCENDENTE');
    expect(s?.segment.id).toBe('R-S4');
    expect(s?.marker?.code).toBe('H05 S4 inicio');
    expect(s?.position?.index).toBe(4);
  });

  test('LATERAL B (de vuelta): S4 → S3 al cruzar «S4 inicio» (el segmento de las fotos es S3)', () => {
    const s = nextSegmentStep(segments, markers, 'R-S4', 'DESCENDENTE');
    expect(s?.segment.id).toBe('R-S3');
    expect(s?.marker?.code).toBe('H05 S4 inicio');
  });

  test('último segmento del recorrido: no hay siguiente', () => {
    expect(nextSegmentStep(segments, markers, 'R-S10', 'ASCENDENTE')).toBeNull();
    expect(nextSegmentStep(segments, markers, 'R-S1', 'DESCENDENTE')).toBeNull();
  });

  test('sin segmento actual: propone la entrada del recorrido (fin de la hilera si va de vuelta)', () => {
    const s = nextSegmentStep(segments, markers, null, 'DESCENDENTE');
    expect(s?.segment.id).toBe('R-S10');
    expect(s?.marker?.code).toBe('H05 fin');
    expect(nextSegmentStep([], [], null, 'ASCENDENTE')).toBeNull();
  });

  test('recorrer toda la hilera de vuelta pasa por los 10 segmentos en orden inverso', () => {
    let current: string | null = startPointOf(segments, markers, 'DESCENDENTE').segment?.id ?? null;
    const visited = [current];
    for (let k = 0; k < 20; k++) {
      const s = nextSegmentStep(segments, markers, current, 'DESCENDENTE');
      if (!s) break;
      current = s.segment.id;
      visited.push(current);
    }
    expect(visited).toEqual(['R-S10', 'R-S9', 'R-S8', 'R-S7', 'R-S6', 'R-S5', 'R-S4', 'R-S3', 'R-S2', 'R-S1']);
  });
});

describe('sentido de la pasada', () => {
  test('A siempre ascendente; B contrario al último A cerrado o, si no se sabe, de vuelta', () => {
    expect(passDirectionFor('LATERAL_A', 'DESCENDENTE')).toBe('ASCENDENTE');
    expect(passDirectionFor('LATERAL_B', 'ASCENDENTE')).toBe('ASCENDENTE');
    expect(passDirectionFor('LATERAL_B', null)).toBe('DESCENDENTE');
  });
});
