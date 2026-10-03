// __tests__/coverage.test.ts — CFG-3: bloqueo por ciclo, lateral B desde el final, plan de la sesión y
// áreas no hechas con motivo (src/domain/coverage.ts).

import {
  canStartNewCycle,
  formatRanges,
  lotCoverage,
  oppositeDirection,
  pendingAreasOfSession,
  requiredDirectionForB,
  rowCoverage,
  startPointOf,
  validateAreaReasons,
  validateLotInPlan,
  validatePlannedLots,
} from '../src/domain/coverage';
import { validatePassDirection } from '../src/domain/rules';
import type { Direction, LateralCode, Marker, PassStatus, Segment } from '../src/domain/types';

const pass = (
  lateralCode: LateralCode,
  status: PassStatus,
  direction: Direction = 'ASCENDENTE',
  endedAt = '2026-10-01T10:00:00Z',
) => ({
  lateralCode,
  status,
  direction,
  endedAt,
});

describe('cobertura de hilera dentro del ciclo', () => {
  test('sin pasadas: pendiente, A sugerido', () => {
    const c = rowCoverage('R1', []);
    expect(c.state).toBe('PENDIENTE');
    expect(c.available).toEqual(['LATERAL_A', 'LATERAL_B']);
    expect(c.suggested).toBe('LATERAL_A');
    expect(c.directionB).toBeNull();
  });

  test('A completo: solo B disponible y en dirección opuesta', () => {
    const c = rowCoverage('R1', [pass('LATERAL_A', 'COMPLETED', 'ASCENDENTE')]);
    expect(c.state).toBe('FALTA_LATERAL_B');
    expect(c.available).toEqual(['LATERAL_B']);
    expect(c.suggested).toBe('LATERAL_B');
    expect(c.directionB).toBe('DESCENDENTE');
  });

  test('ambos laterales completos: hilera bloqueada', () => {
    const c = rowCoverage('R1', [pass('LATERAL_A', 'COMPLETED'), pass('LATERAL_B', 'COMPLETED', 'DESCENDENTE')]);
    expect(c.state).toBe('COMPLETA');
    expect(c.available).toEqual([]);
    expect(c.suggested).toBeNull();
  });

  test('un lateral INCOMPLETO no bloquea (se puede repetir)', () => {
    const c = rowCoverage('R1', [pass('LATERAL_A', 'INCOMPLETE'), pass('LATERAL_B', 'COMPLETED', 'DESCENDENTE')]);
    expect(c.state).toBe('FALTA_LATERAL_A');
    expect(c.available).toEqual(['LATERAL_A']);
  });

  test('la dirección de B sale del último A cerrado (prefiere COMPLETED)', () => {
    expect(
      requiredDirectionForB([
        pass('LATERAL_A', 'INCOMPLETE', 'DESCENDENTE', '2026-10-02T08:00:00Z'),
        pass('LATERAL_A', 'COMPLETED', 'ASCENDENTE', '2026-10-01T08:00:00Z'),
      ]),
    ).toBe('DESCENDENTE');
    expect(oppositeDirection('DESCENDENTE')).toBe('ASCENDENTE');
    expect(validatePassDirection('LATERAL_B', 'ASCENDENTE', 'DESCENDENTE')).toEqual({ ok: false, code: 'DIRECCION_LATERAL_B' });
    expect(validatePassDirection('LATERAL_B', 'DESCENDENTE', 'DESCENDENTE')).toEqual({ ok: true });
    expect(validatePassDirection('LATERAL_A', 'DESCENDENTE', null)).toEqual({ ok: true });
  });

  test('lote completo solo si todas sus hileras activas están completas', () => {
    const done = rowCoverage('R1', [pass('LATERAL_A', 'COMPLETED'), pass('LATERAL_B', 'COMPLETED')]);
    const half = rowCoverage('R2', [pass('LATERAL_A', 'COMPLETED')]);
    const rows = [
      { id: 'R1', active: true },
      { id: 'R2', active: true },
      { id: 'R3', active: false },
    ];
    expect(
      lotCoverage(
        'L1',
        rows,
        new Map([
          ['R1', done],
          ['R2', half],
        ]),
      ),
    ).toEqual({
      lotId: 'L1',
      totalRows: 2,
      completeRows: 1,
      complete: false,
    });
    expect(lotCoverage('L1', rows.slice(0, 1), new Map([['R1', done]])).complete).toBe(true);
  });
});

describe('punto de partida según la dirección (lateral B desde el final)', () => {
  const seg = (id: string, start: number): Segment => ({
    id,
    rowId: 'R1',
    code: id,
    startPlant: start,
    endPlant: start + 24,
    isPilot: false,
  });
  const mk = (segmentId: string, position: 'INICIO' | 'FIN'): Marker => ({
    id: `${segmentId}-${position}`,
    rowId: 'R1',
    segmentId,
    code: `${segmentId}-${position}`,
    description: null,
    position,
    lat: null,
    lon: null,
  });
  const segments = [seg('S2', 180), seg('S1', 1), seg('S3', 359)];
  const markers = segments.flatMap((s) => [mk(s.id, 'INICIO'), mk(s.id, 'FIN')]);

  test('ascendente: primer segmento, marcador de INICIO', () => {
    const p = startPointOf(segments, markers, 'ASCENDENTE');
    expect(p.segment?.id).toBe('S1');
    expect(p.marker?.id).toBe('S1-INICIO');
  });

  test('descendente: último segmento, marcador de FIN', () => {
    const p = startPointOf(segments, markers, 'DESCENDENTE');
    expect(p.segment?.id).toBe('S3');
    expect(p.marker?.id).toBe('S3-FIN');
  });
});

describe('plan de la sesión, ciclos y áreas no hechas', () => {
  test('lotes planificados', () => {
    expect(validatePlannedLots([], new Set())).toEqual({ ok: false, code: 'PLAN_LOTE_REQUERIDO' });
    expect(validatePlannedLots(['L1'], new Set(['L1']))).toEqual({ ok: false, code: 'LOTE_COMPLETO' });
    expect(validatePlannedLots(['L1', 'L2'], new Set(['L3']))).toEqual({ ok: true });
    expect(validateLotInPlan('L9', ['L1'])).toEqual({ ok: false, code: 'LOTE_NO_PLANIFICADO' });
  });

  test('nuevo ciclo: solo administrador y sin sesión abierta', () => {
    expect(canStartNewCycle(['OPERADOR_CAMPO'], false)).toEqual({ ok: false, code: 'CICLO_SOLO_ADMIN' });
    expect(canStartNewCycle(['ADMINISTRADOR'], true)).toEqual({ ok: false, code: 'SESION_ABIERTA_IMPIDE_CICLO' });
    expect(canStartNewCycle(['ADMINISTRADOR'], false)).toEqual({ ok: true });
  });

  const rows = (lot: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${lot}-H${i + 1}`, number: i + 1, active: true }));

  test('detecta lote sin trabajar, laterales faltantes y hileras sin iniciar', () => {
    const rowsByLot = new Map([
      ['L1', rows('L1', 5)],
      ['L2', rows('L2', 3)],
      ['L3', rows('L3', 1)],
    ]);
    const cyclePassesByRow = new Map([
      // L1: H1 completa hoy, H2 solo A hoy, H3 completa en una sesión ANTERIOR del ciclo.
      ['L1-H1', [pass('LATERAL_A', 'COMPLETED'), pass('LATERAL_B', 'COMPLETED')]],
      ['L1-H2', [pass('LATERAL_A', 'COMPLETED')]],
      ['L1-H3', [pass('LATERAL_A', 'COMPLETED'), pass('LATERAL_B', 'COMPLETED')]],
      // L3 ya estaba completo en el ciclo.
      ['L3-H1', [pass('LATERAL_A', 'COMPLETED'), pass('LATERAL_B', 'COMPLETED')]],
    ]);
    const sessionPasses = [
      { lotId: 'L1', rowId: 'L1-H1' },
      { lotId: 'L1', rowId: 'L1-H1' },
      { lotId: 'L1', rowId: 'L1-H2' },
    ];
    const areas = pendingAreasOfSession({ plannedLotIds: ['L1', 'L2', 'L3'], rowsByLot, cyclePassesByRow, sessionPasses });
    expect(areas).toEqual([
      { key: 'LATERAL:L1-H2:LATERAL_B', kind: 'LATERAL', lotId: 'L1', rowIds: ['L1-H2'], lateral: 'LATERAL_B' },
      { key: 'HILERA:L1', kind: 'HILERA', lotId: 'L1', rowIds: ['L1-H4', 'L1-H5'], lateral: null },
      { key: 'LOTE:L2', kind: 'LOTE', lotId: 'L2', rowIds: ['L2-H1', 'L2-H2', 'L2-H3'], lateral: null },
    ]);

    expect(validateAreaReasons(areas, {})).toEqual({ ok: false, code: 'MOTIVO_AREA_REQUERIDO' });
    const reasons = {
      'LATERAL:L1-H2:LATERAL_B': { reason: 'CLIMA' as const, note: '' },
      'HILERA:L1': { reason: 'FALTA_TIEMPO' as const, note: '' },
      'LOTE:L2': { reason: 'OTRO' as const, note: '' },
    };
    expect(validateAreaReasons(areas, reasons)).toEqual({ ok: false, code: 'MOTIVO_AREA_REQUERIDO' });
    expect(validateAreaReasons(areas, { ...reasons, 'LOTE:L2': { reason: 'OTRO', note: 'Tractor en la entrada' } })).toEqual({
      ok: true,
    });
  });

  test('sin pendientes no pide nada', () => {
    const areas = pendingAreasOfSession({
      plannedLotIds: ['L3'],
      rowsByLot: new Map([['L3', rows('L3', 1)]]),
      cyclePassesByRow: new Map([['L3-H1', [pass('LATERAL_A', 'COMPLETED'), pass('LATERAL_B', 'COMPLETED')]]]),
      sessionPasses: [],
    });
    expect(areas).toEqual([]);
    expect(validateAreaReasons(areas, {})).toEqual({ ok: true });
  });

  test('rangos de hileras compactos', () => {
    expect(formatRanges([5, 1, 2, 3, 8, 7])).toBe('1–3, 5, 7–8');
    expect(formatRanges([4])).toBe('4');
    expect(formatRanges([])).toBe('');
  });
});
