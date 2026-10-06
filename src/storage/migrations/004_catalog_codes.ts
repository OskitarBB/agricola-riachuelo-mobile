// src/storage/migrations/004_catalog_codes.ts — Catálogos compatibles con la plataforma Django (Fase 4, ADR 0007).
//
// QUÉ HACE: en la migración 001, cat_segments.code y cat_markers.code eran UNIQUE en TODO el catálogo. En la plataforma
// (campo/models.py) el código de un segmento o de un marcador NO es único: se repite entre hileras (p. ej. "SEG-01" o
// "MK-01-I" en cada hilera, como en el ejemplo del maestro §15.4); lo único es su id. Con el catálogo real, el
// bootstrap fallaba al insertar el segundo "SEG-01" y el controlador se quedaba sin catálogos.
// También se acepta start_plant = 0 (PositiveIntegerField en el servidor).
// Las tablas se recrean conservando sus filas (un celular sin internet no pierde sus catálogos). No hay otras tablas
// con claves foráneas hacia cat_segments salvo cat_markers, que se recrea en el mismo paso.
// REGLA: nunca modificar una migración publicada (12.2): por eso esto es una migración nueva y no un cambio a la 001.

export const MIGRATION_004 = `
CREATE TABLE cat_segments_004 AS SELECT * FROM cat_segments;
CREATE TABLE cat_markers_004 AS SELECT * FROM cat_markers;
DROP TABLE cat_markers;
DROP TABLE cat_segments;

CREATE TABLE cat_segments (
  id          TEXT PRIMARY KEY NOT NULL,
  row_id      TEXT NOT NULL REFERENCES cat_rows(id),
  code        TEXT NOT NULL,
  start_plant INTEGER NOT NULL CHECK (start_plant >= 0),
  end_plant   INTEGER NOT NULL,
  is_pilot    INTEGER NOT NULL DEFAULT 0 CHECK (is_pilot IN (0,1)),
  CHECK (end_plant >= start_plant)
);
CREATE TABLE cat_markers (
  id          TEXT PRIMARY KEY NOT NULL,
  row_id      TEXT NOT NULL REFERENCES cat_rows(id),
  segment_id  TEXT REFERENCES cat_segments(id),
  code        TEXT NOT NULL,
  description TEXT,
  position    TEXT NOT NULL CHECK (position IN ('INICIO','FIN','INTERMEDIO')),
  lat         REAL,
  lon         REAL
);

INSERT INTO cat_segments (id, row_id, code, start_plant, end_plant, is_pilot)
  SELECT id, row_id, code, start_plant, end_plant, is_pilot FROM cat_segments_004;
INSERT INTO cat_markers (id, row_id, segment_id, code, description, position, lat, lon)
  SELECT id, row_id, segment_id, code, description, position, lat, lon FROM cat_markers_004;
DROP TABLE cat_markers_004;
DROP TABLE cat_segments_004;

CREATE INDEX IF NOT EXISTS idx_segments_row  ON cat_segments(row_id);
CREATE INDEX IF NOT EXISTS idx_markers_row   ON cat_markers(row_id);
CREATE INDEX IF NOT EXISTS idx_segments_code ON cat_segments(row_id, code);
CREATE INDEX IF NOT EXISTS idx_markers_code  ON cat_markers(row_id, code);
`;
