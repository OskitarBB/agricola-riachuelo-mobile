// src/controller/cameraMonitor.ts — Monitor de enlace y desfase de reloj de las cámaras (maestro §14.9, RF-42).
//
// QUÉ HACE (funciones puras usadas por controllerRuntime en cada heartbeat):
//  - linkFromSilence(): sin respuesta > unstableAfterMs → INESTABLE; > lostAfterMs → PERDIDA.
//  - clockOffsetSample(): desfase = sentAt_cámara − (echoSentAt + RTT/2); se guarda la mediana de las
//    últimas protocol.clockOffsetSamples mediciones (session_devices.clock_offset_ms).

import { median } from '../domain/rules';
import type { CameraLinkStatus } from '../domain/types';

export function linkFromSilence(
  current: CameraLinkStatus,
  silenceMs: number,
  cfg: { unstableAfterMs: number; lostAfterMs: number },
): CameraLinkStatus {
  if (current !== 'CONECTADA' && current !== 'INESTABLE') return current;
  if (silenceMs > cfg.lostAfterMs) return 'PERDIDA';
  if (silenceMs > cfg.unstableAfterMs) return 'INESTABLE';
  return 'CONECTADA';
}

/** Una medición de desfase a partir de la respuesta HEARTBEAT de la cámara. */
export function clockOffsetSample(
  echoSentAtMs: number,
  cameraSentAtMs: number,
  receivedAtMs: number,
): { offsetMs: number; rttMs: number } {
  const rtt = Math.max(0, receivedAtMs - echoSentAtMs);
  return { offsetMs: Math.round(cameraSentAtMs - (echoSentAtMs + rtt / 2)), rttMs: rtt };
}

export function pushSample(samples: number[], value: number, max: number): number[] {
  const next = [...samples, value];
  while (next.length > max) next.shift();
  return next;
}

export function offsetMedian(samples: number[]): number | null {
  const m = median(samples);
  return m === null ? null : Math.round(m);
}
