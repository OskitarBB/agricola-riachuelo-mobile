// src/device/stabilityDetector.ts — Detector de estabilidad de la cámara (acelerómetro + giroscopio).
//
// QUÉ HACE: decide si el celular está QUIETO para que la captura AUTOMÁTICA solo dispare con la cámara
// estable (pedido del equipo, CFG-2). Analiza una ventana deslizante (capture.stability.windowMs):
//   - giro máximo (rad/s) del giroscopio  ≤ gyroMaxRadS
//   - desviación estándar de |aceleración| (g) ≤ accelStdMaxG
// y exige que la condición se mantenga holdMs seguidos. waitForStable() espera hasta maxWaitMs.
// Si el celular no tiene sensores (emulador), se considera estable para no bloquear el trabajo.
// Los umbrales son iniciales: CALIBRAR en campo con el soporte de hombros (Fase 6).

import { Accelerometer, Gyroscope } from 'expo-sensors';

import { CONFIG } from '../config';

export interface StabilityState {
  stable: boolean;
  /** 0 (mucho movimiento) … 1 (totalmente quieto), para el indicador visual. */
  score: number;
  gyroRadS: number;
  accelStdG: number;
  available: boolean;
}

type Listener = (s: StabilityState) => void;

interface Sample {
  t: number;
  v: number;
}

class StabilityDetector {
  private refs = 0;
  private accel: Sample[] = [];
  private gyro: Sample[] = [];
  private subs: { remove(): void }[] = [];
  private listeners = new Set<Listener>();
  private stableSince: number | null = null;
  private available = true;
  private state: StabilityState = { stable: false, score: 0, gyroRadS: 0, accelStdG: 0, available: true };

  /** Empieza a leer sensores (con conteo de referencias: varias pantallas pueden usarlo). */
  async start(): Promise<void> {
    this.refs++;
    if (this.refs > 1) return;
    const cfg = CONFIG.capture.stability;
    const [accOk, gyrOk] = await Promise.all([
      Accelerometer.isAvailableAsync().catch(() => false),
      Gyroscope.isAvailableAsync().catch(() => false),
    ]);
    this.available = accOk || gyrOk;
    if (!this.available) {
      this.state = { stable: true, score: 1, gyroRadS: 0, accelStdG: 0, available: false };
      this.emit();
      return;
    }
    if (accOk) {
      Accelerometer.setUpdateInterval(cfg.sampleIntervalMs);
      this.subs.push(
        Accelerometer.addListener(({ x, y, z }) => {
          this.push(this.accel, Math.sqrt(x * x + y * y + z * z));
          this.evaluate();
        }),
      );
    }
    if (gyrOk) {
      Gyroscope.setUpdateInterval(cfg.sampleIntervalMs);
      this.subs.push(
        Gyroscope.addListener(({ x, y, z }) => {
          this.push(this.gyro, Math.sqrt(x * x + y * y + z * z));
        }),
      );
    }
  }

  stop(): void {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs > 0) return;
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.accel = [];
    this.gyro = [];
    this.stableSince = null;
  }

  private push(buf: Sample[], v: number): void {
    const now = Date.now();
    buf.push({ t: now, v });
    const limit = now - CONFIG.capture.stability.windowMs;
    while (buf.length > 0 && buf[0].t < limit) buf.shift();
  }

  private evaluate(): void {
    const cfg = CONFIG.capture.stability;
    const gyroMax = this.gyro.reduce((m, s) => Math.max(m, s.v), 0);
    const n = this.accel.length;
    const mean = n ? this.accel.reduce((a, s) => a + s.v, 0) / n : 0;
    const std = n ? Math.sqrt(this.accel.reduce((a, s) => a + (s.v - mean) ** 2, 0) / n) : 0;
    const instantStable = n >= 3 && gyroMax <= cfg.gyroMaxRadS && std <= cfg.accelStdMaxG;
    const now = Date.now();
    if (instantStable) this.stableSince = this.stableSince ?? now;
    else this.stableSince = null;
    const stable = this.stableSince !== null && now - this.stableSince >= cfg.holdMs;
    const ratio = Math.max(gyroMax / cfg.gyroMaxRadS, std / cfg.accelStdMaxG);
    const score = Math.max(0, Math.min(1, 1.5 - ratio));
    this.state = { stable, score, gyroRadS: gyroMax, accelStdG: std, available: true };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l(this.state));
  }

  current(): StabilityState {
    return this.state;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => this.listeners.delete(l);
  }

  /** Espera a que la cámara esté quieta; devuelve false si no lo logra en maxWaitMs. */
  waitForStable(maxWaitMs: number = CONFIG.capture.stability.maxWaitMs): Promise<boolean> {
    if (!this.available || this.state.stable) return Promise.resolve(true);
    if (this.refs === 0) return Promise.resolve(true); // sin sensores activos no se bloquea
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(false);
      }, maxWaitMs);
      const unsub = this.subscribe((s) => {
        if (s.stable) {
          clearTimeout(timer);
          unsub();
          resolve(true);
        }
      });
    });
  }
}

export const stabilityDetector = new StabilityDetector();
