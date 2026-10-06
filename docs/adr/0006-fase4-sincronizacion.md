# ADR 0006 — Fase 4: sincronización con la plataforma Django y subida directa a Cloudinary

**Estado:** aceptado · **Fecha:** 2026-10-06 · **Tarea:** T-20 (maestro v2.0 §15.5, §15.7) · **Versión:** v0.4.0 · CFG-4

## Contexto
- La plataforma web (Django + Supabase + Cloudinary) ya está en producción en
  `https://monitoreo.agricolariachuelo.org` con el contrato `/api/v1` del maestro v2.0 (docs/INTEGRACION_APP.md del
  repositorio de la plataforma). Acepta las fotos de dos formas: **ticket v2.0** (la app sube directo a Cloudinary
  con parámetros firmados por Django y luego confirma) y **multipart v1** (la foto pasa por Django), esta última solo
  mientras `API_SUBIDA_MULTIPART=true`.
- La app llegaba hasta la Fase 3: la cola `sync_queue` se llenaba al cerrar cada sesión, pero `syncService.ts`
  respondía «Pendiente».

## Decisión
1. **Motor de sincronización** (`src/sync/syncService.ts`), una ronda a la vez:
   GET `/health` → sesión de usuario ONLINE → token vigente → envío en orden por sesión
   (10 SESSION CLOSING → 20 PASS → 30 SEQUENCE_BATCH ≤200 → 40 CAPTURE → 50 INCIDENT_BATCH ≤200 → 60 SESSION_CLOSE).
   - El **planificador** (`src/sync/syncPlanner.ts`, puro y probado) solo entrega elementos cuyos padres ya están
     HECHO (§15.5 paso 8) y, en la sincronización automática, respeta `next_attempt_at`.
   - Cada foto se sube con `syncCapture` (copia exacta de §15.7.3) y `remote_uploads` (migración 003): si la app se
     cierra entre la subida y la confirmación, la siguiente vez solo confirma (RF-51).
   - Los fallos se clasifican con `classifySyncError` / `classifyCloudinaryError` (Anexo C.3, sin cambios) y se
     aplican las reglas del paso 5. Se agregan dos reglas de capa (no cambian C.3): `ACCOUNT_PENDING` y
     `ACCOUNT_REJECTED` (403) pausan la cola y revocan el acceso como los demás 403 de cuenta, y una respuesta 2xx que
     no es JSON (Wi-Fi con página de acceso) cuenta como falta de red, no como error del dato.
   - La ronda se corta si se cae la red (health falla) o tras `sync.maxConsecutiveFailures` fallos seguidos.
2. **Supuesto S-07 — `sync.uploadMode`:** `TICKET` (v2.0) por defecto; `MULTIPART` (v1) queda disponible por
   configuración solo como respaldo. Cuando los tres celulares tengan la v0.4.0, en el servidor se puede poner
   `API_SUBIDA_MULTIPART=false`.
3. **Supuesto S-08 — sincronización automática:** con la app abierta, función CONTROLADOR, sesión ONLINE, después de
   PANT-08, **sin sesión de monitoreo abierta** y **solo con Wi-Fi** (`sync.autoSyncWifiOnly`): al volver el
   internet, al volver la app a primer plano, al cerrar una sesión y cada `sync.autoSyncIntervalMs` (5 min). La
   sincronización manual (PANT-20) también funciona con datos móviles, pero antes muestra cuántos MB se enviarán.
   Durante la manual la pantalla no se apaga (`keepAwakeOn('sync')`) y se puede **Detener**.
4. **Errores que no se resuelven solos:** un elemento cuyo padre quedó en ERROR_DEFINITIVO pasa a error con
   `SESION_CON_ERROR`, `PASADA_CON_ERROR`, `SECUENCIAS_CON_ERROR` o `CAPTURA_SIN_PASADA` (`blockedItems`). Si se
   quedara PENDIENTE bloquearía para siempre el cierre (60) y el cambio de función. «Reintentar errores» devuelve
   todo a la cola con `attempts = 0` (como «Reintentar transferencias con error») y da otra vez `sync.maxReuploads`
   subidas a las fotos que las agotaron.
   `SINCRONIZAR_PADRE` reenvía solo el padre que falta y, si se repite `MAX_PARENT_RESYNCS` veces, el elemento queda
   con `PADRE_NO_SINCRONIZADO` (evita ciclos sin fin).
5. **RN-15 con la Fase 4:** la cola PENDIENTE del controlador **bloquea** el cambio de función
   (`CAMBIO_FUNCION_SINCRONIZACION_PENDIENTE`); los elementos con error definitivo solo **avisan**
   (`CAMBIO_FUNCION_ERRORES_SINCRONIZACION`): nunca se vaciarían solos y los datos quedan guardados.
6. **Datos que el servidor exige** (`src/sync/syncPayloads.ts`, puro y probado):
   - el lateral de la foto es el de su **pasada** (Django lo valida);
   - usuario de la cámara: el de la fila de la captura o el registrado para ese celular en la sesión;
   - motivos de calidad: solo los que acepta el servidor (`CAMARA_EN_MOVIMIENTO` es local);
   - incidencias: una pasada o secuencia que el servidor no tiene se envía como `null` (si no, Django rechaza todo
     el lote con 404);
   - largos máximos del servidor (versiones, modelo, detalle ≤ 4000).
7. **Autenticación:**
   - **Una sola renovación a la vez** (`refreshAccessToken`): SimpleJWT rota el refresh y pone el anterior en la lista
     negra; dos renovaciones simultáneas harían que la segunda reciba `REFRESH_INVALID` y la app cerrara la sesión.
   - Vencimientos medidos con la **hora del servidor** (`serverTime` de login, refresh, health, bootstrap y ticket):
     un celular con la hora mal puesta no usa tokens vencidos. Desfase > `auth.clockSkewWarnSeconds` → evento
     `NET/SERVER_CLOCK_OFFSET`.
   - Ante `401 TOKEN_EXPIRED` se renueva una vez y se repite (`callWithToken`, `authed`).
   - Cambio de contraseña: los motivos de la política de Django (contraseñas comunes, numéricas o parecidas al nombre)
     se muestran debajo de «Nueva contraseña»; contraseña actual errónea → `CONTRASENA_ACTUAL_INCORRECTA`.
8. **Fotos tardías e incidencias tardías (8.13):** una foto tardía reencola PASS, SEQUENCE_BATCH y CAPTURE; una
   incidencia nueva en una sesión cerrada reencola su INCIDENT_BATCH. En ambos casos la sesión SYNCED vuelve a CLOSED.
9. **Perfil de calidad publicado:** se guarda en `app_meta.quality_profile_json` y se reaplica al arrancar, así las
   cámaras reciben el mismo perfil en PAIRED aunque el controlador se reinicie sin internet.

## Consecuencias
- CONFIG_VERSION pasa a **CFG-4** (claves nuevas de `sync` y `auth.clockSkewWarnSeconds`).
- Se registran las migraciones 002 (ciclos CFG-3, solo agrega tablas), 003 (`remote_uploads`) y 004 (catálogos con
  códigos repetidos, ADR 0007).
- La app sigue sin conocer Supabase ni secretos de Cloudinary (R-18, R-21): la URL de subida, la `api_key` y la
  firma llegan en cada ticket.
- **IA (YOLO):** la responsabilidad de la app termina en SINCRONIZADO. Django crea la tarea de análisis en la misma
  transacción de la confirmación (solo fotos UTILIZABLE o PENDIENTE_REVISION_TECNICA) y el worker la procesa; si no
  hay modelo activo, el worker encola las fotos pendientes en cuanto se active uno (`enqueue_missing`). No hace falta
  un APK nuevo para la IA. La API nunca devuelve resultados de IA ni URLs de fotos a la app (§28.10).
- Pruebas: `__tests__/retry.test.ts` (E.7), `captureUploader.test.ts` (E.8), `syncPlanner.test.ts`,
  `syncPayloads.test.ts`, `config.test.ts`, `roleChange.test.ts`. Integración: `docs/evidencias/fase4_integracion.md`.
- Pendiente de reflejar en el Archivo Maestro: §15.5 (bloqueados, reglas de capa), §17 (claves S-07/S-08), RN-15.
