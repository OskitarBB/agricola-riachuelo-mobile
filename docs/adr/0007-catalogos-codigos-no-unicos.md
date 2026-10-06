# ADR 0007 — Catálogos con códigos repetidos entre hileras (migración 004) y registro de migraciones

**Estado:** aceptado · **Fecha:** 2026-10-06 · **Versión:** v0.4.0

## Contexto
- La migración 001 declaraba `cat_segments.code` y `cat_markers.code` como **UNIQUE** en todo el catálogo.
- En la plataforma (campo/models.py) el código de un segmento o marcador **no es único**: se repite entre hileras
  (p. ej. `SEG-01` o `MK-01-I` en cada hilera, como en el ejemplo del maestro §15.4). Lo único es su `id`.
- Con el catálogo real, `replaceCatalogs()` fallaba al insertar el segundo código repetido y el controlador se
  quedaba sin catálogos (sin catálogos no se puede crear una sesión: CATALOGOS_FALTANTES).
- Además, `db.ts` solo registraba la migración 001: la 002 (ciclos, CFG-3) estaba escrita pero no se aplicaba y la
  003 (`remote_uploads`, maestro v2.0 §12.1.1) faltaba.

## Decisión
- **Migración 004** (nunca se modifica una migración publicada, §12.2): recrea `cat_segments` y `cat_markers` sin
  UNIQUE en `code`, **conservando sus filas** (un celular sin internet no pierde sus catálogos), acepta
  `start_plant = 0` (PositiveIntegerField en el servidor) y crea índices por `(row_id, code)`.
- `MIGRATIONS = [001, 002, 003, 004]`. La 002 solo agrega tablas y una columna (segura en instalaciones con datos).
- `PRAGMA user_version` pasa a 4 en todos los celulares al abrir la v0.4.0.

## Consecuencias
- Los selectores de PANT-15/17 ya ordenaban y filtraban por `row_id`, así que no cambian.
- Verificado con la base real del simulador del piloto (3 lotes, 83 hileras) y con un catálogo con códigos repetidos
  (`docs/evidencias/fase4_integracion.md`).
