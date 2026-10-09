// src/config/defaults.ts — Parámetros configurables de la app (versión CFG-9).
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
// CAMBIOS CFG-5 → CFG-6 (segunda prueba con tres Android, 07/10/2026; diagnóstico del controlador SM-A035M):
//  - capture.jpegQuality: 1 → 0,85 (calibrar). Con calidad 1 (JPEG 100) una foto de 12 MP pesaba 8,9 MB: casi el
//    límite de Cloudinary Free (10 MB) y el controlador recibía solo ~0,75 MB/s en total (cada bloque cruza el puente
//    de react-native-tcp-socket en base64). Dos fotos (13 MB) tardaban ~17 s y la prueba corta pasaba de 20 s.
//    Con JPEG 85 el tamaño baja a ~1/3 sin pérdida visible para revisión ni para YOLO (que reduce la imagen).
//
// CAMBIOS CFG-6 → CFG-7 (pedido del equipo tras la prueba de campo del 07/10/2026):
//  - device.minBatteryToStartPct (30), warnBatteryPct (25) y pauseBatteryPct (15) → un solo device.lowBatteryAlertPct
//    (15). La batería ya NO bloquea crear la sesión ni iniciar o reanudar una pasada, y NO pausa la pasada: debajo de
//    15 % solo aparece «Batería baja: conecta el power bank» (controlador, en su pantalla, y cámara, en PANT-30/31).
//    Las fotos y datos están en SQLite: si un celular se apaga, se recuperan al encenderlo (8.10).
//
// CAMBIOS CFG-7 → CFG-8 («Ubicar plaga», ADR 0009, app 0.5.0):
//  - pests.*: NUEVO. windowDays (30): días hacia atrás de alertas que se piden a la plataforma (máximo 90, lo
//    limita también el servidor); requestTimeoutMs (30 s); autoRefreshMs (2 min): con la pantalla abierta y
//    internet se vuelve a pedir la lista; locationIntervalMs (2 s) y arrivedRadiusM (15 m, calibrar: el GPS del
//    celular tiene 5–15 m de error): debajo de esa distancia se muestra «Estás en el lugar».
//
// CAMBIOS CFG-8 → CFG-9 (limpieza de fotos, app 0.5.1, plataforma v1.3.1):
//  - cleanup.*: NUEVO. checkIntervalMs (10 min): cada cuánto, como máximo, la sincronización pregunta a la plataforma
//    qué fotos y sesiones borró el administrador (GET /mobile/deleted-captures); requestTimeoutMs (30 s); maxPages
//    (5): páginas por consulta. La app borra el archivo de esas fotos y cierra su cola (la fila queda, RN-09).
//
// Los valores marcados "calibrar" son iniciales: se ajustan con mediciones y NO son resultados validados.

export const CONFIG_VERSION = 'CFG-9';

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
    lowBatteryAlertPct: number; // CFG-7: único umbral de batería; debajo solo se avisa «conecta el power bank»
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
  /** CFG-8 (ADR 0009): «Ubicar plaga». */
  pests: {
    windowDays: number;
    requestTimeoutMs: number;
    autoRefreshMs: number;
    locationIntervalMs: number;
    arrivedRadiusM: number; // calibrar
  };
  /** CFG-9 (app 0.5.1, plataforma v1.3.1): fotos y sesiones borradas por el administrador. */
  cleanup: {
    checkIntervalMs: number;
    requestTimeoutMs: number;
    maxPages: number;
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
    jpegQuality: 0.85, // calibrar (CFG-6): JPEG 85; con 1 una foto de 12 MP pesaba ~9 MB
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
    lowBatteryAlertPct: 15, // CFG-7: solo aviso (no bloquea crear sesión ni iniciar/reanudar, no pausa)
    warnFreeSpaceBytes: 3 * GB,
    minFreeSpaceToStartBytes: 2 * GB,
    pauseFreeSpaceBytes: 1 * GB,
    statusPollMs: 15_000,
  },
  retention: { cameraPolicy: 'TRAS_SINCRONIZACION', controllerPolicy: 'CONSERVAR' },
  logging: { eventLogMaxDays: 30 },
  pests: { windowDays: 30, requestTimeoutMs: 30_000, autoRefreshMs: 120_000, locationIntervalMs: 2_000, arrivedRadiusM: 15 },
  cleanup: { checkIntervalMs: 600_000, requestTimeoutMs: 30_000, maxPages: 5 },
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
  if (!(cfg.capture.jpegQuality >= 0.6 && cfg.capture.jpegQuality <= 0.95))
    errors.push('capture.jpegQuality fuera de 0,6–0,95 (1 = JPEG 100: fotos de ~9 MB a 12 MP)');
  if (cfg.shortTest.timeoutMs <= p.captureResponseTimeoutMs) errors.push('shortTest.timeoutMs ≤ captureResponseTimeoutMs');
  if (p.ackTimeoutMs >= p.lostAfterMs) errors.push('ackTimeoutMs ≥ lostAfterMs');
  const d = cfg.device;
  if (!(d.lowBatteryAlertPct >= 5 && d.lowBatteryAlertPct <= 50)) errors.push('batería: lowBatteryAlertPct fuera de 5–50 %');
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
  // CFG-8: «Ubicar plaga».
  const pe = cfg.pests;
  if (!(pe.windowDays >= 1 && pe.windowDays <= 90)) errors.push('pests.windowDays fuera de 1–90 (límite del servidor)');
  if (pe.autoRefreshMs < 30_000) errors.push('pests.autoRefreshMs < 30 s');
  if (pe.requestTimeoutMs >= pe.autoRefreshMs) errors.push('pests.requestTimeoutMs ≥ pests.autoRefreshMs');
  if (pe.locationIntervalMs < 500) errors.push('pests.locationIntervalMs < 0,5 s');
  if (!(pe.arrivedRadiusM >= 3 && pe.arrivedRadiusM <= 50)) errors.push('pests.arrivedRadiusM fuera de 3–50 m');
  // CFG-9: limpieza ordenada por el administrador.
  const cl = cfg.cleanup;
  if (cl.checkIntervalMs < 60_000) errors.push('cleanup.checkIntervalMs < 1 min');
  if (cl.requestTimeoutMs >= cl.checkIntervalMs) errors.push('cleanup.requestTimeoutMs ≥ cleanup.checkIntervalMs');
  if (!(cl.maxPages >= 1 && cl.maxPages <= 20)) errors.push('cleanup.maxPages fuera de 1–20');
  return errors;
}
