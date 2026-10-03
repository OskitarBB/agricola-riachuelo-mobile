// src/storage/migrations/001_initial.ts — Esquema SQLite v1 (PRAGMA user_version = 1). Maestro §12.1.
//
// QUÉ HACE: crea todas las tablas de la app. El SQL se exporta como texto porque Metro no importa
// archivos .sql. Columnas en snake_case; los repositorios (src/storage/repositories) convierten a los
// tipos camelCase del dominio y NUNCA exponen filas crudas a las pantallas.
//
// REGLA: nunca modificar una migración publicada. Para cambiar el esquema, agregar 002_*.ts y
// registrarla en src/storage/db.ts (MIGRATIONS).
// Nota: el CHECK de `mode` conserva 'MIXTO' solo por compatibilidad con el esquema publicado;
// la interfaz ya no ofrece ese modo (contexto §25.1).
//
// INTEGRACIÓN FUTURA CON LA BASE DE DATOS CENTRAL: estas tablas son una copia local de trabajo.
// La fuente de verdad es PostgreSQL detrás del backend Spring Boot; la sincronización (Fase 4)
// envía sesiones, pasadas, secuencias, capturas e incidencias en el orden de sync_queue.

export const MIGRATION_001 = `
-- src/storage/migrations/001_initial.sql — Esquema SQLite v1 (PRAGMA user_version = 1).
-- Fechas: TEXT ISO-8601 UTC. IDs: TEXT UUID. Booleanos: INTEGER 0/1. JSON: TEXT.
-- Se ejecuta dentro de una transacción exclusiva; al terminar: PRAGMA user_version = 1.
CREATE TABLE IF NOT EXISTS app_meta (
 key    TEXT PRIMARY KEY NOT NULL,
 value TEXT
);
-- Claves usadas: device_id, device_role, catalog_version, bootstrap_at, config_version,
-- quality_profile_version, offline_failed_attempts, offline_locked_until,
-- short_test_pending (controlador: JSON {sessionId, testId, captureIds, issuedAt} de la prueba corta en curso).
CREATE TABLE IF NOT EXISTS users_cache (
 user_id                TEXT PRIMARY KEY NOT NULL,
 email                  TEXT NOT NULL,
 full_name              TEXT NOT NULL,
 roles_json             TEXT NOT NULL,
 account_status         TEXT NOT NULL CHECK (account_status IN ('PENDIENTE_APROBACION','ACTIVO','RECHAZADO','BLOQUEADO')),
 must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
 last_online_auth_at TEXT,
 updated_at             TEXT NOT NULL
);
-- ------------------------------------------------------------------ catálogos (bootstrap)
CREATE TABLE IF NOT EXISTS cat_lots (
 id      TEXT PRIMARY KEY NOT NULL,
 code    TEXT NOT NULL UNIQUE,
 name    TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE IF NOT EXISTS cat_rows (
 id           TEXT PRIMARY KEY NOT NULL,
 lot_id       TEXT NOT NULL REFERENCES cat_lots(id),
 number       INTEGER NOT NULL CHECK (number > 0),
 plant_count INTEGER NOT NULL CHECK (plant_count >= 0),
 active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
 UNIQUE (lot_id, number)
);
CREATE TABLE IF NOT EXISTS cat_segments (
 id           TEXT PRIMARY KEY NOT NULL,
 row_id       TEXT NOT NULL REFERENCES cat_rows(id),
 code         TEXT NOT NULL UNIQUE,
 start_plant INTEGER NOT NULL CHECK (start_plant > 0),
 end_plant    INTEGER NOT NULL,
 is_pilot     INTEGER NOT NULL DEFAULT 0 CHECK (is_pilot IN (0,1)),
 CHECK (end_plant >= start_plant)
);
CREATE TABLE IF NOT EXISTS cat_markers (
 id           TEXT PRIMARY KEY NOT NULL,
 row_id       TEXT NOT NULL REFERENCES cat_rows(id),
 segment_id TEXT REFERENCES cat_segments(id),
 code         TEXT NOT NULL UNIQUE,
 description TEXT,
position     TEXT NOT NULL CHECK (position IN ('INICIO','FIN','INTERMEDIO')),
lat          REAL,
lon          REAL
);
-- ------------------------------------------------------------------ recorrido (controlador)
CREATE TABLE IF NOT EXISTS monitoring_sessions (
session_id                TEXT PRIMARY KEY NOT NULL,
operator_user_id          TEXT NOT NULL,
controller_device_id      TEXT NOT NULL,
status                    TEXT NOT NULL CHECK (status IN ('DRAFT','PREPARING','READY','ACTIVE','PAUSED','CLOSING','CLOSED','SYNCED')),
mode                      TEXT NOT NULL CHECK (mode IN ('MANUAL','AUTOMATICO','MIXTO')),
interval_ms               INTEGER NOT NULL CHECK (interval_ms > 0),
pairing_token_hash        TEXT,
short_test_passed_at      TEXT,
started_at                TEXT,
ended_at                  TEXT,
app_version               TEXT NOT NULL,
config_version            TEXT NOT NULL,
quality_profile_version TEXT NOT NULL,
remote_sync_status        TEXT NOT NULL DEFAULT 'PENDIENTE_NUBE'
                          CHECK (remote_sync_status IN ('PENDIENTE_NUBE','SUBIENDO','SINCRONIZADO','ERROR_SINCRONIZACION')),
created_at                TEXT NOT NULL,
updated_at                TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_devices (
session_id          TEXT NOT NULL REFERENCES monitoring_sessions(session_id),
role                TEXT NOT NULL CHECK (role IN ('CAMERA_1','CAMERA_2')),
device_id           TEXT NOT NULL,
user_id             TEXT NOT NULL,
platform            TEXT NOT NULL CHECK (platform IN ('android','ios')),
model               TEXT NOT NULL,
os_version          TEXT NOT NULL,
app_version         TEXT NOT NULL,
paired_at           TEXT NOT NULL,
last_seen_at        TEXT,
link_status         TEXT NOT NULL CHECK (link_status IN ('DESCONECTADA','EMPAREJANDO','CONECTADA','INESTABLE','PERDIDA')),
battery_level       REAL,
free_space_bytes    INTEGER,
pending_transfers INTEGER NOT NULL DEFAULT 0,
clock_offset_ms     INTEGER,
released            INTEGER NOT NULL DEFAULT 0 CHECK (released IN (0,1)),    -- 1 = rol liberado para reemplazar el celular
PRIMARY KEY (session_id, device_id)                                            -- un celular, un rol por sesión (RN-16)
);
-- Un solo celular activo (no liberado) por rol y sesión.
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_devices_active_role ON session_devices(session_id, role) WHERE released =0;
CREATE TABLE IF NOT EXISTS monitoring_passes (
pass_id                TEXT PRIMARY KEY NOT NULL,
session_id             TEXT NOT NULL REFERENCES monitoring_sessions(session_id),
lot_id                 TEXT NOT NULL,
row_id                 TEXT NOT NULL,
lateral_code           TEXT NOT NULL CHECK (lateral_code IN ('LATERAL_A','LATERAL_B')),
pass_order             INTEGER NOT NULL CHECK (pass_order > 0),
direction              TEXT NOT NULL CHECK (direction IN ('ASCENDENTE','DESCENDENTE')),
start_marker_id        TEXT,
end_marker_id          TEXT,
current_segment_id     TEXT,
current_marker_id      TEXT,
status                 TEXT NOT NULL CHECK (status IN ('READY','ACTIVE','PAUSED','COMPLETED','INCOMPLETE')),
started_at             TEXT,
ended_at               TEXT,
sequences_total        INTEGER NOT NULL DEFAULT 0,
sequences_complete     INTEGER NOT NULL DEFAULT 0,
sequences_incomplete INTEGER NOT NULL DEFAULT 0,
remote_sync_status     TEXT NOT NULL DEFAULT 'PENDIENTE_NUBE'
                       CHECK (remote_sync_status IN ('PENDIENTE_NUBE','SUBIENDO','SINCRONIZADO','ERROR_SINCRONIZACION')),
created_at             TEXT NOT NULL,
updated_at             TEXT NOT NULL,
UNIQUE (session_id, row_id, pass_order)
);
CREATE TABLE IF NOT EXISTS capture_sequences (
sequence_id          TEXT PRIMARY KEY NOT NULL,
pass_id              TEXT NOT NULL REFERENCES monitoring_passes(pass_id),
session_id           TEXT NOT NULL REFERENCES monitoring_sessions(session_id),
sequence_number      INTEGER NOT NULL CHECK (sequence_number > 0),
mode                 TEXT NOT NULL CHECK (mode IN ('MANUAL','AUTOMATICO','MIXTO')),
status               TEXT NOT NULL CHECK (status IN ('CREATED','COMMAND_SENT','PARTIAL','COMPLETE','INCOMPLETE','CANCELLED')),
lot_id               TEXT NOT NULL,
row_id               TEXT NOT NULL,
segment_id           TEXT,
marker_id            TEXT,
lat                  REAL,
lon                  REAL,
gps_accuracy_m       REAL,
gps_timestamp        TEXT,
gps_age_ms           INTEGER,
issued_at            TEXT NOT NULL,
expires_at           TEXT NOT NULL,
completed_at         TEXT,
slot1_capture_id     TEXT NOT NULL,
slot1_outcome        TEXT NOT NULL DEFAULT 'PENDIENTE',
slot2_capture_id     TEXT NOT NULL,
slot2_outcome        TEXT NOT NULL DEFAULT 'PENDIENTE',
remote_sync_status   TEXT NOT NULL DEFAULT 'PENDIENTE_NUBE'
                     CHECK (remote_sync_status IN ('PENDIENTE_NUBE','SUBIENDO','SINCRONIZADO','ERROR_SINCRONIZACION')),
CHECK (slot1_outcome IN ('PENDIENTE','OK_PENDIENTE_ARCHIVO','OK_RECIBIDA','RECHAZADA_CALIDAD','ERROR_CAMARA','SIN_RESPUESTA')),
CHECK (slot2_outcome IN ('PENDIENTE','OK_PENDIENTE_ARCHIVO','OK_RECIBIDA','RECHAZADA_CALIDAD','ERROR_CAMARA','SIN_RESPUESTA')),
UNIQUE (pass_id, sequence_number)
);
CREATE TABLE IF NOT EXISTS marker_changes (
marker_change_id TEXT PRIMARY KEY NOT NULL,
pass_id           TEXT NOT NULL REFERENCES monitoring_passes(pass_id),
marker_id         TEXT,
segment_id        TEXT,
changed_at        TEXT NOT NULL,
lat               REAL,
lon               REAL,
gps_accuracy_m    REAL,
gps_timestamp     TEXT
);
-- Repeticiones pedidas por el operador: contexto vigente al repetir (RN-07).
CREATE TABLE IF NOT EXISTS retake_requests (
capture_id           TEXT PRIMARY KEY NOT NULL,            -- captureId nuevo de la repetición
sequence_id          TEXT NOT NULL REFERENCES capture_sequences(sequence_id),
pass_id              TEXT NOT NULL REFERENCES monitoring_passes(pass_id),
camera_role          TEXT NOT NULL CHECK (camera_role IN ('CAMERA_1','CAMERA_2')),
replaces_capture_id TEXT NOT NULL,
requested_at         TEXT NOT NULL,
segment_id           TEXT,
marker_id            TEXT,
lat                  REAL,
lon                  REAL,
gps_accuracy_m       REAL,
gps_timestamp        TEXT,
gps_age_ms           INTEGER
);
-- ------------------------------------------------------------------ contexto recibido (solo cámaras)
CREATE TABLE IF NOT EXISTS camera_context (
session_id             TEXT PRIMARY KEY NOT NULL,
controller_device_id TEXT NOT NULL,
role                   TEXT NOT NULL CHECK (role IN ('CAMERA_1','CAMERA_2')),
controller_host        TEXT NOT NULL,    -- datos del QR para reconectar (el token va en SecureStore: pairing.token)
control_port           INTEGER NOT NULL,
file_port              INTEGER NOT NULL,
paired_at              TEXT NOT NULL,
config_json            TEXT NOT NULL,    -- PAIRED.config
context_json           TEXT,             -- último SESSION_CONTEXT
closed_at              TEXT,
updated_at             TEXT NOT NULL
);
-- ------------------------------------------------------------------ capturas (cámaras y controlador)
CREATE TABLE IF NOT EXISTS captures (
capture_id                TEXT PRIMARY KEY NOT NULL,
sequence_id               TEXT NOT NULL,
session_id                TEXT NOT NULL,
pass_id                   TEXT,                                   -- NULL solo en capturas de prueba corta
lateral_code              TEXT CHECK (lateral_code IS NULL OR lateral_code IN ('LATERAL_A','LATERAL_B')),
is_test                   INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1)),
device_id                 TEXT NOT NULL,
camera_role               TEXT NOT NULL CHECK (camera_role IN ('CAMERA_1','CAMERA_2')),
user_id                   TEXT NOT NULL,
captured_at               TEXT NOT NULL,
file_path                 TEXT,
size_bytes                INTEGER,
width                     INTEGER,
height                    INTEGER,
md5                       TEXT,
quality_status            TEXT NOT NULL CHECK (quality_status IN ('CAPTURED','UTILIZABLE','REPETIR_NITIDEZ','REPETIR_EXPOSICION','ERROR_CAMARA','PENDIENTE_REVISION_TECNICA')),
quality_profile_version TEXT NOT NULL,
replaces_capture_id       TEXT,
local_transfer_status     TEXT NOT NULL CHECK (local_transfer_status IN ('PENDIENTE_LOCAL','TRANSFIRIENDO_LOCAL','RECIBIDA_CONTROLADOR','ERROR_LOCAL')),
remote_sync_status        TEXT CHECK (remote_sync_status IS NULL OR remote_sync_status IN ('PENDIENTE_NUBE','SUBIENDO','SINCRONIZADO','ERROR_SINCRONIZACION')),
transfer_attempts         INTEGER NOT NULL DEFAULT 0,
sync_attempts             INTEGER NOT NULL DEFAULT 0,
last_error                TEXT,
file_deleted_at           TEXT,
created_at                TEXT NOT NULL,
updated_at                TEXT NOT NULL,
CHECK (is_test = 1 OR (pass_id IS NOT NULL AND lateral_code IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS quality_results (
capture_id          TEXT PRIMARY KEY NOT NULL REFERENCES captures(capture_id),
profile_version     TEXT NOT NULL,
status              TEXT NOT NULL CHECK (status IN ('UTILIZABLE','REPETIR_NITIDEZ','REPETIR_EXPOSICION','ERROR_CAMARA','PENDIENTE_REVISION_TECNICA')),
reasons_json        TEXT NOT NULL DEFAULT '[]',
luminance_mean      REAL,
dark_ratio          REAL,
bright_ratio        REAL,
laplacian_variance REAL,
analyzed_regions    INTEGER,
duration_ms         INTEGER,
created_at          TEXT NOT NULL
);
-- Cola de la cámara hacia el controlador.
CREATE TABLE IF NOT EXISTS transfer_queue (
capture_id       TEXT PRIMARY KEY NOT NULL REFERENCES captures(capture_id),
priority         INTEGER NOT NULL DEFAULT 0,           -- -1 = prueba corta (primero), 0 = útil, 1 = rechazada
status           TEXT NOT NULL CHECK (status IN ('PENDIENTE','EN_CURSO','HECHO','ERROR')),
attempts         INTEGER NOT NULL DEFAULT 0,
checksum_failures INTEGER NOT NULL DEFAULT 0,          -- MD5_MISMATCH / SIZE_MISMATCH acumulados (classifyLocalTransfer)
next_attempt_at TEXT NOT NULL,
last_error       TEXT,
updated_at       TEXT NOT NULL
);
-- Cola del controlador hacia Spring Boot.
CREATE TABLE IF NOT EXISTS sync_queue (
id               INTEGER PRIMARY KEY AUTOINCREMENT,
entity_type      TEXT NOT NULL CHECK (entity_type IN ('SESSION','PASS','SEQUENCE_BATCH','CAPTURE','INCIDENT_BATCH','SESSION_CLOSE')),
entity_id        TEXT NOT NULL,                         -- SESSION/SESSION_CLOSE: sessionId · PASS y SEQUENCE_BATCH: passId · CAPTURE: captureId · INCIDENT_BATCH: sessionId
session_id       TEXT NOT NULL,
order_key        INTEGER NOT NULL,                      -- 10 sesión, 20 pasada, 30 secuencias, 40 capturas, 50 incidencias, 60 cierre
status           TEXT NOT NULL CHECK (status IN ('PENDIENTE','EN_CURSO','HECHO','ERROR_DEFINITIVO')),
attempts         INTEGER NOT NULL DEFAULT 0,
next_attempt_at TEXT NOT NULL,
last_error_code TEXT,
last_error       TEXT,
created_at       TEXT NOT NULL,
updated_at       TEXT NOT NULL,
UNIQUE (entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS processed_messages (
message_id    TEXT PRIMARY KEY NOT NULL,
type          TEXT NOT NULL,
received_at   TEXT NOT NULL,
response_json TEXT
);
CREATE TABLE IF NOT EXISTS incidents (
incident_id         TEXT PRIMARY KEY NOT NULL,
session_id          TEXT NOT NULL,
pass_id             TEXT,
sequence_id         TEXT,
capture_id          TEXT,
device_id           TEXT,
type                TEXT NOT NULL CHECK (type IN ('CALIDAD','DESCONEXION','BATERIA','TEMPERATURA','ESPACIO','GPS','TRANSFERENCIA','SINCRONIZACION','SOPORTE','OPERADOR','OTRO')),
severity            TEXT NOT NULL CHECK (severity IN ('INFO','AVISO','ERROR')),
detail              TEXT NOT NULL,
occurred_at         TEXT NOT NULL,
 created_by         TEXT NOT NULL CHECK (created_by IN ('SISTEMA','OPERADOR')),
 remote_sync_status TEXT NOT NULL DEFAULT 'PENDIENTE_NUBE'
                    CHECK (remote_sync_status IN ('PENDIENTE_NUBE','SUBIENDO','SINCRONIZADO','ERROR_SINCRONIZACION'))
);
CREATE TABLE IF NOT EXISTS event_log (
 id         INTEGER PRIMARY KEY AUTOINCREMENT,
 ts         TEXT NOT NULL,
 level      TEXT NOT NULL CHECK (level IN ('DEBUG','INFO','WARN','ERROR')),
 category   TEXT NOT NULL,
 event      TEXT NOT NULL,
 session_id TEXT,
 device_id TEXT,
 data_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_rows_lot            ON cat_rows(lot_id);
CREATE INDEX IF NOT EXISTS idx_segments_row        ON cat_segments(row_id);
CREATE INDEX IF NOT EXISTS idx_markers_row         ON cat_markers(row_id);
CREATE INDEX IF NOT EXISTS idx_passes_session      ON monitoring_passes(session_id);
CREATE INDEX IF NOT EXISTS idx_sequences_pass      ON capture_sequences(pass_id);
CREATE INDEX IF NOT EXISTS idx_marker_changes_pass ON marker_changes(pass_id);
CREATE INDEX IF NOT EXISTS idx_retakes_sequence    ON retake_requests(sequence_id);
CREATE INDEX IF NOT EXISTS idx_captures_sequence   ON captures(sequence_id);
CREATE INDEX IF NOT EXISTS idx_captures_session    ON captures(session_id);
CREATE INDEX IF NOT EXISTS idx_captures_transfer   ON captures(local_transfer_status);
CREATE INDEX IF NOT EXISTS idx_captures_sync       ON captures(remote_sync_status);
CREATE INDEX IF NOT EXISTS idx_transfer_next       ON transfer_queue(status, priority, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_sync_next           ON sync_queue(status, order_key, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_incidents_session   ON incidents(session_id);
CREATE INDEX IF NOT EXISTS idx_event_log_ts        ON event_log(ts);
CREATE INDEX IF NOT EXISTS idx_processed_received ON processed_messages(received_at);`;
