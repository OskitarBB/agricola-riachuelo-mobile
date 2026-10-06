// src/storage/repositories/catalogRepo.ts — Catálogos de campo (lotes, hileras, segmentos, marcadores).
//
// QUÉ HACE:
//  - replaceCatalogs(): reemplazo ATÓMICO de las 4 tablas (borrar e insertar en una transacción) y
//    actualización de app_meta.catalog_version / bootstrap_at (maestro §12.5, RF-15).
//  - Consultas encadenadas lote → hilera → segmento → marcador para PANT-15 y PANT-17 (RF-16, sin internet).
//
// Los catálogos llegan de GET /api/v1/mobile/bootstrap (plataforma Django, que los toma de Supabase / la web de
// administración). Los códigos definitivos dependen de Q-01. Los códigos de segmento y marcador pueden repetirse
// entre hileras (migración 004, ADR 0007); el id es la clave.

import type { BootstrapResponse } from '../../api/dto';
import type { FieldRow, Lot, Marker, MarkerPosition, Segment } from '../../domain/types';
import { nowIso } from '../../domain/time';
import { getDb, inTransaction, type Db } from '../db';
import { getMeta, setMeta } from './appMetaRepo';

export async function replaceCatalogs(data: BootstrapResponse): Promise<void> {
  await inTransaction(async (txn) => {
    // Orden inverso por las claves foráneas.
    await txn.runAsync('DELETE FROM cat_markers', []);
    await txn.runAsync('DELETE FROM cat_segments', []);
    await txn.runAsync('DELETE FROM cat_rows', []);
    await txn.runAsync('DELETE FROM cat_lots', []);
    // Sentencias preparadas: cientos de filas se insertan rápido dentro de la misma transacción.
    const insLot = await txn.prepareAsync('INSERT INTO cat_lots (id, code, name, active) VALUES (?, ?, ?, ?)');
    const insRow = await txn.prepareAsync(
      'INSERT INTO cat_rows (id, lot_id, number, plant_count, active) VALUES (?, ?, ?, ?, ?)',
    );
    const insSeg = await txn.prepareAsync(
      'INSERT INTO cat_segments (id, row_id, code, start_plant, end_plant, is_pilot) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insMk = await txn.prepareAsync(
      'INSERT INTO cat_markers (id, row_id, segment_id, code, description, position, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    try {
      for (const l of data.lots) await insLot.executeAsync([l.id, l.code, l.name, l.active ? 1 : 0]);
      for (const r of data.rows) await insRow.executeAsync([r.id, r.lotId, r.number, r.plantCount, r.active ? 1 : 0]);
      for (const s of data.segments) {
        await insSeg.executeAsync([s.id, s.rowId, s.code, s.startPlant, s.endPlant, s.isPilot ? 1 : 0]);
      }
      for (const m of data.markers) {
        await insMk.executeAsync([m.id, m.rowId, m.segmentId, m.code, m.description, m.position, m.lat, m.lon]);
      }
    } finally {
      await insLot.finalizeAsync();
      await insRow.finalizeAsync();
      await insSeg.finalizeAsync();
      await insMk.finalizeAsync();
    }
    await setMeta('catalog_version', data.catalogVersion, txn);
    await setMeta('bootstrap_at', nowIso(), txn);
    await setMeta('quality_profile_version', data.qualityProfile?.version ?? null, txn);
    // Se guarda el perfil completo para reaplicarlo al arrancar (src/boot.ts) aunque no haya internet.
    await setMeta('quality_profile_json', data.qualityProfile ? JSON.stringify(data.qualityProfile) : null, txn);
  });
}

export interface CatalogInfo {
  version: string | null;
  bootstrapAt: string | null;
  lots: number;
  rows: number;
  segments: number;
  markers: number;
}

export async function getCatalogInfo(db: Db = getDb()): Promise<CatalogInfo> {
  const count = async (t: string) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`, []))?.n ?? 0;
  return {
    version: await getMeta('catalog_version', db),
    bootstrapAt: await getMeta('bootstrap_at', db),
    lots: await count('cat_lots'),
    rows: await count('cat_rows'),
    segments: await count('cat_segments'),
    markers: await count('cat_markers'),
  };
}

export async function listLots(db: Db = getDb()): Promise<Lot[]> {
  const rows = await db.getAllAsync<{ id: string; code: string; name: string; active: number }>(
    'SELECT * FROM cat_lots WHERE active = 1 ORDER BY code',
    [],
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, active: r.active === 1 }));
}

export async function listRows(lotId: string, db: Db = getDb()): Promise<FieldRow[]> {
  const rows = await db.getAllAsync<{ id: string; lot_id: string; number: number; plant_count: number; active: number }>(
    'SELECT * FROM cat_rows WHERE lot_id = ? AND active = 1 ORDER BY number',
    [lotId],
  );
  return rows.map((r) => ({ id: r.id, lotId: r.lot_id, number: r.number, plantCount: r.plant_count, active: r.active === 1 }));
}

export async function listSegments(rowId: string, db: Db = getDb()): Promise<Segment[]> {
  const rows = await db.getAllAsync<{
    id: string;
    row_id: string;
    code: string;
    start_plant: number;
    end_plant: number;
    is_pilot: number;
  }>('SELECT * FROM cat_segments WHERE row_id = ? ORDER BY start_plant', [rowId]);
  return rows.map((r) => ({
    id: r.id,
    rowId: r.row_id,
    code: r.code,
    startPlant: r.start_plant,
    endPlant: r.end_plant,
    isPilot: r.is_pilot === 1,
  }));
}

interface MarkerRow {
  id: string;
  row_id: string;
  segment_id: string | null;
  code: string;
  description: string | null;
  position: MarkerPosition;
  lat: number | null;
  lon: number | null;
}

function markerToDomain(r: MarkerRow): Marker {
  return {
    id: r.id,
    rowId: r.row_id,
    segmentId: r.segment_id,
    code: r.code,
    description: r.description,
    position: r.position,
    lat: r.lat,
    lon: r.lon,
  };
}

export async function listMarkers(rowId: string, db: Db = getDb()): Promise<Marker[]> {
  const rows = await db.getAllAsync<MarkerRow>(
    `SELECT m.* FROM cat_markers m LEFT JOIN cat_segments s ON s.id = m.segment_id
     WHERE m.row_id = ? ORDER BY COALESCE(s.start_plant, 0), CASE m.position WHEN 'INICIO' THEN 0 WHEN 'INTERMEDIO' THEN 1 ELSE 2 END, m.code`,
    [rowId],
  );
  return rows.map(markerToDomain);
}

export async function getMarker(id: string, db: Db = getDb()): Promise<Marker | null> {
  const r = await db.getFirstAsync<MarkerRow>('SELECT * FROM cat_markers WHERE id = ?', [id]);
  return r ? markerToDomain(r) : null;
}

export async function getLot(id: string, db: Db = getDb()): Promise<Lot | null> {
  const r = await db.getFirstAsync<{ id: string; code: string; name: string; active: number }>(
    'SELECT * FROM cat_lots WHERE id = ?',
    [id],
  );
  return r ? { id: r.id, code: r.code, name: r.name, active: r.active === 1 } : null;
}

export async function getRow(id: string, db: Db = getDb()): Promise<FieldRow | null> {
  const r = await db.getFirstAsync<{ id: string; lot_id: string; number: number; plant_count: number; active: number }>(
    'SELECT * FROM cat_rows WHERE id = ?',
    [id],
  );
  return r ? { id: r.id, lotId: r.lot_id, number: r.number, plantCount: r.plant_count, active: r.active === 1 } : null;
}

export async function getSegment(id: string, db: Db = getDb()): Promise<Segment | null> {
  const r = await db.getFirstAsync<{
    id: string;
    row_id: string;
    code: string;
    start_plant: number;
    end_plant: number;
    is_pilot: number;
  }>('SELECT * FROM cat_segments WHERE id = ?', [id]);
  return r
    ? { id: r.id, rowId: r.row_id, code: r.code, startPlant: r.start_plant, endPlant: r.end_plant, isPilot: r.is_pilot === 1 }
    : null;
}
