// src/config/defaults.ts — Parámetros configurables de la app (versión CFG-2).
//
// QUÉ HACE: concentra TODOS los umbrales, tiempos, puertos e intervalos (regla R-08 del maestro:
// ningún número "suelto" en el código). Los servicios leen estos valores a través de src/config/index.ts.
//
// CAMBIOS CFG-1 → CFG-2 (registrar en la sección 25 del maestro):
//  - capture.defaultMode ya no admite 'MIXTO' (modo eliminado de la interfaz, contexto §25.1).
//  - capture.stability.*: NUEVO. Detector de estabilidad para que la captura AUTOMÁTICA solo se tome
//    con el celular quieto (pedido del equipo, 02/10/2026). Valores iniciales: CALIBRAR en campo.
//  - protocol.captureResponseTimeoutMs: 7 000 → 8 000 ms para incluir la espera de estabilidad.
//  - ui.*: NUEVO. Sonidos y vibración de los botones.
//
// Los valores marcados "calibrar" son iniciales: se ajustan con mediciones y NO son resultados validados.

export const CONFIG_VERSION = 'CFG-2';

export interface AppConfig {
  auth: {
    offlineLoginMaxDays: number; // ventana para entrar sin internet desde la última validación online
    offlineMaxFailedAttempts: number; // intentos fallidos antes del bloqueo temporal (solo login sin internet)
    offlineLockoutMinutes: number;
    pbkdf2Iterations: number; // calibrar: objetivo ≤ 1,5 s en el celular más lento del piloto
    passwordMinLength: number;
    refreshMarginSeconds: number; // renovar el access token si vence en menos de este margen
  };
  catalog: {
    bootstrapWarnAgeHours: number; // advertir si los catálogos son más antiguos
  };
  pairing: {
    controlPort: number;
    filePort: number;
    /** RN-17: src/config/index.ts lo fija en true cuando ENV.appEnv === 'piloto'. */
    requireSameAppVersion: boolean;
    pairingTokenBytes: number;
  };
  protocol: {
    version: 1;
    heartbeatIntervalMs: number;
    unstableAfterMs: number; // sin heartbeat → INESTABLE
    lostAfterMs: number; // sin heartbeat → PERDIDA y pausa
    reconnectDelaysMs: number[]; // esperas de la cámara entre intentos de reconexión
    commandValidityMs: number; // vigencia de CAPTURE_COMMAND
    captureResponseTimeoutMs: number; // espera de CAPTURE_OK / QUALITY_ERROR
    ackTimeoutMs: number; // espera de ACK de los mensajes que lo requieren
    ackMaxRetries: number; // reenvíos con el mismo messageId antes de considerar el enlace PERDIDA
    resyncPageSize: number; // capturas por mensaje RESYNC_STATE
    clockOffsetSamples: number; // mediciones usadas para la mediana del desfase de reloj
    processedMessagesTtlHours: number;
    maxMessageBytes: number;
  };
  capture: {
    defaultMode: 'MANUAL' | 'AUTOMATICO';
    intervalMs: number; // calibrar
    minIntervalMs: number;
    maxIntervalMs: number;
    /** Opciones que la pantalla "Nueva sesión" ofrece para el intervalo automático. */
    intervalOptionsMs: number[];
    jpegQuality: number; // 0..1
    shutterSound: boolean;
    captureBudgetMs: number; // tiempo previsto para tomar, mover y calcular el md5 de la foto
    /** Detector de estabilidad (acelerómetro + giroscopio). Solo bloquea la captura AUTOMÁTICA. */
    stability: {
      sampleIntervalMs: number; // frecuencia de lectura de sensores
      windowMs: number; // ventana deslizante analizada
      gyroMaxRadS: number; // calibrar: giro máximo permitido (rad/s)
      accelStdMaxG: number; // calibrar: desviación estándar máxima de la aceleración (g)
      holdMs: number; // tiempo continuo "quieto" exigido antes de disparar
      maxWaitMs: number; // espera máxima por estabilidad antes de declarar CAMARA_EN_MOVIMIENTO
    };
  };
  shortTest: {
    timeoutMs: number; // límite de la prueba corta por cámara (captura + calidad + transferencia + ACK)
  };
  quality: {
    profileVersion: string;
    timeoutMs: number; // si se supera: PENDIENTE_REVISION_TECNICA
    exposure: {
      analysisWidth: number;
      darkLevel: number; // luminancia 0..255 considerada "casi negra"
      brightLevel: number; // luminancia 0..255 considerada "saturada"
      minMean: number; // calibrar
      maxMean: number; // calibrar
      maxDarkRatio: number; // calibrar
      maxBrightRatio: number; // calibrar
    };
    sharpness: {
      regionSize: number; // lado del recorte en píxeles de la foto original
      regionCount: 1 | 2 | 3; // recortes sobre la línea media horizontal
      minLaplacianVariance: number; // calibrar
    };
  };
  transfer: {
    maxConcurrentPerCamera: number;
    retryDelaysMs: number[];
    retryMaxDelayMs: number;
    requestTimeoutMs: number;
    includeRejected: boolean; // transferir también fotos rechazadas (después de las útiles)
    maxChecksumRetries: number; // MD5_MISMATCH / SIZE_MISMATCH antes de ERROR_LOCAL
  };
  sync: {
    maxConcurrent: number;
    retryDelaysMs: number[];
    requestTimeoutMs: number;
    healthPath: string; // relativo a la base `${EXPO_PUBLIC_API_URL}/api/v1`
    batchSize: number; // secuencias o incidencias por petición
  };
  gps: {
    timeIntervalMs: number;
    distanceIntervalM: number;
    maxAgeMs: number; // lectura más antigua no se asocia a la secuencia
    warnAccuracyM: number; // calibrar
  };
  device: {
    minBatteryToStartPct: number;
    warnBatteryPct: number;
    pauseBatteryPct: number;
    warnFreeSpaceBytes: number;
    minFreeSpaceToStartBytes: number;
    pauseFreeSpaceBytes: number;
    /** Cada cuánto se leen batería y espacio en las pantallas de trabajo. */
    statusPollMs: number;
  };
  retention: {
    /** TRAS_SINCRONIZACION: la cámara borra sus copias con ACK de sesiones que el controlador informa SINCRONIZADAS. */
    cameraPolicy: 'CONSERVAR' | 'TRAS_SINCRONIZACION';
    /** CONSERVAR: el controlador solo libera espacio por acción manual y solo de sesiones SINCRONIZADAS. */
    controllerPolicy: 'CONSERVAR' | 'TRAS_SINCRONIZACION';
  };
  logging: {
    eventLogMaxDays: number;
  };
  ui: {
    soundsEnabledByDefault: boolean;
    hapticsEnabledByDefault: boolean;
    toastDurationMs: number;
  };
  simulator: {
    /** Demora simulada de cada cámara virtual al conectarse tras mostrar el QR. */
    connectDelayMs: number;
    /** Probabilidad (0..1) de que una cámara virtual tome una foto oscura o borrosa. */
    qualityErrorRate: number;
    /** Probabilidad (0..1) de que una cámara virtual reporte movimiento en modo automático. */
    movementRate: number;
    /** Demora simulada de la captura en la cámara virtual. */
    captureDelayMs: number;
    /** Demora simulada de la transferencia de la foto al controlador. */
    transferDelayMs: number;
  };
}

const GB = 1024 * 1024 * 1024;

export const DEFAULT_CONFIG: AppConfig = {
  auth: {
    offlineLoginMaxDays: 7,
    offlineMaxFailedAttempts: 5,
    offlineLockoutMinutes: 15,
    pbkdf2Iterations: 40_000,
    passwordMinLength: 8,
    refreshMarginSeconds: 60,
  },
  catalog: { bootstrapWarnAgeHours: 72 },
  pairing: { controlPort: 8765, filePort: 8766, requireSameAppVersion: false, pairingTokenBytes: 16 },
  protocol: {
    version: 1,
    heartbeatIntervalMs: 2_000,
    unstableAfterMs: 3_000,
    lostAfterMs: 6_000,
    reconnectDelaysMs: [1_000, 2_000, 4_000, 8_000],
    commandValidityMs: 3_000,
    captureResponseTimeoutMs: 8_000,
    ackTimeoutMs: 2_000,
    ackMaxRetries: 3,
    resyncPageSize: 200,
    clockOffsetSamples: 5,
    processedMessagesTtlHours: 24,
    maxMessageBytes: 64 * 1024,
  },
  capture: {
    defaultMode: 'MANUAL',
    intervalMs: 2_000,
    minIntervalMs: 1_000,
    maxIntervalMs: 10_000,
    intervalOptionsMs: [1_000, 2_000, 3_000, 5_000],
    jpegQuality: 1,
    shutterSound: false,
    captureBudgetMs: 2_000,
    stability: {
      sampleIntervalMs: 50,
      windowMs: 600,
      gyroMaxRadS: 0.12,
      accelStdMaxG: 0.025,
      holdMs: 350,
      maxWaitMs: 1_200,
    },
  },
  shortTest: { timeoutMs: 15_000 },
  quality: {
    profileVersion: 'Q0',
    timeoutMs: 4_000,
    exposure: {
      analysisWidth: 256,
      darkLevel: 20,
      brightLevel: 245,
      minMean: 50,
      maxMean: 205,
      maxDarkRatio: 0.4,
      maxBrightRatio: 0.2,
    },
    sharpness: { regionSize: 512, regionCount: 3, minLaplacianVariance: 100 },
  },
  transfer: {
    maxConcurrentPerCamera: 1,
    retryDelaysMs: [2_000, 4_000, 8_000, 16_000],
    retryMaxDelayMs: 30_000,
    requestTimeoutMs: 30_000,
    includeRejected: true,
    maxChecksumRetries: 3,
  },
  sync: {
    maxConcurrent: 1,
    retryDelaysMs: [60_000, 300_000, 900_000, 3_600_000],
    requestTimeoutMs: 60_000,
    healthPath: '/health',
    batchSize: 200,
  },
  gps: { timeIntervalMs: 1_000, distanceIntervalM: 0, maxAgeMs: 10_000, warnAccuracyM: 15 },
  device: {
    minBatteryToStartPct: 30,
    warnBatteryPct: 25,
    pauseBatteryPct: 15,
    warnFreeSpaceBytes: 3 * GB,
    minFreeSpaceToStartBytes: 2 * GB,
    pauseFreeSpaceBytes: 1 * GB,
    statusPollMs: 15_000,
  },
  retention: { cameraPolicy: 'TRAS_SINCRONIZACION', controllerPolicy: 'CONSERVAR' },
  logging: { eventLogMaxDays: 30 },
  ui: { soundsEnabledByDefault: true, hapticsEnabledByDefault: true, toastDurationMs: 2_800 },
  simulator: {
    connectDelayMs: 1_200,
    qualityErrorRate: 0.12,
    movementRate: 0.05,
    captureDelayMs: 350,
    transferDelayMs: 450,
  },
};

/**
 * Reglas de coherencia (maestro §17). Devuelve la lista de reglas que NO se cumplen.
 * Se prueba en __tests__/config.test.ts: un cambio que rompa una regla no se acepta.
 */
export function checkConfigCoherence(cfg: AppConfig): string[] {
  const errors: string[] = [];
  const p = cfg.protocol;
  const autoBudget = cfg.capture.stability.maxWaitMs + cfg.capture.captureBudgetMs + cfg.quality.timeoutMs + 500;
  if (p.captureResponseTimeoutMs < autoBudget) errors.push('captureResponseTimeoutMs < estabilidad + captura + calidad + 500');
  if (p.commandValidityMs >= p.captureResponseTimeoutMs) errors.push('commandValidityMs ≥ captureResponseTimeoutMs');
  if (cfg.shortTest.timeoutMs <= p.captureResponseTimeoutMs) errors.push('shortTest.timeoutMs ≤ captureResponseTimeoutMs');
  if (p.ackTimeoutMs >= p.lostAfterMs) errors.push('ackTimeoutMs ≥ lostAfterMs');
  const d = cfg.device;
  if (!(d.pauseBatteryPct < d.warnBatteryPct && d.warnBatteryPct < d.minBatteryToStartPct))
    errors.push('batería: pausa < aviso < inicio');
  if (!(d.pauseFreeSpaceBytes < d.minFreeSpaceToStartBytes && d.minFreeSpaceToStartBytes < d.warnFreeSpaceBytes)) {
    errors.push('espacio: pausa < inicio < aviso');
  }
  const c = cfg.capture;
  if (c.intervalOptionsMs.some((v) => v < c.minIntervalMs || v > c.maxIntervalMs))
    errors.push('intervalOptionsMs fuera de límites');
  if (c.intervalMs < c.minIntervalMs || c.intervalMs > c.maxIntervalMs) errors.push('intervalMs fuera de límites');
  if (!cfg.sync.healthPath.startsWith('/')) errors.push('healthPath debe empezar con /');
  // Una página de RESYNC_STATE (≈ 220 bytes por captura) debe caber en maxMessageBytes.
  if (p.resyncPageSize * 220 + 512 > p.maxMessageBytes) errors.push('resyncPageSize no cabe en maxMessageBytes');
  return errors;
}
