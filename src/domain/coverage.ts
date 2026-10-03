// src/domain/coverage.ts — Avance de campo por CICLO: hileras, lotes, lateral B y áreas no hechas (funciones puras).
//
// QUÉ HACE (pedido del equipo, CFG-3; ver docs/adr/0004-ciclos-y-cobertura.md):
//  1. BLOQUEO POR CICLO: un lateral "terminó correctamente" si tiene una pasada COMPLETED en cualquier
//     sesión DEL CICLO ACTUAL. Una hilera con ambos laterales COMPLETED queda BLOQUEADA; si solo falta un
//     lateral, solo ese lateral se puede elegir. Un lote con todas sus hileras completas queda bloqueado.
//     Al iniciar un ciclo nuevo (administrador) todo vuelve a estar disponible.
//  2. LATERAL B DESDE EL FINAL: la dirección de B es SIEMPRE la opuesta a la del último LATERAL A cerrado
//     (el operador da la vuelta en el extremo donde terminó A) y empieza por el segmento de ese extremo,
//     en el marcador de entrada (FIN del último segmento si va descendente).
//  3. ÁREAS NO HECHAS: al cerrar la sesión se comparan los lotes PLANIFICADOS con lo hecho y se listan
//     lotes sin trabajar, hileras sin iniciar y laterales que faltan; cada una exige un motivo.
// No toca SQLite ni la red: se prueba en __tests__/coverage.test.ts.
// INTEGRACIÓN FUTURA (Fase 4): el backend devolverá el ciclo vigente y el avance consolidado de TODOS los
// controladores; un supervisor podrá abrir ciclos y reabrir hileras desde la web. Estas funciones reciben
// esas pasadas sin cambiar las pantallas.

import type {
  Direction,
  FieldRow,
  LateralCode,
  Marker,
  MonitoringPass,
  Segment,
  UncoveredKind,
  UncoveredReason,
  UserRole,
} from './types';

type PassLite = Pick<MonitoringPass, 'lateralCode' | 'status' | 'direction'> & { endedAt?: string | null };

/** Estado de un lateral dentro de una hilera, mirando todas las sesiones. */
export type LateralState = 'PENDIENTE' | 'EN_CURSO' | 'INCOMPLETO' | 'COMPLETO';

/** Estado de una hilera para los selectores de "Nueva pasada". */
export type RowState = 'PENDIENTE' | 'FALTA_LATERAL_B' | 'FALTA_LATERAL_A' | 'COMPLETA';

export interface RowCoverage {
  rowId: string;
  state: RowState;
  laterals: Record<LateralCode, LateralState>;
  /** Laterales que todavía se pueden elegir (los COMPLETO quedan bloqueados). */
  available: LateralCode[];
  /** Lateral sugerido para la siguiente pasada (A primero), o null si la hilera está completa. */
  suggested: LateralCode | null;
  /** Dirección obligatoria del LATERAL B (opuesta a la del último LATERAL A cerrado) o null. */
  directionB: Direction | null;
}

const LATERALS: readonly LateralCode[] = ['LATERAL_A', 'LATERAL_B'];

export function oppositeDirection(d: Direction): Direction {
  return d === 'ASCENDENTE' ? 'DESCENDENTE' : 'ASCENDENTE';
}

export function lateralState(passesOfRow: PassLite[], lateral: LateralCode): LateralState {
  const own = passesOfRow.filter((p) => p.lateralCode === lateral);
  if (own.some((p) => p.status === 'COMPLETED')) return 'COMPLETO';
  if (own.some((p) => p.status === 'READY' || p.status === 'ACTIVE' || p.status === 'PAUSED')) return 'EN_CURSO';
  if (own.some((p) => p.status === 'INCOMPLETE')) return 'INCOMPLETO';
  return 'PENDIENTE';
}

/** Dirección obligatoria del LATERAL B: la opuesta a la del LATERAL A cerrado más reciente. */
export function requiredDirectionForB(passesOfRow: PassLite[]): Direction | null {
  const closedA = passesOfRow
    .filter((p) => p.lateralCode === 'LATERAL_A' && (p.status === 'COMPLETED' || p.status === 'INCOMPLETE'))
    // Se prefiere la última pasada COMPLETED; si no hay, la última INCOMPLETE.
    .sort((x, y) => {
      if (x.status !== y.status) return x.status === 'COMPLETED' ? 1 : -1;
      return (x.endedAt ?? '').localeCompare(y.endedAt ?? '');
    });
  const last = closedA[closedA.length - 1];
  return last ? oppositeDirection(last.direction) : null;
}

export function rowCoverage(rowId: string, passesOfRow: PassLite[]): RowCoverage {
  const laterals = {
    LATERAL_A: lateralState(passesOfRow, 'LATERAL_A'),
    LATERAL_B: lateralState(passesOfRow, 'LATERAL_B'),
  };
  const available = LATERALS.filter((l) => laterals[l] !== 'COMPLETO');
  const aDone = laterals.LATERAL_A === 'COMPLETO';
  const bDone = laterals.LATERAL_B === 'COMPLETO';
  const state: RowState = aDone && bDone ? 'COMPLETA' : aDone ? 'FALTA_LATERAL_B' : bDone ? 'FALTA_LATERAL_A' : 'PENDIENTE';
  // Sugerencia: A primero. Si A ya está cerrado (completo, o incompleto con B pendiente) se sigue con B;
  // un A incompleto con B ya completo se sugiere como repetición de A.
  let suggested: LateralCode | null;
  if (state === 'COMPLETA') suggested = null;
  else if (aDone) suggested = 'LATERAL_B';
  else if (laterals.LATERAL_A === 'INCOMPLETO' && !bDone) suggested = 'LATERAL_B';
  else suggested = 'LATERAL_A';
  return { rowId, state, laterals, available, suggested, directionB: requiredDirectionForB(passesOfRow) };
}

export interface LotCoverage {
  lotId: string;
  totalRows: number;
  completeRows: number;
  complete: boolean;
}

export function lotCoverage(
  lotId: string,
  rows: Pick<FieldRow, 'id' | 'active'>[],
  coverageByRow: Map<string, RowCoverage>,
): LotCoverage {
  const active = rows.filter((r) => r.active);
  const completeRows = active.filter((r) => coverageByRow.get(r.id)?.state === 'COMPLETA').length;
  return { lotId, totalRows: active.length, completeRows, complete: active.length > 0 && completeRows === active.length };
}

// ------------------------------------------------------------------ segmentos en orden de recorrido

/** Segmentos de la hilera en el orden en que se caminan según la dirección. */
export function segmentsInWalkOrder(segments: Segment[], direction: Direction): Segment[] {
  const asc = [...segments].sort((a, b) => a.startPlant - b.startPlant || a.code.localeCompare(b.code));
  return direction === 'ASCENDENTE' ? asc : asc.reverse();
}

/** Marcador del extremo por donde se ENTRA al segmento (INICIO si ascendente, FIN si descendente). */
export function entryMarkerOf(segment: Segment, markers: Marker[], direction: Direction): Marker | null {
  const own = markers.filter((m) => m.segmentId === segment.id);
  const wanted = direction === 'ASCENDENTE' ? 'INICIO' : 'FIN';
  return own.find((m) => m.position === wanted) ?? own[0] ?? null;
}

/** Punto de partida de una pasada: primer segmento en el orden de recorrido y su marcador de entrada. */
export function startPointOf(
  segments: Segment[],
  markers: Marker[],
  direction: Direction,
): { segment: Segment | null; marker: Marker | null } {
  const first = segmentsInWalkOrder(segments, direction)[0];
  if (!first) {
    // Hilera sin segmentos: el primer marcador de entrada disponible.
    const pos = direction === 'ASCENDENTE' ? 'INICIO' : 'FIN';
    return { segment: null, marker: markers.find((m) => m.position === pos) ?? markers[0] ?? null };
  }
  return { segment: first, marker: entryMarkerOf(first, markers, direction) };
}

// ------------------------------------------------------------------ plan de la sesión y áreas no hechas

type RuleResult = { ok: true } | { ok: false; code: string };
const OK: RuleResult = { ok: true };

/** Valida los lotes elegidos en "Nueva sesión": al menos uno y ninguno ya completo en el ciclo. */
export function validatePlannedLots(selected: string[], completeLotIds: ReadonlySet<string>): RuleResult {
  if (selected.length === 0) return { ok: false, code: 'PLAN_LOTE_REQUERIDO' };
  if (selected.some((id) => completeLotIds.has(id))) return { ok: false, code: 'LOTE_COMPLETO' };
  return OK;
}

/** Una pasada solo puede ir en un lote planificado en la sesión. */
export function validateLotInPlan(lotId: string, plannedLotIds: readonly string[]): RuleResult {
  return plannedLotIds.includes(lotId) ? OK : { ok: false, code: 'LOTE_NO_PLANIFICADO' };
}

/** Iniciar un ciclo nuevo libera todo lo bloqueado: solo ADMINISTRADOR (y SUPERVISOR desde la web) y sin sesión abierta. */
export function canStartNewCycle(roles: readonly UserRole[], hasOpenSession: boolean): RuleResult {
  if (!roles.includes('ADMINISTRADOR') && !roles.includes('SUPERVISOR')) return { ok: false, code: 'CICLO_SOLO_ADMIN' };
  if (hasOpenSession) return { ok: false, code: 'SESION_ABIERTA_IMPIDE_CICLO' };
  return OK;
}

/** Un área planificada que no quedó terminada al cerrar la sesión. */
export interface PendingArea {
  /** Clave estable para asociar el motivo elegido en pantalla. */
  key: string;
  kind: UncoveredKind;
  lotId: string;
  /** LOTE: hileras pendientes del lote · HILERA: hileras sin iniciar en la sesión · LATERAL: [la hilera]. */
  rowIds: string[];
  lateral: LateralCode | null;
}

export interface PendingAreasInput {
  plannedLotIds: readonly string[];
  /** Hileras de cada lote planificado (del catálogo). */
  rowsByLot: ReadonlyMap<string, Pick<FieldRow, 'id' | 'number' | 'active'>[]>;
  /** Pasadas del CICLO (todas las sesiones, incluida la actual) agrupadas por hilera. */
  cyclePassesByRow: ReadonlyMap<string, PassLite[]>;
  /** Pasadas de ESTA sesión (para saber qué hileras se trabajaron hoy). */
  sessionPasses: Pick<MonitoringPass, 'lotId' | 'rowId'>[];
}

/**
 * Áreas planificadas que quedan sin terminar en el ciclo al cerrar la sesión:
 *  - LOTE: lote planificado en el que no se hizo ninguna pasada en la sesión (y que no está completo).
 *  - LATERAL: hilera trabajada en la sesión a la que le falta un lateral (un ítem por lateral).
 *  - HILERA: hileras del lote trabajado que no se iniciaron en la sesión (un solo ítem agrupado).
 * Lo que ya estaba completo por sesiones anteriores del ciclo no se pide.
 */
export function pendingAreasOfSession(input: PendingAreasInput): PendingArea[] {
  const out: PendingArea[] = [];
  for (const lotId of input.plannedLotIds) {
    const rows = [...(input.rowsByLot.get(lotId) ?? [])].filter((r) => r.active).sort((a, b) => a.number - b.number);
    const cov = rows.map((r) => rowCoverage(r.id, input.cyclePassesByRow.get(r.id) ?? []));
    const pending = cov.filter((c) => c.state !== 'COMPLETA');
    if (pending.length === 0) continue;
    const touched = new Set(input.sessionPasses.filter((p) => p.lotId === lotId).map((p) => p.rowId));
    if (touched.size === 0) {
      out.push({ key: `LOTE:${lotId}`, kind: 'LOTE', lotId, rowIds: pending.map((c) => c.rowId), lateral: null });
      continue;
    }
    for (const c of pending) {
      if (!touched.has(c.rowId)) continue;
      for (const l of LATERALS) {
        if (c.laterals[l] !== 'COMPLETO') {
          out.push({ key: `LATERAL:${c.rowId}:${l}`, kind: 'LATERAL', lotId, rowIds: [c.rowId], lateral: l });
        }
      }
    }
    const untouched = pending.filter((c) => !touched.has(c.rowId)).map((c) => c.rowId);
    if (untouched.length > 0) out.push({ key: `HILERA:${lotId}`, kind: 'HILERA', lotId, rowIds: untouched, lateral: null });
  }
  return out;
}

/** Motivo elegido para un área (la nota es obligatoria con OTRO). */
export interface AreaReason {
  reason: UncoveredReason | null;
  note: string;
}

/** Todas las áreas pendientes deben tener motivo; "Otro" exige describirlo (≥ 3 caracteres). */
export function validateAreaReasons(
  areas: readonly PendingArea[],
  reasons: Readonly<Record<string, AreaReason | undefined>>,
): RuleResult {
  for (const a of areas) {
    const r = reasons[a.key];
    if (!r || !r.reason) return { ok: false, code: 'MOTIVO_AREA_REQUERIDO' };
    if (r.reason === 'OTRO' && r.note.trim().length < 3) return { ok: false, code: 'MOTIVO_AREA_REQUERIDO' };
  }
  return OK;
}

/** Números de hilera en rangos compactos: [1,2,3,5,7,8] → "1–3, 5, 7–8". */
export function formatRanges(numbers: readonly number[]): string {
  const n = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    parts.push(i === j ? `${n[i]}` : `${n[i]}–${n[j]}`);
    i = j;
  }
  return parts.join(', ');
}
