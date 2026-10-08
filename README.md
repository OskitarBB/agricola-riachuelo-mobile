# Riachuelo Monitoreo — App móvil (Fases 0 a 4 · v0.4.5)

App móvil del sistema de monitoreo fitosanitario de vid de **Agrícola Riachuelo** (Curso Integrador II).
Un celular **controlador** dirige a dos celulares **cámara** que toman fotos sincronizadas de los dos laterales
de la hilera. Construida con **Expo SDK 57**, Expo Router, TypeScript estricto y SQLite local.

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Base del proyecto, configuración CFG-2, estructura por capas, pruebas | ✅ |
| 1 | Login (online y sin internet), registro, recuperación, cambio de contraseña, función del dispositivo, permisos | ✅ |
| 2 | Vinculación por QR, protocolo local v1 (WebSocket + HTTP), prueba corta, simulador con 2 cámaras virtuales | ✅ |
| 3 | Sesión, pasadas, marcadores, captura MANUAL/AUTOMÁTICO, calidad técnica, repetición, cierre y resumen | ✅ |
| 4 | Sincronización con la plataforma Django (`/api/v1`): sesiones, pasadas, secuencias, incidencias y fotos por ticket directo a Cloudinary; reintentos, fotos tardías, sincronización automática con Wi-Fi | ✅ v0.4.0 |
| 5 | Validación en iPhone (las tres funciones) | ⏳ Siguiente |
| 6 | Campo y versión del piloto (3 Android) | ⏳ |

**Arquitectura:** la app habla **solo con la plataforma Django por HTTPS** (`https://monitoreo.agricolariachuelo.org/api/v1`).
Django guarda los datos en Supabase y firma un *ticket* para que la app suba cada foto **directo a Cloudinary**. La app
nunca usa claves de Supabase ni de Cloudinary. El análisis con IA (YOLO) corre en el servidor.

---

## 1. Requisitos

- **Node.js 20 LTS o 22 LTS** y npm.
- **Expo Go para SDK 57** en Android y/o iPhone (versión actual de la tienda).
- PC y celular en la **misma red Wi-Fi** (o usar `npm run start:tunnel`).
- Para el APK: una cuenta gratuita en <https://expo.dev>.

## 2. Instalar y ejecutar en Expo Go (Android e iOS)

```bash
npm install
npm start            # = expo start --go -c  → muestra el QR para Expo Go
```

- **Android:** abre Expo Go → *Scan QR code*.
- **iPhone:** escanea el QR con la app **Cámara**.
- Si el celular no conecta (redes de universidad, firewall de Windows): `npm run start:tunnel`.

> El proyecto incluye `expo-dev-client` para el APK de desarrollo; por eso `npm start` fuerza `--go`.
> Para abrir el APK de desarrollo usa `npm run start:dev`.

### Cuentas de prueba (backend simulado, sin servidor)

| Correo | Contraseña | Resultado |
|---|---|---|
| `operador@demo.pe` | `Demo2026` | Operador de campo (flujo normal) |
| `supervisor@demo.pe` | `Demo2026` | Supervisor |
| `admin@demo.pe` | `Demo2026` | Administrador |
| `temporal@demo.pe` | `Temp2026` | Obliga a cambiar la contraseña |
| `pendiente@demo.pe` | cualquiera | Cuenta pendiente de aprobación |
| `bloqueado@demo.pe` | cualquiera | Cuenta bloqueada |

En la pantalla de login aparecen como accesos rápidos mientras se usa el backend simulado.
El primer login necesita internet (el simulado también lo verifica); después se puede entrar **sin internet**
durante 7 días (verificador PBKDF2 en SecureStore; la contraseña nunca se guarda).

## 3. Qué probar en Expo Go (un solo celular)

1. **Login** con logo animado, validación por campo, sonidos y vibración en los botones.
2. **Función del dispositivo (después de CADA login):** tarjetas *Controlador*, *Cámara 1* y *Cámara 2*; se toca
   una y se confirma con «Usar como …». La función guardada aparece como *Actual*. Si el celular tiene una sesión
   de monitoreo abierta o fotos por enviar, las otras funciones se ven bloqueadas con el motivo (RN-15, ADR 0005).
   **Permisos:** ubicación (controlador) o cámara (cámaras). Al reabrir la app con la sesión guardada se entra
   directo a la función guardada; para cambiarla: *Ajustes › Cambiar función* o cerrar sesión y volver a entrar.
3. **Controlador (con simulador):** en Expo Go no existen sockets TCP, así que el controlador usa
   **dos cámaras virtuales** que se comportan como celulares reales (conexión, latencia, fotos de muestra
   útiles/oscuras/borrosas, reconexión).
   - Nueva sesión → modo **MANUAL** (intervalo desactivado) o **AUTOMÁTICO** (intervalo 1–5 s).
   - Vincular (QR) → las cámaras virtuales se conectan solas → **Prueba corta** → **Nueva pasada**.
   - En la pasada: *Capturar*, *Pausar/Reanudar*, *Cambiar marcador* (en AUTOMÁTICO solo en pausa:
     PAUSAR → CAMBIAR MARCADOR → CONFIRMAR → REANUDAR), repetición de fotos rechazadas, cerrar pasada,
     resumen de sesión.
   - *Herramientas de simulación* (plegable): cortar una cámara 10 s o forzar una foto oscura.
4. **Cámara 1 / Cámara 2 → Escanear QR (PANT-30):** función de la cámara, estado de red, batería, espacio y la IP
   del Wi-Fi; lector del QR del controlador con *Reintentar*. Al leer el QR la cámara se vincula y pasa a
   *Cámara en sesión* (PANT-31). En Expo Go la cámara sí puede vincularse, pero solo con un controlador instalado
   como APK (el controlador de Expo Go usa cámaras simuladas y no abre un servidor real).
5. **Cámara → Modo prueba:** usa la cámara real del celular.
   - **Manual:** botón de disparo.
   - **Automático:** solo dispara cuando el acelerómetro y el giroscopio indican que el celular está
     **quieto y estable** (anillo de estabilidad en pantalla). Si se mueve, espera y no toma la foto.
   - Cada foto pasa por el control de calidad (exposición y nitidez) y se guarda localmente.
6. **Galería:** ver las fotos guardadas (pantalla completa, deslizar, datos de calidad, filtro, borrar pruebas).
7. **Ajustes:** sonidos y vibración on/off, datos del dispositivo, cambio de función. *Cerrar sesión* está
   junto a *Ajustes* en la cabecera.

## 4. Vinculación real entre 3 celulares Android (APK con EAS)

El **controlador** necesita abrir un servidor TCP (`react-native-tcp-socket`), que **no existe en Expo Go**.
Por eso la vinculación real se prueba con un **APK**:

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure        # solo la primera vez (vincula el projectId)
npm run build:apk                          # perfil "preview": APK instalable, backend simulado
# o: npm run build:apk:dev                 # perfil "development": APK con dev client (npm run start:dev)
```

Al terminar, EAS da un enlace/QR para descargar el `.apk`; instálalo en los celulares Android
(permitir "instalar apps desconocidas").

**Prueba de Fase 2/3 en campo:**
1. Los 3 celulares en la **misma red Wi-Fi o hotspot** (el controlador puede ser el hotspot).
2. Controlador (APK): Nueva sesión → Vincular → muestra el QR.
3. Cada cámara (APK, o también Expo Go: el cliente de cámara usa APIs incluidas en Expo Go) escanea el QR
   y queda como Cámara 1 / Cámara 2.
4. Prueba corta → Nueva pasada → captura MANUAL o AUTOMÁTICA. Las fotos viajan por HTTP al controlador
   con verificación MD5 y quedan en su galería.

## 5. Validación

```bash
npm run typecheck    # TypeScript estricto
npm run lint         # ESLint (eslint-config-expo)
npm test             # Jest: dominio, reglas, protocolo, WebSocket, HTTP, auth, reintentos (E.7), subida a Cloudinary
                     # (E.8), planificador y datos de la sincronización, calidad, configuración y función del celular
npm run validate     # las tres anteriores
npm run doctor       # expo-doctor (requiere internet)
```

Pruebas de contrato con la plataforma (código real de `src/` en Node, Node 22.5+): ver `tools/verificacion/README.md`.

```bash
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/simulado.ts      # sin servidor
npx tsx --tsconfig tools/verificacion/tsconfig.json tools/verificacion/integracion.ts   # plataforma en la laptop
```

Resultados de la v0.4.0: `docs/evidencias/fase4_integracion.md`.

## 6. Estructura

```
app/                 Pantallas (Expo Router). (auth) login/registro, (setup) función/permisos,
                     controller/* flujo del controlador, camera/* flujo de cámara, gallery, settings
src/config/          Parámetros CFG-2 (nada "mágico" en el código) y variables de entorno
src/domain/          Tipos, máquinas de estado y reglas de negocio puras (probadas)
src/protocol/        Contrato del protocolo local v1 + esquemas zod
src/local-network/   WebSocket/HTTP propios, cliente de cámara, simulador y selector real/simulado
src/controller/      Orquestación del controlador (sesión, pasadas, secuencias, ACK, heartbeat)
src/camera/          Agente de cámara, captura, cola de transferencia, retención
src/device/          Cámara, GPS, batería, red, estabilidad (sensores), calidad de imagen, galería
src/auth/            Login online/offline, tokens, validaciones
src/storage/         SQLite (migraciones + repositorios), SecureStore, archivos
src/api/             Cliente de la plataforma Django /api/v1, subida directa a Cloudinary con ticket y backend simulado
src/sync/            Sincronización (Fase 4): motor, planificador, datos del contrato, reintentos y subida de fotos
tools/verificacion/  Pruebas de contrato en Node contra la plataforma (no van en el APK)
src/ui/              Tema, textos (strings.ts / messages.ts), sonidos/vibración y componentes animados
__tests__/           Pruebas Jest
docs/                ADR, cambios, evidencias y documentos de referencia (maestro y contexto)
```

Cada archivo empieza con un comentario **QUÉ HACE** y, cuando aplica, qué parte del contrato con la plataforma usa.

## 7. Conectar con la plataforma (Fase 4)

### APK del piloto (3 celulares Android)

```bash
npm run build:apk:piloto     # perfil "piloto": https://monitoreo.agricolariachuelo.org, sin backend simulado
```

- Los **tres** celulares deben tener la **misma versión** (hoy 0.4.5): en `piloto` la vinculación lo exige (RN-17).
- Las cuentas de los operadores se crean desde la app (*Crear cuenta*) y el administrador las aprueba en la web con
  el rol «Operador de campo». El administrador también puede usar la app.
- Primer uso del controlador: *Catálogos › Actualizar* (con internet) para bajar lotes, hileras y marcadores reales.

### Probar con la plataforma en la laptop o con el piloto desde Expo Go

Crea `.env` (ver `.env.example`):

```bash
EXPO_PUBLIC_API_URL=http://<IP-de-la-laptop>:8000     # o https://monitoreo.agricolariachuelo.org
EXPO_PUBLIC_USE_MOCK_API=0
EXPO_PUBLIC_APP_ENV=dev
```

Login, catálogos, sincronización y Ajustes › *Probar conexión* funcionan en Expo Go (el controlador usa las cámaras
simuladas). En la laptop: `python manage.py runserver 0.0.0.0:8000` y `sembrar_demo` para las cuentas `@demo.pe`.

### Qué hace la sincronización (PANT-20, Controlador › Sincronizar)

1. Al **cerrar una sesión** se arma la cola: sesión → pasadas → secuencias (lotes de 200) → fotos → incidencias →
   cierre. Nada se borra del celular.
2. **«Sincronizar ahora»** (con internet y acceso validado con internet): envía todo en orden; cada foto pide un
   ticket a Django, se sube **directo a Cloudinary** y se confirma en Django. Muestra el avance (permiso de subida,
   subida, confirmación y MB) y se puede **Detener**. Con datos móviles pide confirmación con el tamaño.
3. **Automática:** con la app abierta, Wi-Fi y sin una sesión de monitoreo abierta (al volver el internet, al volver
   a la app, al cerrar una sesión y cada 5 minutos).
4. Errores: la red o el servidor caído **no** cuentan como intento (se reintenta con espera: 1, 5, 15, 60 min).
   Los errores que necesitan revisión (p. ej. `FOTO_DEMASIADO_GRANDE`, `CAPTURE_CONFLICT`) se ven con su código y
   «Reintentar errores» los vuelve a la cola. Una sesión queda **Sincronizada** cuando todo llegó; una foto tardía
   la vuelve a abrir hasta enviarla.
5. Con datos pendientes el controlador **no puede cambiar de función** (RN-15); con errores solo se avisa.

### IA (YOLO)

La app no necesita cambios para la IA: su trabajo termina cuando Django confirma la foto (SINCRONIZADO). Django crea
la tarea de análisis en la misma transacción (solo fotos UTILIZABLE o PENDIENTE_REVISION_TECNICA) y el *worker* de la
plataforma la procesa. Mientras no haya un modelo activo, las fotos quedan esperando; al activar el modelo entrenado
en el servidor (`deploy/modelos/modelo.onnx` + configuración activa en `/gestion/`), el worker encola y analiza todas
las fotos pendientes, incluidas las ya sincronizadas. Los resultados se revisan en la web: la API nunca devuelve
resultados de IA ni URLs de fotos a la app (maestro §28.10).

## 8. Limitaciones conocidas

- **Expo Go no puede ser controlador real** (sin sockets TCP): usa el simulador. El APK sí.
- La sincronización corre **con la app abierta** (no en segundo plano). Durante «Sincronizar ahora» la pantalla
  se mantiene encendida.
- `react-native-tcp-socket` es una librería comunitaria; si fallara con la Nueva Arquitectura de RN 0.86,
  la alternativa documentada es la opción B (ver `docs/adr/0003-red-local.md`).
- Los umbrales de calidad (perfil Q0) y de estabilidad son iniciales y se calibran en campo
  (`src/config/defaults.ts`). Si la plataforma publica un perfil de calidad, el controlador lo aplica y lo pasa a
  las cámaras.
- Pendiente en el piloto: CP-38 y CP-41 con Cloudinary real y la prueba de campo con 3 celulares Android.
- iOS: la vinculación real no se probó (el piloto es Android); Expo Go en iPhone sirve para login, simulador,
  sincronización, modo prueba de cámara y galería (Fase 5).
