// src/config/defaults.ts — Parámetros configurables de la app (versión CFG-5).
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
// CAMBIOS CFG-2 → CFG-4 (Fase 4, maestro v2.0 §17; CFG-3 —ciclos— no cambió parámetros):
//  - sync.uploadRequestTimeoutMs, maxUploadBytes, maxReuploads, ticketMinRemainingMs, maxTicketRequests:
//    subida directa de cada foto a Cloudinary con el ticket firmado por Django (§15.7). Valores del maestro.
//  - sync.uploadMode (Supuesto S-07): 'TICKET' (v2.0, la foto va directo a Cloudinary) o 'MULTIPART' (v1, la
//    foto pasa por Django; solo si el servidor tiene API_SUBIDA_MULTIPART=true). Por defecto TICKET.
//  - sync.autoSync / sync.autoSyncWifiOnly (Supuesto S-08): sincronizar solo, con la app abierta, cuando
//    vuelve el internet y no hay sesión de monitoreo abierta. Por defecto solo con Wi-Fi (fotos de ~4 MB).
//  - sync.maxConsecutiveFailures (Supuesto S-08): fallos seguidos del servidor que detienen una ronda.
//  - sync.autoSyncIntervalMs (Supuesto S-08): revisión periódica de la cola con la app abierta (5 min).
//  - auth.clockSkewWarnSeconds: los vencimientos de los tokens se miden con la hora del servidor (serverTime de login,
//    refresh y health); si el reloj del celular difiere más que esto, se registra NET/SERVER_CLOCK_OFFSET.
//
// CAMBIOS CFG-4 → CFG-5 (primera prueba con tres Android, 07/10/2026; maestro Q-15 y riesgo «fotos demasiado grandes»):
//  - capture.maxMegapixels: NUEVO (12). Sin límite, Android toma la foto a la resolución máxima del sensor (50 MP o
//    más): la prueba corta tardó 18,5 s en llegar al controlador y esas fotos superan Cloudinary Free (10 MB, 25 MP).
//    Se elige la mayor resolución ≤ 12 MP, preferiblemente 4:3 (src/domain/pictureSize.ts). La foto NO se recomprime.
//  - shortTest.timeoutMs: 15 000 → 20 000 ms (calibrar): margen para dos fotos de 12 MP por el mismo Wi-Fi.
//
// Los valores marcados "calibrar" son iniciales: se ajustan con mediciones y NO son resultados validados.

export const CONFIG_VERSION = 'CFG-5';

export interface AppConfig {
  auth: {
    offlineLoginMaxDays: number; // ventana para entrar sin internet desde la última validación online
    offlineMaxFailedAttempts: number; // intentos fallidos antes del bloqueo temporal (solo login sin internet)
    offlineLockoutMinutes: number;
    pbkdf2Iterations: number; // calibrar: objetivo ≤ 1,5 s en el celular más lento del piloto
    passwordMinLength: number;
    refreshMarginSeconds: number; // renovar el access token si vence en menos de este margen
    clockSkewWarnSeconds: number; // diferencia con la hora del servidor que se registra como aviso (diagnóstico)
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
    /** Resolución máxima de la foto en megapíxeles (Q-15): se elige la mayor disponible ≤ este valor. */
    maxMegapixels: number;
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
    // ---- v2.0: subida directa a Cloudinary (sección 15.7)
    uploadRequestTimeoutMs: number; // tiempo máximo de la subida de una foto a Cloudinary
    maxUploadBytes: number; // límite por imagen del plan Free de Cloudinary (10 MB); mayor → FOTO_DEMASIADO_GRANDE
    maxReuploads: number; // subidas repetidas permitidas cuando Django rechaza la subida (REPETIR_SUBIDA)
    ticketMinRemainingMs: number; // vigencia mínima que debe quedarle al ticket para empezar a subir
    maxTicketRequests: number; // tickets por intento (ticket casi vencido o rechazado por Cloudinary)
    // ---- Supuestos S-07 y S-08 (ver docs/adr/0006-fase4-sincronizacion.md)
    /** TICKET = v2.0 (ticket + Cloudinary + confirmación JSON). MULTIPART = v1 (Django sube la foto). */
    uploadMode: 'TICKET' | 'MULTIPART';
    /** Sincronizar solo al volver el internet (app abierta, controlador, sin sesión de monitoreo abierta). */
    autoSync: boolean;
    /** La sincronización automática solo con Wi-Fi (la manual pide confirmación con datos móviles). */
    autoSyncWifiOnly: boolean;
    /** Fallos seguidos del servidor (5xx, 429) que detienen la ronda para no insistir. */
    maxConsecutiveFailures: number;
    /** Cada cuánto se revisa, con la app abierta, si hay elementos cuya espera ya venció (sincronización automática). */
    autoSyncIntervalMs: number;
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
    clockSkewWarnSeconds: 120,
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
    maxMegapixels: 12, // calibrar (Q-15): ≤ 25 MP y ≤ 10 MB por foto (Cloudinary Free)
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
  shortTest: { timeoutMs: 20_000 }, // calibrar
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
    uploadRequestTimeoutMs: 120_000,
    maxUploadBytes: 10 * 1024 * 1024,
    maxReuploads: 2,
    ticketMinRemainingMs: 300_000,
    maxTicketRequests: 2,
    uploadMode: 'TICKET',
    autoSync: true,
    autoSyncWifiOnly: true,
    maxConsecutiveFailures: 3,
    autoSyncIntervalMs: 300_000,
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
  if (!(cfg.capture.maxMegapixels >= 2 && cfg.capture.maxMegapixels <= 25)) errors.push('capture.maxMegapixels fuera de 2–25 MP (Cloudinary Free: 25 MP)');
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
  // Reglas v2.0 (maestro §17, Anexo E.8): subida directa a Cloudinary.
  const s = cfg.sync;
  if (s.uploadRequestTimeoutMs >= s.ticketMinRemainingMs) errors.push('uploadRequestTimeoutMs ≥ ticketMinRemainingMs');
  if (s.ticketMinRemainingMs >= 3_600_000) errors.push('ticketMinRemainingMs ≥ 1 hora (vigencia de la firma)');
  if (s.maxUploadBytes > 10 * 1024 * 1024) errors.push('maxUploadBytes > 10 MB (plan Free de Cloudinary)');
  if (s.maxTicketRequests < 2 || s.maxReuploads < 1) errors.push('maxTicketRequests ≥ 2 y maxReuploads ≥ 1');
  // Lotes del contrato /api/v1: el servidor acepta como máximo 200 secuencias o incidencias por petición.
  if (s.batchSize < 1 || s.batchSize > 200) errors.push('batchSize fuera de 1..200');
  if (s.maxConcurrent !== 1) errors.push('maxConcurrent debe ser 1 (una foto a la vez, RNF-19)');
  if (s.retryDelaysMs.length === 0) errors.push('retryDelaysMs vacío');
  if (s.autoSyncIntervalMs < 60_000) errors.push('autoSyncIntervalMs < 1 min');
  if (s.maxConsecutiveFailures < 1) errors.push('maxConsecutiveFailures < 1');
  return errors;
}
