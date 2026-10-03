// src/api/mock/pilotRows.ts — Hileras y plantas por hilera de los lotes del piloto, tomadas del archivo
// «MAPEO CHANCHITO MOLINOS actualizado» (columna «N° ptas» de cada hoja). Maestro, Anexo D.
// Datos para el backend simulado; los códigos y nombres deben validarse con la empresa (pregunta Q-01).

import type { FieldRow, Lot } from '../../domain/types';

/** Posición i del arreglo = hilera i + 1. */
export const PILOT_PLANTS_PER_ROW: Record<'SWG1' | 'SWG2' | 'SWG5', readonly number[]> = {
  SWG1: [
    383, 384, 381, 384, 385, 386, 384, 385, 386, 384, 388, 388, 391, 382, 275, 275, 274, 273, 273, 273, 272, 270, 268, 270, 269,
    269, 268, 268, 267, 266, 265,
  ],
  SWG2: [251, 260, 267, 273, 279, 286, 292, 299, 307, 313, 319, 326, 332, 339, 347, 351],
  SWG5: [
    11, 19, 25, 33, 40, 47, 54, 62, 68, 75, 84, 91, 97, 104, 111, 118, 126, 132, 138, 146, 154, 161, 168, 174, 181, 188, 194, 200,
    207, 213, 220, 223, 233, 239, 246, 250,
  ],
};

export const PILOT_LOTS: Lot[] = [
  { id: 'SWG1', code: 'SWG 1', name: 'Lote 1 (Piscina)', active: true },
  { id: 'SWG2', code: 'SWG 2', name: 'Lote 2 (Maíz)', active: true },
  { id: 'SWG5', code: 'SWG 5', name: 'Lote 5 (Triángulo)', active: true },
];

export function buildPilotRows(): FieldRow[] {
  const rows: FieldRow[] = [];
  for (const lot of PILOT_LOTS) {
    const plants = PILOT_PLANTS_PER_ROW[lot.id as keyof typeof PILOT_PLANTS_PER_ROW];
    plants.forEach((plantCount, i) => {
      const number = i + 1;
      rows.push({ id: `${lot.id}-H${String(number).padStart(2, '0')}`, lotId: lot.id, number, plantCount, active: true });
    });
  }
  return rows;
}
