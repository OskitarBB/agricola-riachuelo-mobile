// src/controller/catalogService.ts — Catálogos de campo en el CONTROLADOR (RF-15, RF-16; maestro §12.5).
//
// QUÉ HACE:
//  - updateCatalogs(): con internet y sesión ONLINE descarga GET /api/v1/mobile/bootstrap de la plataforma Django y
//    REEMPLAZA de forma atómica lotes, hileras, segmentos y marcadores; aplica y guarda el perfil de calidad publicado
//    (se vuelve a aplicar al arrancar aunque no haya internet, src/boot.ts).
//  - info()/isOld(): versión, fecha y conteos; aviso si tienen más de catalog.bootstrapWarnAgeHours.
//  - Selectores encadenados SIN internet: lote → hilera → segmento → marcador.
// Los catálogos se administran en la web de la plataforma (Supabase); la app nunca habla con Supabase (R-21).

import { bootstrapApi } from '../api';
import { ApiError } from '../api/httpClient';
import { callWithToken, noteServerTime, revoke, REVOKE_CODES } from '../auth/authService';
import { useAppSession } from '../auth/authStore';
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
  // Sin tokens (sesión OFFLINE) primero hay que validar la contraseña con internet (7.5).
  if (useAppSession.getState().mode !== 'ONLINE') return { ok: false, code: 'REAUTENTICACION_REQUERIDA' };
  try {
    const data = await callWithToken((token) => bootstrapApi.bootstrap(token, getDeviceIdentity().deviceId));
    noteServerTime(data.serverTime);
    await replaceCatalogs(data);
    applyQualityProfile(data.qualityProfile);
    const info = await getCatalogInfo();
    logEvent('INFO', 'CATALOG', 'BOOTSTRAP_OK', {
      version: info.version,
      lots: info.lots,
      rows: info.rows,
      segments: info.segments,
      markers: info.markers,
      quality: data.qualityProfile?.version ?? null,
    });
    return { ok: true, info };
  } catch (err) {
    const code =
      err instanceof ApiError ? (err.isNetwork ? 'SIN_INTERNET' : (err.code ?? 'BACKEND_NO_DISPONIBLE')) : 'ERROR_INESPERADO';
    logEvent('WARN', 'CATALOG', 'BOOTSTRAP_FAIL', {
      code,
      status: err instanceof ApiError ? (err.status ?? null) : null,
      traceId: err instanceof ApiError ? err.traceId : null,
    });
    // 403 de cuenta o celular (no del refresh, que ya revoca en authService): misma revocación de 7.8.
    if (code !== 'REFRESH_INVALID' && (REVOKE_CODES as readonly string[]).includes(code)) await revoke(code);
    return { ok: false, code };
  }
}

/**
 * Estado de los catálogos para PANT-08 y PANT-11: nunca descargados, descargados pero el servidor no tiene lotes con
 * hileras activas (la descarga fue correcta, el catálogo está vacío en la web) o listos para crear una sesión.
 */
export type CatalogState = 'SIN_DESCARGAR' | 'VACIO' | 'LISTO';

export function catalogState(info: CatalogInfo | null): CatalogState {
  if (info && info.lots > 0 && info.rows > 0) return 'LISTO';
  return info?.bootstrapAt ? 'VACIO' : 'SIN_DESCARGAR';
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
