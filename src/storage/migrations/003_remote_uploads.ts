// src/storage/migrations/003_remote_uploads.ts — Resultado de la subida directa a Cloudinary (maestro v2.0 §12.1.1).
//
// QUÉ HACE: agrega la tabla remote_uploads y no modifica ninguna existente. Una fila por captura de evidencia del
// CONTROLADOR que entró en sync_queue. Permite confirmar en Django sin volver a subir la foto si la app se cerró o se
// perdió la conexión entre la subida y la confirmación (D-31, RF-51).
//   SUBIDA      Cloudinary respondió con éxito (respuesta validada con zod); falta la confirmación en Django.
//   CONFIRMADA  Django confirmó; la captura está SINCRONIZADO y su elemento de sync_queue está HECHO.
//   DESCARTADA  Django rechazó la subida (UPLOAD_SIGNATURE_INVALID o UPLOAD_NOT_FOUND): el siguiente intento pide un
//               ticket nuevo, sube otra vez y reescribe la fila con status = 'SUBIDA' y reupload_count + 1.
// La fila nunca se borra (trazabilidad de la evidencia, 12.5). Liberar espacio no la toca.
// REGLA: nunca modificar una migración publicada (12.2).

export const MIGRATION_003 = `
-- Migración 003 (Maestro v2.0): resultado de la subida directa de una foto a Cloudinary.
CREATE TABLE IF NOT EXISTS remote_uploads (
  capture_id      TEXT PRIMARY KEY NOT NULL REFERENCES captures(capture_id),
  status          TEXT NOT NULL CHECK (status IN ('SUBIDA','CONFIRMADA','DESCARTADA')),
  public_id       TEXT NOT NULL,              -- el del ticket, p. ej. riachuelo/piloto/{sessionId}/{passId}/{captureId}
  version         INTEGER NOT NULL CHECK (version > 0),
  signature       TEXT NOT NULL,              -- firma de la respuesta de Cloudinary (public_id + version); Django la verifica
  bytes           INTEGER NOT NULL CHECK (bytes > 0),
  format          TEXT,
  width           INTEGER,
  height          INTEGER,
  etag            TEXT,
  uploaded_at     TEXT NOT NULL,              -- cuando Cloudinary respondió con éxito
  confirmed_at    TEXT,                       -- cuando Django respondió con éxito a POST /captures/upload
  reupload_count  INTEGER NOT NULL DEFAULT 0, -- subidas repetidas porque Django rechazó la anterior (máx. sync.maxReuploads)
  last_error_code TEXT,
  updated_at      TEXT NOT NULL,
  CHECK (status <> 'CONFIRMADA' OR confirmed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_remote_uploads_status ON remote_uploads(status);
`;
