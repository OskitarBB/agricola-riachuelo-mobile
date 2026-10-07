# Informe de avance — App móvil v0.4.2 (formato maestro §23.2)

**Tarea:** corrección tras la primera prueba con tres Android. **Fecha:** 2026-10-07 · CFG-4 · esquema SQLite 4.

## Hecho
- **Prueba corta reprobada en 0,0 s con QUALITY_ERROR / ERROR_CAMARA en ambas cámaras:** no era la calidad de la
  foto. PANT-31 (y PANT-32) pasaban el ref de `<CameraView>` como función en línea; React la vuelve a llamar con
  `null` y con el mismo componente en cada redibujo (la pantalla se redibuja varias veces por segundo por el sensor de
  estabilidad) y `registerCamera(null)` dejaba la cámara «no lista» para siempre, porque `onCameraReady` solo se
  dispara una vez. Cada orden respondía `FALLO_CAMARA` sin tomar la foto. Ahora `cameraService` recuerda la
  **instancia** que avisó que está lista y las pantallas usan un ref estable (`useCallback`).
- Diagnóstico: `CAPTURE/CAMERA_NOT_READY` y `CAPTURE/TAKE_PICTURE_FAILED` (con el mensaje) en el registro de eventos;
  antes el error de la cámara no quedaba registrado.
- Versión 0.4.2 (Android versionCode 5, iOS build 5).

## Archivos modificados
`src/device/cameraService.ts`, `app/camera/live.tsx`, `app/camera/test.tsx`, `src/camera/captureService.ts`,
`app.json`, `package.json`, `package-lock.json` (solo la versión), `README.md`.

## Resultado
`tsc --noEmit`: 0 errores. Pruebas: 111 OK. Lógica de cámara lista comprobada (montaje, redibujo, nuevo montaje,
desmontaje, error de montaje).

## Nota
Una foto que la calidad rechaza (REPETIR_NITIDEZ / REPETIR_EXPOSICION) **no** reprueba la prueba corta: si la foto
llega al controlador queda «Aprobada con aviso de calidad». Solo la reprueban la falta de respuesta, el error de cámara
o la falta de la foto.

---

# Informe de avance — App móvil v0.4.1 (formato maestro §23.2)

**Tarea:** corrección de T-20 tras la primera prueba con el APK `piloto`. **Fecha:** 2026-10-07 · CFG-4 · esquema SQLite 4.

## Hecho
- **QR de vinculación (PANT-13) — «Ocurrió un error inesperado» y «Preparando…» sin fin en el APK:**
  `factory.ts` cargaba `react-native-tcp-socket` con `require(...).default`, pero el `index.js` de la librería (6.4.3)
  termina con `module.exports = {…}`, que reemplaza a `exports.default`: el servidor TCP del controlador nunca
  arrancaba (en Expo Go se usa el simulador, por eso no se había visto). Ahora usa `mod.default ?? mod` y, si el
  módulo no está, lo dice en el diagnóstico. Nueva prueba `tools/verificacion/redlocal.ts`: el servidor de control,
  el códec WebSocket, el receptor HTTP de fotos y los clientes de la cámara corren sobre TCP real (módulo `net` de
  Node) — 8/8.
- **Catálogos vacíos en el servidor:** el piloto todavía no tenía lotes. La descarga era correcta pero la app seguía
  mostrando «Sin descargar» y «Descarga los catálogos…», lo que parecía un error de la app. Ahora distingue tres
  estados (`catalogState`): sin descargar, **servidor sin lotes** («Sin lotes en el servidor» y el aviso
  `CATALOGOS_VACIOS`, que dice que hay que cargarlos en la web) y listo. Crear una sesión responde el mismo código.
- **Hilera sin marcadores:** PANT-15 avisa `HILERA_SIN_MARCADORES` en lugar de dejar «Iniciar pasada» desactivado sin
  explicación (la pasada exige un marcador de inicio).
- Versión 0.4.1 (Android versionCode 4, iOS build 4). Sin cambios de base de datos ni del contrato `/api/v1`.

## Archivos modificados
`src/local-network/factory.ts`, `tools/verificacion/redlocal.ts` (nuevo), `tools/verificacion/mocks/expo-file-system.ts`,
`src/controller/catalogService.ts`, `src/controller/sessionService.ts`, `src/ui/messages.ts`, `src/ui/strings.ts`,
`app/controller/index.tsx`, `app/controller/catalogs.tsx`, `app/controller/new-pass.tsx`, `app.json`, `package.json`,
`package-lock.json` (solo la versión), `README.md`.

## Cómo probar
Con un servidor sin lotes: *Catálogos › Actualizar* → aviso «El servidor todavía no tiene lotes…» y el panel muestra
«Sin lotes en el servidor». Con lotes e hileras pero sin marcadores en la hilera elegida: PANT-15 muestra el aviso.

## Resultado de typecheck / test
`tsc --noEmit`: 0 errores. Pruebas: 111 OK. Integración con Django local: sin cambios (29/29).

## Siguiente
Cargar en el piloto los lotes e hileras reales (Anexo D) y, en Gestión, los segmentos y marcadores de las hileras de
la prueba; compilar 0.4.1 junto con lo que salga de la prueba con los tres celulares.

---

# Informe de avance — App móvil v0.4.0 · Fase 4 (formato maestro §23.2)

**Tarea:** T-20 — Cola de sincronización con la plataforma Django y subida directa a Cloudinary.
**Fecha:** 2026-10-06 · **Configuración:** CFG-4 · **Esquema SQLite:** 4 (migraciones 001–004) · **ADR:** 0006, 0007

## Hecho
- **Sincronización real** con `https://monitoreo.agricolariachuelo.org/api/v1` (`src/sync/syncService.ts`):
  health → sesión ONLINE → token vigente → sesión (CLOSING) → pasadas → secuencias (lotes ≤ 200) → fotos → incidencias
  (lotes ≤ 200) → cierre (CLOSED). Padres antes que hijos (`syncPlanner.ts`), idempotencia por ID, reintentos con
  espera (la falta de red no cuenta), `SINCRONIZAR_PADRE`, `REPETIR_SUBIDA`, errores definitivos visibles, sesión
  SYNCED cuando todo llegó, fotos e incidencias tardías.
- **Fotos por ticket v2.0:** ticket a Django → subida directa a Cloudinary con `File.upload` del SDK 57 (sin
  cabeceras de la API, original sin recomprimir) → confirmación JSON. `remote_uploads` (migración 003) evita volver a
  subir si la app se cierra antes de confirmar. Modo `MULTIPART` (v1) disponible por configuración (S-07).
- **PANT-20 completa:** servidor y estado, avance en vivo (permiso de subida / subida / confirmación y MB),
  «Sincronizar ahora» (con datos móviles pide confirmación con el tamaño), «Detener», «Reintentar errores», por
  sesión: enviados, pendientes, errores con su código y texto, fotos en la nube / por confirmar / con error.
- **Sincronización automática** (S-08): con la app abierta, Wi-Fi, función Controlador y sin sesión abierta.
- **Autenticación con Django:** una sola renovación de tokens a la vez (rotación de SimpleJWT), vencimientos con la
  hora del servidor, renovar y repetir ante 401, revocación ante cuenta o celular desactivados (también
  ACCOUNT_PENDING / ACCOUNT_REJECTED), motivos de la política de contraseña de Django en el cambio de contraseña.
- **Catálogos reales:** migración 004 (códigos de segmento y marcador repetidos entre hileras) y perfil de calidad
  guardado y reaplicado al arrancar.
- **RN-15:** con datos por sincronizar el controlador no cambia de función; los errores definitivos solo avisan.
- **Otros:** Ajustes › *Servidor* y *Probar conexión*; panel del controlador con el estado de la sincronización;
  galería con «En la nube / Por subir / Error al subir»; diagnóstico con servidor, desfase de reloj, última
  sincronización y elementos con error (con traceId); filas de fotos pendientes con el lateral y el usuario reales;
  el código latente de ciclos (CFG-3) compila y su prueba pasa.
- **Versión:** app 0.4.0 (Android versionCode 3, iOS build 3); perfil EAS `piloto` apuntando al servidor real.

## Archivos creados o modificados
- Nuevos: `src/sync/{syncPlanner,syncPayloads,syncStore,captureUploader}.ts`, `src/api/{uploadApi,cloudinaryUpload,
  cloudinaryResponse}.ts`, `src/api/mock/mockCloudinary.ts`, `src/domain/syncQueue.ts`,
  `src/storage/migrations/{003_remote_uploads,004_catalog_codes}.ts`, `src/storage/repositories/remoteUploadRepo.ts`,
  `__tests__/{captureUploader,syncPlanner,syncPayloads}.test.ts`, `tools/verificacion/*`, ADR 0006 y 0007,
  `docs/evidencias/fase4_integracion.md`.
- Modificados: `src/sync/{syncService,syncQueue,retry}.ts`, `src/api/*` (cliente Django, DTO, simulado),
  `src/auth/{authService,tokenStore}.ts`, `src/config/*` (CFG-4, URL del servidor), repositorios (sesiones, pasadas,
  secuencias, capturas, incidencias, cola, catálogos, app_meta), `src/boot.ts`, `src/device/{networkMonitor,
  deviceRole,keepAwake,galleryService}.ts`, `src/domain/{rules,types,coverage}.ts`, `src/controller/{catalogService,
  controllerRuntime,…}.ts`, `src/diagnostics/*`, `src/ui/{messages,strings,theme}.ts`, pantallas `controller/sync`,
  `controller/index`, `controller/session-summary`, `settings`, `change-password`, `gallery`, `(setup)/role`,
  `app.json`, `eas.json`, `package.json`, `.env.example`, `tsconfig.json`, `eslint.config.js`, README, AGENTS.

## Cómo probar
1. `npm install` y `npm run validate`.
2. Demostración sin servidor: `npm start` (backend simulado) → Controlador → sesión → cerrar → *Sincronizar*.
3. Con la plataforma en la laptop o el piloto: `.env` con `EXPO_PUBLIC_API_URL` y `EXPO_PUBLIC_USE_MOCK_API=0`
   (README §7), login con un operador aprobado, *Catálogos › Actualizar*, una sesión corta y *Sincronizar ahora*.
   La sesión aparece en la web y las fotos en la bandeja (con IA cuando haya modelo activo).
4. APK del piloto: `npm run build:apk:piloto` e instalar en los **tres** celulares (misma versión, RN-17).
5. Contrato en Node: `tools/verificacion/README.md`.

## Resultado de typecheck / lint / test
- `tsc --noEmit` (estricto, tipos reales de React 19, RN 0.86, Expo SDK 57, zod 4, zustand 5): **0 errores**.
- Pruebas: **111 OK** en 13 suites (incluye E.7 y E.8 del maestro).
- Integración con la plataforma Django real (local, Cloudinary simulado del servidor): **29/29 pasos OK**;
  backend simulado con fallos inyectados: **9/9**; actualización de una base v0.2/v0.3: **OK**
  (`docs/evidencias/fase4_integracion.md`).
- `expo lint` y `jest-expo` no se pudieron ejecutar en el entorno de desarrollo (sin acceso al registro de npm):
  correr `npm run validate` antes de compilar el APK.

## Criterios de aceptación (T-20)
- Pruebas E.7 y E.8 en Jest: **cumplido**.
- CP-26, CP-27, CP-28, CP-29, CP-33, CP-35, CP-39, CP-40, CP-42, CP-43, CP-44: **cumplidos** contra Django
  (local) o el simulado (ver evidencia).
- CP-38 y CP-41: **cumplidos** contra Django local con su Cloudinary simulado (`tools/verificacion/piloto.ts`, 8/8);
  con Cloudinary real: **pendientes** de correr `piloto.ts` desde la PC del equipo con la cuenta de operador.

## Supuestos tomados
- **S-07** `sync.uploadMode` = TICKET por defecto; MULTIPART solo como respaldo.
- **S-08** sincronización automática solo con Wi-Fi, app abierta y sin sesión abierta; `autoSyncIntervalMs` 5 min;
  `maxConsecutiveFailures` 3.
- Elementos con un padre en error definitivo pasan a error con código propio (no bloquean el cierre ni RN-15).
- ACCOUNT_PENDING / ACCOUNT_REJECTED (403) se tratan como REQUIERE_LOGIN y revocan el acceso (C.3 sin cambios).

## Preguntas para el equipo
- ¿Una cuenta de operador aprobada en el piloto para la prueba real (CP-38, CP-41)?
- ¿Ya se puede poner `API_SUBIDA_MULTIPART=false` en el servidor cuando los tres celulares tengan la v0.4.0?
- Catálogos reales (códigos de segmentos y marcadores) y el modelo YOLO entrenado (lo activa la plataforma).

## Siguiente tarea sugerida
T-21 (Fase 5, iPhone) y, en paralelo, la prueba de campo con los tres Android y el APK `piloto`.

---

# Informe de avance — App móvil v0.2.0 (formato maestro §23.2)

**Fecha:** 2026-10-02 · **Fases entregadas:** 0, 1, 2 y 3 · **Configuración:** CFG-2

## Hecho
- Fase 0: proyecto Expo SDK 57, capas, configuración centralizada, migración SQLite 001, textos centralizados.
- Fase 1: login online/offline con logo animado, registro, cuenta pendiente, recuperación, cambio
  obligatorio de contraseña, función del dispositivo, permisos, cierre de sesión (RN-19).
- Fase 2: QR de vinculación, protocolo local v1 (ACK, reintentos, heartbeat, RESYNC), receptor HTTP con MD5,
  prueba corta, simulador con dos cámaras virtuales para Expo Go.
- Fase 3: sesión, pasadas por lateral, marcadores, captura MANUAL/AUTOMÁTICA, disparo solo con cámara estable,
  calidad técnica Q0, repetición, pausa/reanudación, cierre de pasada y de sesión, incidencias, galería.
- UI: animaciones, sonidos y vibración en botones (configurables), mensajes cortos.

## Validación
- `tsc --noEmit` sin errores · `expo lint` sin errores ni avisos · Jest 8 suites / 45 pruebas OK.
- `expo export` Android e iOS OK (bundle Hermes ≈ 4,9 MB). `expo config` OK.
- `expo-doctor`: 19/21; los 2 restantes requieren internet (esquema y React Native Directory).

## Pendiente
- Fase 4: sincronización con la web/base de datos (`src/sync/syncService.ts`).
- Calibración en campo de umbrales de calidad y estabilidad; evidencias en `docs/evidencias/`.
- Prueba de vinculación real con 3 Android (APK EAS).

---

# Cambios del 2026-10-03 — Función del celular después del login (ADR 0005)

## Hecho
- Después de cada inicio de sesión aparece PANT-08 para elegir **Controlador, Cámara 1 o Cámara 2**
  (rediseñada: selección + «Usar como …», marca *Actual*, bloqueos de RN-15 con su motivo).
- RN-15: la cola de sincronización pendiente ya no bloquea el cambio de función mientras la Fase 4 no exista
  (solo avisa; los datos se conservan). Sesión abierta y fotos por enviar siguen bloqueando.
- PANT-30 (Cámara 1/2): batería, espacio e IP del Wi-Fi antes de vincular, y «Reintentar» del lector de QR.
- PANT-15: se quitó el selector de dirección (la pasada se registra ASCENDENTE por defecto).

## Validación
- `tsc --noEmit`: sin errores nuevos (siguen los 14 de ciclos y cobertura, CFG-3, que ya existían).
- `eslint`: sin errores. Jest: 10 suites, 65 pruebas; falla solo la prueba de CFG-3 que ya fallaba
  (`validatePassDirection` no existe en `rules.ts`).

## Pendiente
- Probar en el celular: login → PANT-08 → Cámara 1 → permisos → PANT-30, y el regreso a Controlador.
