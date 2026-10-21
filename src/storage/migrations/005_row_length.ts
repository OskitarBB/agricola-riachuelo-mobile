// src/storage/migrations/005_row_length.ts — Largo de la hilera en metros (v0.6.0; plataforma v1.4, ADR-W-010).
//
// QUÉ HACE: agrega cat_rows.length_m (REAL, NULL si la web no lo tiene). Solo una columna nueva: los catálogos se
// reemplazan completos en cada «Actualizar», así que no hay datos que convertir.
// REGLA: nunca modificar una migración publicada (12.2).

export const MIGRATION_005 = `
-- Migración 005 (v0.6.0): largo aproximado de la hilera (metros) para mostrar los metros de cada segmento.
ALTER TABLE cat_rows ADD COLUMN length_m REAL;
`;
