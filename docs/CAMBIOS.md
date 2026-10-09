# Informe de avance — App móvil v0.5.0 (formato maestro §23.2)

**Tarea:** «Ubicar plaga» y especialista en la app. **Fecha:** 2026-10-08 · **CFG-8** · esquema SQLite 4 (sin migración).
Requiere la plataforma web **v1.3** (ADR-W-007). Decisión: `docs/adr/0009-ubicar-plaga.md`.

## Hecho
- **PANT-40 Ubicar plaga:** mapa satelital (Esri) o lista con las alertas confirmadas por la IA o por el especialista,
  posibles plagas y en revisión; contornos de lotes, hileras y puntos dibujados en la web; tu posición; distancia y
  dirección; filtros; copia guardada para usar sin internet; actualización automática cada 2 min con internet.
- **PANT-41 Detalle:** miniatura, indicio de la IA, lugar (lote, hilera, lado, plantas, marcador), fuente y precisión de
  la ubicación, observación del especialista, **«Cómo llegar (Google Maps)»** a pie y «Ver en el mapa».
- Leaflet 1.9.4 **embebido** (sin CDN) en un WebView (`react-native-webview` 13.16.1).
- **Especialista fitosanitario** entra a la app solo para «Ubicar plaga»: no elige función, no se vincula como cámara
  y no sincroniza (`canDoFieldWork`). Cuenta simulada `especialista@demo.pe`.
- Entradas: Controlador, Ajustes y PANT-08. CFG-8 (`pests.*`). Versión 0.5.0 (Android versionCode 10, iOS build 10).

## Archivos
Nuevos: `app/pests/{_layout,index,[id]}.tsx`, `src/pests/{pestService,mapHtml,openMaps}.ts`,
`src/pests/vendor/leaflet.ts`, `src/domain/{geo,pests}.ts`, `src/api/pestApi.ts`, `src/api/mock/mockPests.ts`,
`src/ui/components/{PestMap,PestItem}.tsx`, `__tests__/pests.test.ts`, `docs/adr/0009-ubicar-plaga.md`.
Modificados: `app/{_layout,index,settings}.tsx`, `app/(setup)/role.tsx`, `app/controller/index.tsx`,
`src/domain/types.ts`, `src/api/{dto,index}.ts`, `src/api/mock/mockBackend.ts`, `src/config/defaults.ts`,
`src/controller/pairingService.ts`, `src/sync/syncService.ts`, `src/diagnostics/eventLog.ts`,
`src/storage/repositories/appMetaRepo.ts`, `src/ui/{strings,messages}.ts`, `src/ui/components/AppHeader.tsx`,
`__tests__/config.test.ts`, `eslint.config.js`, `tools/verificacion/{integracion.ts,tsconfig.json,README.md}`,
`tools/verificacion/mocks/expo-location.ts` (nuevo), `app.json`, `package.json`, `package-lock.json`, `README.md`, `AGENTS.md`.

## Resultado
`tsc`: 0 errores · `expo lint`: 0 · Jest **16 suites / 139 pruebas OK** (15 nuevas). `expo export` Android OK
(Hermes 5,3 MB). Simulado 9/9. Integración con la plataforma v1.3 local **30/30** (paso nuevo: el especialista entra,
recibe las alertas y la app no sincroniza con su usuario; la plataforma le responde 403 en `/sessions`). Página del mapa probada en Chromium sin internet: dibuja lotes, hileras, puntos, alertas y posición,
y responde a tocar una alerta, «Todo», «Yo» y Satélite/Calles sin errores.

## Pendiente
- Probar en campo con el APK 0.5.0 en los tres celulares: «Cómo llegar» con Google Maps y la precisión del GPS
  (calibrar `pests.arrivedRadiusM`).

---

# Informe de avance — App móvil v0.4.6 (formato maestro §23.2)

**Tarea:** batería: un solo aviso. **Fecha:** 2026-10-07 · **CFG-7** · esquema SQLite 4.

## Cambio (pedido del equipo)
Antes había tres umbrales: no se podía crear la sesión ni iniciar una pasada con menos de 30 %, aviso con menos de
25 % y pausa automática con menos de 15 %. Ahora hay **uno solo**: con menos de **15 %** en cualquiera de los tres
celulares aparece «Batería baja (menos de 15 %): conecta el power bank.» Nada más: no bloquea crear la sesión, ni
iniciar o reanudar la pasada, y no la pausa.
- Controlador: aviso en la pantalla principal y en la pasada activa (de cualquiera de los tres celulares), más un
  aviso emergente una vez cada vez que baja de 15 %.
- Cámaras: aviso y porcentaje resaltado en PANT-30 y PANT-31 (su propia batería).
- `device.minBatteryToStartPct`, `warnBatteryPct` y `pauseBatteryPct` → `device.lowBatteryAlertPct = 15`
  (regla de coherencia 5–50 %). Se quitan las reglas de batería de `canStartPass`, `canResumePass` y `createDraft`,
  y el mensaje BATERIA_CRITICA. El espacio libre sigue igual (aviso, bloqueo y pausa).
- Si un celular se apaga, sus datos y fotos siguen en SQLite y se recuperan al encenderlo (8.10).
- CONFIG_VERSION **CFG-7**. Versión 0.4.6 (Android versionCode 9, iOS build 9).

## Archivos
`src/config/defaults.ts`, `src/domain/rules.ts`, `src/controller/{controllerRuntime,sessionService}.ts`,
`src/ui/messages.ts`, `app/camera/{index,live}.tsx`, `__tests__/{domain,config}.test.ts`, `app.json`,
`package.json`, `package-lock.json`, `README.md`.

## Resultado
`tsc`: 0 errores en la app. Pruebas: **124 OK**. Simulado 9/9, integración con Django local 29/29.

---

# Informe de avance — App móvil v0.4.5 (formato maestro §23.2)

**Tarea:** cuarta prueba con tres Android: la prueba corta ya aprueba. **Fecha:** 2026-10-07 · CFG-6 · esquema SQLite 4.

## Qué se vio
- PANT-15 no deja iniciar la pasada: la hilera no tiene segmentos ni marcadores. En el piloto solo se cargaron lotes e
  hileras (diagnóstico: `segments: 0, markers: 0`); la app pide un marcador de inicio.
- «Cerrar sesión» decía «Cierra la sesión de monitoreo antes de cerrar tu sesión de usuario» (RN-19).

## Cambios
- **Segmentos (servidor, sin cambiar la app):** `tools/servidor/crear_segmentos_hilera_completa.py`, para el VPS de la
  plataforma. Crea, solo en las hileras activas SIN segmentos ni marcadores, un segmento «Hxx completa» (planta 1 a la
  última) con marcadores «Hxx inicio» (INICIO) y «Hxx fin» (FIN), sin coordenadas. Repetirlo no duplica nada.
  Probado en una copia de la base local: 71 hileras completadas, segunda ejecución 0; el bootstrap los entrega.
  Los marcadores reales del campo (Q-01) se cargan después en /gestion/ y reemplazan a estos.
- **Cerrar sesión con una sesión de monitoreo abierta (ADR 0008, RN-19 modificada):** se permite con un aviso; la
  pasada en curso del controlador se pausa y la sesión queda guardada para recuperarla al volver a entrar.
- **Al cerrar la sesión de monitoreo se vuelve a PANT-08** (elegir función): en el controlador desde PANT-19 y en las
  cámaras al recibir SESSION_CLOSED (`sessionEnded` en cameraStore). RN-15 sigue: con datos pendientes solo se puede
  seguir con la misma función.
- Versión 0.4.5 (Android versionCode 8, iOS build 8).

## Archivos
Nuevos: `docs/adr/0008-cerrar-sesion-con-monitoreo-abierto.md`, `tools/servidor/crear_segmentos_hilera_completa.py`.
Modificados: `src/ui/hooks/useLogout.ts`, `src/auth/authService.ts`, `src/domain/rules.ts`, `src/ui/messages.ts`,
`src/ui/strings.ts`, `app/change-password.tsx`, `app/controller/session-summary.tsx`, `app/camera/_layout.tsx`,
`src/camera/cameraStore.ts`, `src/camera/cameraAgent.ts`, `__tests__/domain.test.ts`, `app.json`, `package.json`,
`package-lock.json`, `README.md`.

## Resultado
`tsc`: 0 errores en la app. Pruebas: 123 OK. Red local 9/9, simulado 9/9, integración con Django local 29/29.

---

# Informe de avance — App móvil v0.4.4 (formato maestro §23.2)

**Tarea:** tercera prueba con tres Android (prueba corta con v0.4.3). **Fecha:** 2026-10-07 · **CFG-6** · esquema SQLite 4.

## Qué se vio (diagnóstico del controlador SM-A035M)
Seis pruebas cortas: ambas cámaras CAPTURE_OK y UTILIZABLE, la foto llegó, desfase 7–178 ms, pero «Reprobada» por
tiempo total (21,6–22,3 s con límite 20 s). Datos del registro:
- Captura (orden → CAPTURE_OK): 3,5–3,7 s en la Cámara 2 y 4,6–4,7 s en la Cámara 1.
- Tamaño de la foto: **8,9–9,0 MB** en la Cámara 1 y 3,4–4,5 MB en la Cámara 2, con `jpegQuality = 1` (JPEG 100).
  La de la Cámara 1 queda a 1 MB del límite de Cloudinary Free (10 MB).
- Recepción en el controlador: **~0,75 MB/s en total**, con una o dos fotos a la vez (13 MB ≈ 17 s). Cada bloque
  cruza el puente de react-native-tcp-socket en base64 y se decodifica en JavaScript; en un celular de gama de entrada
  ese es el cuello de botella, y los mensajes de control que llegan detrás esperan (una vez CAPTURE_OK llegó 17 s tarde).
- **Cada foto de la Cámara 1 llegaba dos veces** (p. ej. 01:18:03 y otra vez 01:18:17): ~12 s extra de recepción que
  frenaban la prueba siguiente.

## Causas y cambios
- **Reenvío de la misma foto:** al terminar, el receptor escribía la respuesta y llamaba a `destroy()` en seguida;
  `write()` de react-native-tcp-socket es asíncrono y el cierre podía cortar la respuesta. La cámara veía un error
  de red y, a los 2 s, reenviaba la foto (el controlador la descartaba por idempotencia, pero ya la había recibido
  entera). Ahora `closeGracefully`: espera a que se escriba la respuesta, envía FIN (`end()`) y solo destruye el
  socket si la cámara no cierra en 10 s.
- **Fotos más livianas:** `capture.jpegQuality` 1 → **0,85** (CFG-6, calibrar). Es el ajuste del codificador AL
  TOMAR la foto: el original guardado, transferido y subido a Cloudinary es esa foto, sin recomprimir después
  (RN-24 / RF-49 se mantienen). Se espera ~1/3 del tamaño (≈ 3 MB a 12 MP), sin pérdida visible para la revisión ni
  para YOLO, que reduce la imagen. Nueva regla de coherencia: `jpegQuality` entre 0,6 y 0,95.
- CONFIG_VERSION **CFG-6**. Versión 0.4.4 (Android versionCode 7, iOS build 7).

## Archivos
Modificados: `src/local-network/tcp/tcpFileReceiver.ts`, `src/config/defaults.ts`, `__tests__/config.test.ts`,
`__tests__/httpUpload.test.ts`, `__tests__/shortTest.test.ts`, `tools/verificacion/redlocal.ts`, `app.json`,
`package.json`, `package-lock.json`, `README.md`.

## Resultado
`tsc`: 0 errores en la app. Pruebas: **123 OK** (nuevas: cierre ordenado del receptor y regla de `jpegQuality`).
Red local (`redlocal.ts`): **9/9**, incluida «dos cámaras envían a la vez: cada foto llega una vez». Simulado 9/9,
integración con Django local 29/29, actualización 001 → 004 OK.

## Pendiente de medir en campo
- Tamaño de las fotos con JPEG 85 (`TRANSFER/RECEIVED` del controlador) y tiempo total de la prueba corta.
- Si con fotos de ~3 MB la recepción sigue limitando, la siguiente opción es que el controlador **descargue** la foto
  de cada cámara con el cliente HTTP nativo (sin pasar los bytes por JavaScript del controlador): cambio de §14.8.

---

# Informe de avance — App móvil v0.4.3 (formato maestro §23.2)

**Tarea:** segunda prueba con tres Android (prueba corta). **Fecha:** 2026-10-07 · **CFG-5** · esquema SQLite 4.

## Qué se vio
Las dos cámaras respondieron CAPTURE_OK, UTILIZABLE y la foto llegó, pero la prueba corta quedó «Reprobada»: tardó
18,5 s con un límite de 15 s, y las cámaras mostraron «Sin conexión con el controlador — en pausa» y se reconectaron.

## Causas y cambios
- **Fotos a la resolución máxima del sensor:** sin `pictureSize`, Android toma la foto con todos los megapíxeles del
  sensor (50 MP o más en celulares nuevos): archivos de 15–30 MB que tardan en cruzar el Wi-Fi, saturan la app del
  controlador al recibirlos y además superan el límite de Cloudinary Free (10 MB, 25 MP; maestro Q-15). Nuevo
  `capture.maxMegapixels = 12`: al abrir la cámara se elige la mayor resolución ≤ 12 MP, preferiblemente 4:3
  (`src/domain/pictureSize.ts`, `useCapturePictureSize`). La foto sigue sin recomprimirse (RN-24).
- **El enlace se cortaba por una demora propia del controlador:** los HEARTBEAT y la marca «última señal» de cada
  cámara pasaban por la cola de tareas del controlador; mientras guardaba fotos, las cámaras no recibían señal por
  más de 6 s y cortaban. Ahora el HEARTBEAT sale directo del temporizador, cualquier mensaje y los datos de una foto
  que llega cuentan como señal de vida al instante, y la cámara tolera el triple mientras está enviando una foto.
- **Prueba corta:** límite 15 → 20 s (calibrar) y PANT-14 dice el **motivo** de la reprobación (p. ej. «Tardó 18,5 s
  en total (máximo 20,0 s)»).
- **Mediciones para Q-15:** `CAPTURE/PICTURE_SIZE` (resolución elegida y disponibles), `TRANSFER/OK` en la cámara con
  bytes, MP y ms, `TRANSFER/RECEIVED` en el controlador con bytes y ms, y `SESSION/SHORT_TEST` con motivos y límites.
- CONFIG_VERSION **CFG-5**. Versión 0.4.3 (Android versionCode 6, iOS build 6).

## Archivos
Nuevos: `src/domain/pictureSize.ts`, `src/ui/hooks/useCapturePictureSize.ts`, `__tests__/pictureSize.test.ts`,
`__tests__/shortTest.test.ts`. Modificados: `src/config/defaults.ts`, `__tests__/config.test.ts`,
`app/camera/live.tsx`, `app/camera/test.tsx`, `src/controller/controllerRuntime.ts`, `src/controller/shortTest.ts`,
`app/controller/short-test.tsx`, `src/ui/strings.ts`, `src/local-network/{transport,factory}.ts`,
`src/local-network/tcp/tcpFileReceiver.ts`, `src/camera/{transferQueue,cameraAgent}.ts`,
`tools/verificacion/redlocal.ts`, `app.json`, `package.json`, `package-lock.json`, `README.md`.

## Resultado
`tsc --noEmit`: 0 errores. Pruebas: **120 OK** (nuevas: resolución de captura y motivos de la prueba corta).
Red local en Node (`redlocal.ts`): 8/8, incluida la señal de vida durante la recepción.

## Pendiente de medir en campo (Q-15)
Tamaño real de las fotos de 12 MP con `jpegQuality = 1` frente a 10 MB: verlo en `TRANSFER/OK` del diagnóstico.

---

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
