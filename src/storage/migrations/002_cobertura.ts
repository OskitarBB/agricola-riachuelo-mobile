// src/storage/migrations/002_cobertura.ts — Ciclos de monitoreo, lotes planificados y áreas no hechas (CFG-3).
//
// QUÉ HACE:
//  - monitoring_cycles: rondas de monitoreo. Lo terminado se bloquea DENTRO del ciclo; un ciclo nuevo libera todo.
//  - monitoring_sessions.cycle_id: ciclo al que pertenece cada sesión (las sesiones anteriores a esta migración
//    se asignan al ciclo 1 la primera vez que se abre la app; ver src/controller/cycleService.ts).
//  - session_planned_lots: lotes elegidos en "Nueva sesión" (lo que se planificó trabajar).
//  - uncovered_areas: lotes, hileras o laterales planificados que no se hicieron, con su motivo.
//  - Índices para leer rápido las pasadas de una hilera o lote dentro del ciclo.
// No borra ni cambia datos existentes: es segura en instalaciones que ya tienen sesiones guardadas.
// INTEGRACIÓN FUTURA (Fase 4): uncovered_areas viaja con el lote de incidencias (INCIDENT_BATCH) y el ciclo
// vigente lo publicará el backend en el bootstrap.

export const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS monitoring_cycles (
  cycle_id            TEXT PRIMARY KEY NOT NULL,
  number              INTEGER NOT NULL UNIQUE CHECK (number > 0),
  started_at          TEXT NOT NULL,
  started_by_user_id  TEXT,
  note                TEXT
);

ALTER TABLE monitoring_sessions ADD COLUMN cycle_id TEXT REFERENCES monitoring_cycles(cycle_id);

CREATE TABLE IF NOT EXISTS session_planned_lots (
  session_id  TEXT NOT NULL REFERENCES monitoring_sessions(session_id) ON DELETE CASCADE,
  lot_id      TEXT NOT NULL,
  PRIMARY KEY (session_id, lot_id)
);

CREATE TABLE IF NOT EXISTS uncovered_areas (
  area_id             TEXT PRIMARY KEY NOT NULL,
  session_id          TEXT NOT NULL REFERENCES monitoring_sessions(session_id),
  cycle_id            TEXT REFERENCES monitoring_cycles(cycle_id),
  kind                TEXT NOT NULL CHECK (kind IN ('LOTE','HILERA','LATERAL')),
  lot_id              TEXT NOT NULL,
  row_id              TEXT,
  lateral_code        TEXT CHECK (lateral_code IS NULL OR lateral_code IN ('LATERAL_A','LATERAL_B')),
  reason              TEXT NOT NULL CHECK (reason IN ('CLIMA','FALTA_TIEMPO','RIEGO_O_APLICACION','LABORES_CULTIVO',
                                                      'FALLA_EQUIPO','ACCESO_BLOQUEADO','INDICACION_SUPERVISOR','OTRO')),
  note                TEXT,
  user_id             TEXT,
  created_at          TEXT NOT NULL,
  remote_sync_status  TEXT NOT NULL DEFAULT 'PENDIENTE_NUBE'
                      CHECK (remote_sync_status IN ('PENDIENTE_NUBE','SUBIENDO','SINCRONIZADO','ERROR_SINCRONIZACION'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_cycle       ON monitoring_sessions(cycle_id);
CREATE INDEX IF NOT EXISTS idx_passes_row_lateral   ON monitoring_passes(row_id, lateral_code, status);
CREATE INDEX IF NOT EXISTS idx_passes_lot           ON monitoring_passes(lot_id);
CREATE INDEX IF NOT EXISTS idx_uncovered_cycle      ON uncovered_areas(cycle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_uncovered_session    ON uncovered_areas(session_id);
`;
