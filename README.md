# Riachuelo Monitoreo — App móvil (Fases 0 a 3)

App móvil del sistema de monitoreo fitosanitario de vid de **Agrícola Riachuelo** (Curso Integrador II).
Un celular **controlador** dirige a dos celulares **cámara** que toman fotos sincronizadas de los dos laterales
de la hilera. Construida con **Expo SDK 57**, Expo Router, TypeScript estricto y SQLite local.

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Base del proyecto, configuración CFG-2, estructura por capas, pruebas | ✅ |
| 1 | Login (online y sin internet), registro, recuperación, cambio de contraseña, función del dispositivo, permisos | ✅ |
| 2 | Vinculación por QR, protocolo local v1 (WebSocket + HTTP), prueba corta, simulador con 2 cámaras virtuales | ✅ |
| 3 | Sesión, pasadas, marcadores, captura MANUAL/AUTOMÁTICO, calidad técnica, repetición, cierre y resumen | ✅ |
| 4 | Sincronización con el backend web y la base de datos central | ⏳ Pendiente (la UI muestra "Pendiente") |

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
2. **Función del dispositivo:** *Controlador* o *Cámara*. **Permisos:** cámara y ubicación.
3. **Controlador (con simulador):** en Expo Go no existen sockets TCP, así que el controlador usa
   **dos cámaras virtuales** que se comportan como celulares reales (conexión, latencia, fotos de muestra
   útiles/oscuras/borrosas, reconexión).
   - Nueva sesión → modo **MANUAL** (intervalo desactivado) o **AUTOMÁTICO** (intervalo 1–5 s).
   - Vincular (QR) → las cámaras virtuales se conectan solas → **Prueba corta** → **Nueva pasada**.
   - En la pasada: *Capturar*, *Pausar/Reanudar*, *Cambiar marcador* (en AUTOMÁTICO solo en pausa:
     PAUSAR → CAMBIAR MARCADOR → CONFIRMAR → REANUDAR), repetición de fotos rechazadas, cerrar pasada,
     resumen de sesión.
   - *Herramientas de simulación* (plegable): cortar una cámara 10 s o forzar una foto oscura.
4. **Cámara → Modo prueba:** usa la cámara real del celular.
   - **Manual:** botón de disparo.
   - **Automático:** solo dispara cuando el acelerómetro y el giroscopio indican que el celular está
     **quieto y estable** (anillo de estabilidad en pantalla). Si se mueve, espera y no toma la foto.
   - Cada foto pasa por el control de calidad (exposición y nitidez) y se guarda localmente.
5. **Galería:** ver las fotos guardadas (pantalla completa, deslizar, datos de calidad, filtro, borrar pruebas).
6. **Ajustes:** sonidos y vibración on/off, datos del dispositivo, cambio de función. *Cerrar sesión* está
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
npm test             # Jest: 8 suites, 45 pruebas (dominio, reglas, protocolo, WebSocket, HTTP, auth, reintentos, calidad)
npm run validate     # las tres anteriores
npm run doctor       # expo-doctor (requiere internet)
```

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
src/api/             Cliente HTTP y backend simulado (mock) — se reemplaza por la API web en Fase 4
src/sync/            Cola de sincronización (Fase 4: pendiente) y política de reintentos
src/ui/              Tema, textos (strings.ts / messages.ts), sonidos/vibración y componentes animados
__tests__/           Pruebas Jest
docs/                ADR, cambios, evidencias y documentos de referencia (maestro y contexto)
```

Cada archivo empieza con un comentario **QUÉ HACE** y, cuando aplica, **INTEGRACIÓN FUTURA** (qué cambia
al conectar la web/base de datos). Busca `INTEGRACIÓN FUTURA` o `Fase 4` para ver los puntos de conexión.

## 7. Conectar con el backend real (Fase 4)

1. Copia `.env.example` a `.env` y define `EXPO_PUBLIC_API_URL=https://...` y `EXPO_PUBLIC_USE_MOCK_API=0`.
2. `src/api/index.ts` elige automáticamente el cliente real (`authApi`, `bootstrapApi`, `syncApi`).
3. Implementar `src/sync/syncService.ts` (hoy devuelve "Pendiente") siguiendo el orden padre → hijo del maestro.

## 8. Limitaciones conocidas

- **Expo Go no puede ser controlador real** (sin sockets TCP): usa el simulador. El APK sí.
- `react-native-tcp-socket` es una librería comunitaria; si fallara con la Nueva Arquitectura de RN 0.86,
  la alternativa documentada es la opción B (ver `docs/adr/0003-red-local.md`).
- Los umbrales de calidad (perfil Q0) y de estabilidad son iniciales y se calibran en campo
  (`src/config/defaults.ts`).
- iOS: la vinculación real no se probó (el piloto es Android); Expo Go en iPhone sirve para login, simulador,
  modo prueba de cámara y galería.
