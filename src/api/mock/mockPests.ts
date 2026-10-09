// src/api/mock/mockPests.ts — Alertas de plaga de EJEMPLO para el backend simulado («Ubicar plaga», ADR 0009).
//
// QUÉ HACE: arma una PestReportsResponse alrededor del centro del fundo (14°01'40.1"S 75°41'57.2"W) con un caso de
// cada estado que llega a la app y contornos de lote, hileras y puntos INVENTADOS (no son los del campo: los reales
// se dibujan en la web, Mapa del fundo). Solo para desarrollo y demostraciones; el APK del piloto usa la plataforma.

import { FARM_CENTER, type FarmLayers, type PestReport, type PestReportsResponse } from '../../domain/pests';

/** Desplaza el centro del fundo `north` y `east` metros (aproximación plana, suficiente para datos de ejemplo). */
function offset(north: number, east: number): [number, number] {
  const [lat, lon] = FARM_CENTER;
  const dLat = north / 111_320;
  const dLon = east / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [Number((lat + dLat).toFixed(7)), Number((lon + dLon).toFixed(7))];
}

function square(n: number, e: number, h: number, w: number): number[][][] {
  const pts = [offset(n, e), offset(n, e + w), offset(n - h, e + w), offset(n - h, e)].map(([la, lo]) => [lo, la]);
  return [[...pts, pts[0]]];
}

function demoFarm(): FarmLayers {
  const rows: FarmLayers['rows'] = [];
  for (let i = 0; i < 8; i++) {
    rows.push({
      id: `SWG1-H${String(i + 1).padStart(2, '0')}`,
      lot: 'SWG1',
      number: i + 1,
      plants: 383,
      ini: offset(140 - i * 12, -150),
      fin: offset(140 - i * 12, -20),
    });
  }
  return {
    lots: [
      {
        id: 'SWG1',
        code: 'SWG 1',
        name: 'Lote 1 (Piscina)',
        color: '#2e90fa',
        geometry: { type: 'Polygon', coordinates: square(150, -160, 110, 150) },
      },
      {
        id: 'SWG2',
        code: 'SWG 2',
        name: 'Lote 2 (Maíz)',
        color: '#12b76a',
        geometry: { type: 'Polygon', coordinates: square(150, 20, 110, 130) },
      },
      { id: 'SWG5', code: 'SWG 5', name: 'Lote 5 (Triángulo)', color: '#f79009', geometry: null },
    ],
    rows,
    points: [
      {
        id: 1,
        name: 'Entrada principal',
        kind: 'ENTRADA',
        kindLabel: 'Entrada',
        description: '',
        lat: offset(-40, -60)[0],
        lon: offset(-40, -60)[1],
      },
      {
        id: 2,
        name: 'Almacén',
        kind: 'ALMACEN',
        kindLabel: 'Almacén',
        description: 'Ejemplo',
        lat: offset(-20, 40)[0],
        lon: offset(-20, 40)[1],
      },
    ],
    center: FARM_CENTER,
  };
}

function report(
  n: number,
  status: PestReport['status'],
  statusLabel: string,
  rowNumber: number,
  north: number,
  east: number,
  hoursAgo: number,
  extra: Partial<PestReport> = {},
): PestReport {
  const [lat, lon] = offset(north, east);
  const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const rowId = `SWG1-H${String(rowNumber).padStart(2, '0')}`;
  return {
    caseId: `00000000-0000-4000-8000-00000000000${n}`,
    status,
    statusLabel,
    origin: 'IA',
    label: 'chanchito_blanco',
    maxConfidence: 0.81,
    capturedAt: at,
    decidedAt: status === 'PENDIENTE_REVISION' ? null : at,
    lot: { id: 'SWG1', code: 'SWG 1', name: 'Lote 1 (Piscina)' },
    row: { id: rowId, number: rowNumber, plantCount: 383 },
    lateralCode: 'LATERAL_A',
    lateralLabel: 'Lateral A',
    segment: { id: `${rowId}-S1`, code: `${rowId}-S1`, startPlant: 1, endPlant: 25 },
    marker: null,
    lat,
    lon,
    gpsAccuracyM: 6,
    locationSource: 'GPS',
    observation: '',
    thumbnailUrl: null,
    ...extra,
  };
}

export function buildMockPestReports(days: number): PestReportsResponse {
  return {
    reports: [
      report(1, 'CONFIRMADO_POR_ESPECIALISTA', 'Confirmado por especialista', 3, 116, -90, 5, {
        observation: 'Colonia en racimos del lado A.',
      }),
      report(2, 'CONFIRMADO_POR_IA', 'Confirmado por IA', 6, 80, -40, 2, { maxConfidence: 0.93 }),
      report(3, 'POSIBLE_PLAGA', 'Posible plaga', 2, 128, -130, 26, { label: 'melaza_fumagina', maxConfidence: 0.55 }),
      report(4, 'PENDIENTE_REVISION', 'Pendiente de revisión', 8, 56, -70, 1, {
        maxConfidence: 0.47,
        locationSource: 'MARCADOR',
        gpsAccuracyM: null,
      }),
    ],
    farm: demoFarm(),
    days,
    serverTime: new Date().toISOString(),
  };
}
