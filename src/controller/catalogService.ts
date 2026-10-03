// src/controller/catalogService.ts — Catálogos de campo en el CONTROLADOR (RF-15, RF-16; maestro §12.5).
//
// QUÉ HACE:
//  - updateCatalogs(): con internet descarga GET /mobile/bootstrap y REEMPLAZA de forma atómica lotes,
//    hileras, segmentos y marcadores; aplica el perfil de calidad publicado (si lo hay).
//  - info()/isOld(): versión, fecha y conteos; aviso si tienen más de catalog.bootstrapWarnAgeHours.
//  - Selectores encadenados SIN internet: lote → hilera → segmento → marcador.
// INTEGRACIÓN FUTURA: el backend real armará el bootstrap desde PostgreSQL (lo que se administra en la web).

import { bootstrapApi } from '../api';
import { ApiError } from '../api/httpClient';
import { getAccessToken } from '../auth/authService';
import { applyQualityProfile, CONFIG } from '../config';
import { ageMs } from '../domain/time';
import type { FieldRow, Lot, Marker, Segment } from '../domain/types';
import { getDeviceIdentity } from '../device/deviceIdentity';
import { logEvent } from '../diagnostics/eventLog';
import {
  getCatalogInfo,
  getLot,
  getMarker,
  getRow,
  getSegment,
  listLots,
  listMarkers,
  listRows,
  listSegments,
  replaceCatalogs,
  type CatalogInfo,
} from '../storage/repositories/catalogRepo';

export type { CatalogInfo };

export async function updateCatalogs(): Promise<{ ok: true; info: CatalogInfo } | { ok: false; code: string }> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    return { ok: false, code: 'SIN_INTERNET' };
  }
  if (!token) return { ok: false, code: 'REAUTENTICACION_REQUERIDA' };
  try {
    const data = await bootstrapApi.bootstrap(token, getDeviceIdentity().deviceId);
    await replaceCatalogs(data);
    applyQualityProfile(data.qualityProfile);
    const info = await getCatalogInfo();
    logEvent('INFO', 'CATALOG', 'BOOTSTRAP_OK', {
      lots: info.lots,
      rows: info.rows,
      segments: info.segments,
      markers: info.markers,
    });
    return { ok: true, info };
  } catch (err) {
    const code =
      err instanceof ApiError ? (err.isNetwork ? 'SIN_INTERNET' : (err.code ?? 'BACKEND_NO_DISPONIBLE')) : 'ERROR_INESPERADO';
    logEvent('WARN', 'CATALOG', 'BOOTSTRAP_FAIL', { code });
    return { ok: false, code };
  }
}

export function catalogInfo(): Promise<CatalogInfo> {
  return getCatalogInfo();
}

export function isCatalogOld(info: CatalogInfo): boolean {
  const age = ageMs(info.bootstrapAt);
  return age !== null && age > CONFIG.catalog.bootstrapWarnAgeHours * 3_600_000;
}

export const catalogs = {
  lots: (): Promise<Lot[]> => listLots(),
  rows: (lotId: string): Promise<FieldRow[]> => listRows(lotId),
  segments: (rowId: string): Promise<Segment[]> => listSegments(rowId),
  markers: (rowId: string): Promise<Marker[]> => listMarkers(rowId),
  lot: (id: string) => getLot(id),
  row: (id: string) => getRow(id),
  segment: (id: string) => getSegment(id),
  marker: (id: string) => getMarker(id),
};
