// src/api/mock/mockCatalog.ts — Catálogo semilla del backend simulado (maestro §15.6).
//
// QUÉ HACE: arma una BootstrapResponse con los lotes e hileras REALES del piloto (Anexo D) y segmentos y
// marcadores de EJEMPLO para poder recorrer la app. Los códigos definitivos de segmentos y marcadores
// los define el equipo con la empresa (Q-01): cuando el backend real los publique, este archivo deja de usarse.
// Regla de ejemplo: por hilera, hasta 3 segmentos de 25 plantas (inicio, centro y final de la hilera),
// cada uno con marcador de INICIO y de FIN.

import type { Marker, Segment } from '../../domain/types';
import type { BootstrapResponse } from '../dto';
import { buildPilotRows, PILOT_LOTS } from './pilotRows';

const SEGMENT_PLANTS = 25;

export function buildMockBootstrap(serverTime: string): BootstrapResponse {
  const rows = buildPilotRows();
  const segments: Segment[] = [];
  const markers: Marker[] = [];
  for (const row of rows) {
    const starts: number[] = [];
    if (row.plantCount >= SEGMENT_PLANTS) starts.push(1);
    if (row.plantCount >= SEGMENT_PLANTS * 3) starts.push(Math.floor(row.plantCount / 2) - Math.floor(SEGMENT_PLANTS / 2));
    if (row.plantCount >= SEGMENT_PLANTS * 2) starts.push(row.plantCount - SEGMENT_PLANTS + 1);
    if (starts.length === 0) starts.push(1);
    starts.sort((a, b) => a - b);
    starts.forEach((start, idx) => {
      const end = Math.min(row.plantCount, start + SEGMENT_PLANTS - 1);
      const segId = `${row.id}-S${idx + 1}`;
      segments.push({ id: segId, rowId: row.id, code: segId, startPlant: start, endPlant: Math.max(start, end), isPilot: false });
      markers.push({
        id: `${segId}-I`,
        rowId: row.id,
        segmentId: segId,
        code: `${segId}-I`,
        description: `Inicio segmento ${idx + 1} (planta ${start})`,
        position: 'INICIO',
        lat: null,
        lon: null,
      });
      markers.push({
        id: `${segId}-F`,
        rowId: row.id,
        segmentId: segId,
        code: `${segId}-F`,
        description: `Fin segmento ${idx + 1} (planta ${Math.max(start, end)})`,
        position: 'FIN',
        lat: null,
        lon: null,
      });
    });
  }
  return {
    catalogVersion: serverTime,
    lots: PILOT_LOTS,
    rows,
    segments,
    markers,
    lateralCodes: ['LATERAL_A', 'LATERAL_B'],
    qualityProfile: null,
    serverTime,
  };
}
