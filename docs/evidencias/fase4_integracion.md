# Evidencia — Fase 4: sincronización con la plataforma Django (v0.4.0)

**Fecha:** 2026-10-06 · **App:** v0.4.0 (CFG-4, esquema SQLite 4) · **Plataforma:** `agricola-riachuelo-platform`,
rama `prueba2`, commit `908de8e` (2026-10-05) corriendo en local con `APP_ENV=dev`, base SQLite, datos de
`sembrar_demo` y **Cloudinary simulado del servidor** (misma firma del SDK de Cloudinary que el real).

## Cómo se obtuvo
- `tools/verificacion/integracion.ts`, `simulado.ts` y `actualizacion.ts` (ver `tools/verificacion/README.md`): el
  código real de `src/` en Node, con los módulos nativos de Expo reemplazados por `tools/verificacion/mocks/`.
- La plataforma Django real atendió todas las peticiones HTTP (`runserver`); las comprobaciones del lado del servidor
  leen su base SQLite.
- Pruebas unitarias: las 13 suites de `__tests__/` (Jest), ejecutadas con un arnés compatible en Node.
- Tipos: `tsc --noEmit` estricto sobre `app/`, `src/` y `__tests__/` con los tipos de React 19, React Native 0.86,
  Expo SDK 57 (expo-file-system, expo-sqlite, expo-network, expo-secure-store, expo-crypto, expo-keep-awake), zod 4
  y zustand 5: **0 errores** (también se corrigieron los que ya existían en el código de ciclos y cobertura, CFG-3).

## Casos del maestro cubiertos (21.2)

| Caso | Resultado | Dónde |
|---|---|---|
| CP-26 Sincronizar con internet | ✅ Todo SINCRONIZADO; sesión SYNCED; Django: sesión CLOSED, 2 pasadas, 4 secuencias, 9 fotos | integración |
| CP-27 Repetir la sincronización | ✅ Sin duplicados (fotos y secuencias con `duplicate`) | integración |
| CP-28 Token vencido durante la sincronización | ✅ Se renueva y continúa (también dos renovaciones simultáneas) | integración |
| CP-29 Error definitivo (409) en una captura | ✅ `CAPTURE_CONFLICT` visible; la otra sesión de la ronda se sincroniza | integración |
| CP-33 Celular revocado | ✅ Tokens y verificador borrados; cola y datos de campo intactos | integración |
| CP-35 Foto tardía | ✅ SYNCED → CLOSED → SYNCED; la foto llega una vez | integración |
| CP-39 Cierre entre subida y confirmación | ✅ Solo se confirma (ningún segundo UPLOAD_OK) | integración |
| CP-40 Ticket vencido | ✅ Se pide otro ticket y la foto sube | simulado + Anexo E.8 |
| CP-42 `UPLOAD_SIGNATURE_INVALID` | ✅ DESCARTADA, nueva subida (`existing: true`) y confirmación; agotadas → `REINTENTOS_DE_SUBIDA_AGOTADOS` | integración + E.8 |
| CP-43 Foto más grande que el límite | ✅ `FOTO_DEMASIADO_GRANDE`, la foto local no se toca | simulado + E.8 |
| CP-44 Cloudinary no responde / corte de red | ✅ REINTENTAR con espera; la cola queda igual; al volver, una sola vez | simulado + integración |
| CP-38 Subida directa con el ticket | ✅ `authenticated`, `overwrite=false`, ningún archivo a Django, sin cabeceras de la API hacia la nube | `piloto.ts` contra Django local (Cloudinary simulado del servidor) |
| CP-41 Foto que ya estaba en la nube | ✅ `existing: true`, mismo `public_id`, Django confirma | `piloto.ts` contra Django local |
| CP-38 y CP-41 con **Cloudinary real** | ⏳ `tools/verificacion/piloto.ts` listo; se corre desde la PC del equipo (el entorno de desarrollo no llega al piloto) | — |

## Resultados

### Integración con la plataforma Django
```
Plataforma: http://127.0.0.1:8000

  ✓ migraciones 001–004 aplicadas (user_version = 4)
  ✓ registro desde la app: política de contraseña de Django y cuenta PENDIENTE (login → ACCOUNT_PENDING)
  ✓ login rechazado: cuenta bloqueada, rol solo web y contraseña incorrecta
  ✓ login del operador con internet (tokens + verificador sin internet)
  ✓ renovación simultánea: una sola petición (sin REFRESH_INVALID por la rotación)
      (catálogo: 3 lotes, 83 hileras, 12 segmentos, 12 marcadores; códigos repetidos: 0)
  ✓ bootstrap: catálogos del piloto (códigos repetidos entre hileras) y perfil de calidad
  ✓ migración 004: códigos de segmento y marcador repetidos entre hileras se guardan sin conflicto
  ✓ sesión cerrada: 2 pasadas, secuencias, fotos (una rechazada y su repetición), marcadores e incidencias
  ✓ RN-15: con la cola pendiente el controlador no puede cambiar de función
  ✓ «Sincronizar ahora»: todo llega al servidor y la sesión queda SYNCED
      (tareas de IA creadas por Django: 8; la foto rechazada por calidad no se analiza)
  ✓ servidor: sesión CLOSED, pasadas, 4 secuencias, 9 fotos con su lateral, repetición e IA en cola
  ✓ idempotencia: reenviar TODO no duplica nada (duplicate=true en el servidor)
  ✓ ticket alreadyConfirmed: sin fila local de remote_uploads, el servidor dice que ya la tiene
  ✓ foto tardía de una sesión SYNCED: vuelve a CLOSED, se reenvían pasada y secuencias, y otra vez SYNCED
  ✓ incidencia nueva en una sesión ya sincronizada: el lote de incidencias vuelve a la cola y llega
  ✓ confirmación rechazada (firma inválida) → DESCARTADA → se vuelve a subir y se confirma
  ✓ firma inválida en una foto nueva: REPETIR_SUBIDA, nueva subida (existing=true) y confirmación
  ✓ SINCRONIZAR_PADRE: el servidor no tiene las secuencias → se reenvían y la foto sube
  ✓ archivo borrado antes de subir: ERROR_DEFINITIVO ARCHIVO_NO_DISPONIBLE; el cierre se envía igual
  ✓ CP-39: la app se cerró después de subir a Cloudinary y antes de confirmar → solo se confirma
  ✓ CP-29: conflicto 409 (mismo captureId con otro contenido) → ERROR_SINCRONIZACION visible y el resto continúa
  ✓ PANT-20: resumen por sesión con fotos en la nube y errores con su código
  ✓ token rechazado por el servidor (401): se renueva una vez y la ronda sigue
  ✓ modo MULTIPART (Supuesto S-07, v1): la foto pasa por Django y queda confirmada
  ✓ servidor caído: SIN_INTERNET, la cola queda igual y no cuenta intentos
  ✓ «Reintentar errores»: el error vuelve a la cola (y sigue en error si la causa persiste)
  ✓ cambio de contraseña: política de Django (PASSWORD_POLICY con motivo) y contraseña actual mala
  ✓ sin tokens (sesión OFFLINE): la sincronización pide validar la contraseña
  ✓ CP-33: celular revocado por el administrador → al sincronizar se borran tokens y verificador; datos intactos

✓ Integración: 29 pasos OK, 0 con falla
```

### Backend simulado (modo demostración) con fallos inyectados
```
Backend simulado: useMockApi = true

  ✓ login con la cuenta de prueba y catálogos simulados
  ✓ sesión con 3 fotos: SINCRONIZADO y SYNCED con el backend simulado
  ✓ Cloudinary: ticket vencido y firma rechazada se resuelven con un ticket nuevo en el mismo intento
  ✓ Cloudinary no disponible 3 veces seguidas: la ronda se corta (SUBIDA_NUBE_FALLIDA) y queda en cola
  ✓ foto demasiado grande para la nube: ERROR_DEFINITIVO FOTO_DEMASIADO_GRANDE (no se reintenta solo)
  ✓ servidor con errores 5xx al azar: todo termina llegando en varias rondas
  ✓ sincronización automática: solo con Wi-Fi y sin sesión de monitoreo abierta
  ✓ dos rondas a la vez: la segunda responde SINCRONIZACION_EN_CURSO
  ✓ «Detener»: termina después del elemento en curso y lo demás queda en la cola

✓ Backend simulado: 9 pasos OK, 0 con falla
```

### Actualización de una instalación anterior
```
✓ Actualización 001 → 004: datos conservados, códigos repetidos permitidos, claves foráneas e integridad OK
```

### Pruebas unitarias (Jest)
```
✓ auth.test.ts: 5 OK, 0 con falla
✓ captureUploader.test.ts: 13 OK, 0 con falla
✓ config.test.ts: 5 OK, 0 con falla
✓ coverage.test.ts: 13 OK, 0 con falla
✓ domain.test.ts: 16 OK, 0 con falla
✓ httpUpload.test.ts: 3 OK, 0 con falla
✓ protocol.test.ts: 5 OK, 0 con falla
✓ quality.test.ts: 4 OK, 0 con falla
✓ retry.test.ts: 7 OK, 0 con falla
✓ roleChange.test.ts: 8 OK, 0 con falla
✓ syncPayloads.test.ts: 9 OK, 0 con falla
✓ syncPlanner.test.ts: 17 OK, 0 con falla
✓ wsCodec.test.ts: 6 OK, 0 con falla

TOTAL: 111 pruebas OK, 0 con falla
```
