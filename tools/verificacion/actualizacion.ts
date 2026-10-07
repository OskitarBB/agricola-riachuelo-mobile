// tools/verificacion/actualizacion.ts — Un celular con la v0.2/v0.3 (solo migración 001 y datos) abre la v0.4.0.
//
// QUÉ HACE: arma una base con la migración 001, catálogos, una sesión y su cola; luego abre la base con el código real
// (src/storage/db.ts → migraciones 002, 003 y 004) y comprueba que los datos se conservan, que los códigos de
// catálogo ya pueden repetirse entre hileras, las tablas nuevas, las claves foráneas y la integridad.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const WORK = path.join(os.tmpdir(), 'riachuelo-verificacion', 'actualizacion');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
process.env.RIACHUELO_SQLITE = path.join(WORK, 'app.sqlite');
process.env.RIACHUELO_ARCHIVOS = path.join(WORK, 'archivos');
(globalThis as Record<string, unknown>).__DEV__ = false;
// Módulos de la app, relativos a este archivo (una ruta absoluta de Windows no sirve en import()).
const M = '../../src';

async function main() {
  const { MIGRATION_001 } = await import(`${M}/storage/migrations/001_initial`);
  const old = new DatabaseSync(process.env.RIACHUELO_SQLITE as string);
  old.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  old.exec(MIGRATION_001);
  old.exec('PRAGMA user_version = 1');
  const t = new Date().toISOString();
  old.exec(`INSERT INTO cat_lots (id, code, name, active) VALUES ('L1','L1','Lote 1',1);
    INSERT INTO cat_rows (id, lot_id, number, plant_count, active) VALUES ('L1-H1','L1',1,100,1);
    INSERT INTO cat_segments (id, row_id, code, start_plant, end_plant, is_pilot) VALUES ('L1-S1','L1-H1','SEG-01',1,50,1);
    INSERT INTO cat_markers (id, row_id, segment_id, code, description, position, lat, lon) VALUES ('L1-M1','L1-H1','L1-S1','MK-01','x','INICIO',-14.1,-75.7);
    INSERT INTO app_meta (key, value) VALUES ('catalog_version','v-antigua');`);
  old.prepare(`INSERT INTO monitoring_sessions (session_id, operator_user_id, controller_device_id, status, mode, interval_ms, started_at,
    ended_at, app_version, config_version, quality_profile_version, pairing_token_hash, short_test_passed_at, created_at, updated_at,
    remote_sync_status) VALUES ('S-OLD','U1','D1','CLOSED','MANUAL',4000,?,?,'0.2.0','CFG-2','Q0',NULL,NULL,?,?,'PENDIENTE_NUBE')`).run(t, t, t, t);
  old.prepare(`INSERT INTO sync_queue (entity_type, entity_id, session_id, order_key, status, attempts, next_attempt_at, last_error_code,
    last_error, created_at, updated_at) VALUES ('SESSION','S-OLD','S-OLD',10,'PENDIENTE',0,?,NULL,NULL,?,?)`).run(t, t, t);
  old.close();

  const { openAppDb, getDb } = await import(`${M}/storage/db`);
  await openAppDb();
  const db = getDb();
  const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  assert.equal(v?.user_version, 4);
  assert.equal((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM cat_segments', []))?.n, 1);
  assert.equal((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM cat_markers', []))?.n, 1);
  assert.equal((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM monitoring_sessions', []))?.n, 1);
  assert.equal((await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM sync_queue WHERE status = 'PENDIENTE'", []))?.n, 1);
  // Las tablas nuevas existen y la restricción vieja ya no: se puede repetir un código en otra hilera.
  await db.runAsync("INSERT INTO cat_rows (id, lot_id, number, plant_count, active) VALUES ('L1-H2','L1',2,100,1)", []);
  await db.runAsync("INSERT INTO cat_segments (id, row_id, code, start_plant, end_plant, is_pilot) VALUES ('L1-S2','L1-H2','SEG-01',0,50,1)", []);
  await db.runAsync("INSERT INTO cat_markers (id, row_id, segment_id, code, description, position, lat, lon) VALUES ('L1-M2','L1-H2','L1-S2','MK-01',NULL,'INICIO',NULL,NULL)", []);
  for (const tbl of ['remote_uploads', 'monitoring_cycles', 'uncovered_areas', 'session_planned_lots']) {
    const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name = ?", [tbl]);
    assert.equal(r?.n, 1, tbl);
  }
  const fk = await db.getAllAsync('PRAGMA foreign_key_check', []);
  assert.equal(fk.length, 0, JSON.stringify(fk));
  const integrity = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check', []);
  assert.equal(integrity?.integrity_check, 'ok');
  console.log('✓ Actualización 001 → 004: datos conservados, códigos repetidos permitidos, claves foráneas e integridad OK');
}
main().catch((e) => {
  console.error('✗', e);
  process.exitCode = 1;
});
