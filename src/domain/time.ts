// src/domain/time.ts — Reloj del dominio (R-13: fechas ISO-8601 UTC con toISOString()).
//
// QUÉ HACE: todas las capas piden la hora a nowIso()/nowMs(). En pruebas se puede fijar un reloj
// falso con setClock() para verificar vencimientos (órdenes, bloqueo de login, ventana sin internet).

export type Clock = () => number;

let clock: Clock = () => Date.now();

export function setClock(c: Clock): void {
  clock = c;
}

export function nowMs(): number {
  return clock();
}

export function nowIso(): string {
  return new Date(clock()).toISOString();
}

export function addMsIso(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function ageMs(iso: string | null, now: number = clock()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

/** Fecha y hora legibles para el operador (Perú, 24 h). */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Duración en "mm:ss" o "h:mm:ss". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
