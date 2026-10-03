CONTEXTO TÉCNICO PARA OTRA IA
PROYECTO: APP MÓVIL RIAchuelo / MONITOREO FITOSANITARIO
OBJETIVO DE ESTE ARCHIVO:
Dejar documentados los errores reales encontrados al intentar ejecutar la primera versión del proyecto en Windows + VS Code + iPhone + Expo Go, las correcciones aplicadas, el estado final alcanzado y, sobre todo, las reglas que otra IA debe considerar SI CONSTRUYE LA APP DESDE CERO para evitar repetir los mismos problemas.

IMPORTANTE:
Este archivo no es una especificación funcional completa del proyecto. Es un documento de "lecciones técnicas de instalación y arranque".
La IA que construya la siguiente versión debe usar además el Archivo Maestro del proyecto para la lógica, pantallas, arquitectura y reglas de negocio.


======================================================================
1. ENTORNO REAL DONDE SE PROBÓ
======================================================================

Sistema de desarrollo:
- Windows 10/11.
- VS Code.
- PowerShell.
- Node instalado finalmente y operativo.
- Versión de Node que se comprobó funcionando en la PC: v24.19.0.
- npm comprobado funcionando: 11.17.0 en una parte del proceso.
- Teléfono de prueba principal: iPhone.
- Cliente móvil: Expo Go.
- Expo Go instalado en el iPhone correspondía a SDK 57.0.0.
- Usuario Expo autenticado correctamente al final:
  npx expo whoami
  -> oscar2020

Ruta local usada durante las pruebas:
C:\Users\oscos\Downloads\riachuelo-mobile-v0.1

Estado final confirmado:
- npm instala dependencias.
- Expo SDK 57 configurado.
- `npx expo config` funciona.
- `npx expo install --fix` indica dependencias actualizadas.
- `npx expo-doctor@latest` pasa 20/21 checks.
- El único check pendiente estaba relacionado con `.expo/` y Git; NO impedía ejecutar la app.
- `npx expo start -c` inicia Metro correctamente y genera QR para Expo Go.
- Metro quedó escuchando, por ejemplo, en:
  exp://192.168.18.44:8081

PUNTO AÚN NO CONFIRMADO EN ESTE RESUMEN:
Después de la migración definitiva a SDK 57 se llegó hasta Metro + QR. Todavía debe verificarse que todas las pantallas y módulos de la aplicación abran sin errores de runtime en el iPhone.


======================================================================
2. ERROR 1: NODE Y NPM NO EXISTÍAN EN WINDOWS
======================================================================

Síntoma inicial:

npm install

devolvía:
"npm : El término 'npm' no se reconoce..."

También:
node -v

devolvía:
"node : El término 'node' no se reconoce..."

CAUSA:
Node.js no estaba instalado correctamente o no estaba disponible en PATH.

CORRECCIÓN:
Instalar Node.js y cerrar/reabrir VS Code o la terminal para refrescar PATH.

COMPROBACIÓN:
node -v

Resultado obtenido:
v24.19.0

REGLA PARA LA IA QUE CONSTRUYA DESDE CERO:
ANTES de crear o instalar el proyecto, debe verificar explícitamente:

node -v
npm -v

No asumir que Node existe.

Si alguno falla, resolver Node/PATH ANTES de tocar dependencias de Expo.

Nunca diagnosticar errores de `npm install` como problemas del proyecto si `npm` ni siquiera es reconocido por Windows.


======================================================================
3. ERROR 2: POWERSHELL BLOQUEABA npm.ps1
======================================================================

Después de instalar Node, apareció:

"No se puede cargar el archivo C:\Program Files\nodejs\npm.ps1 porque la ejecución de scripts está deshabilitada..."

Código:
PSSecurityException
UnauthorizedAccess

CAUSA:
PowerShell tenía una política de ejecución que impedía ejecutar `npm.ps1`.

CORRECCIÓN QUE DEBE CONSIDERARSE:
Una opción habitual es:

Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

Luego cerrar y abrir PowerShell/VS Code.

Alternativa si no se quiere cambiar la política:
npm.cmd
npx.cmd

Por ejemplo:
npm.cmd install
npx.cmd expo start

COMPROBACIÓN:
npm -v

Finalmente respondió con una versión real.

REGLA PARA LA IA:
En Windows + PowerShell, si Node existe pero npm da PSSecurityException, NO reinstalar Node inmediatamente.
Primero comprobar la ExecutionPolicy o usar `npm.cmd` / `npx.cmd`.


======================================================================
4. ERROR ESTRUCTURAL MÁS IMPORTANTE: SE CREÓ EL PROYECTO CON SDK 54
   PERO EL IPHONE TENÍA EXPO GO SDK 57
======================================================================

La primera versión se construyó según el documento maestro original, que fijaba Expo SDK 54.

`npx expo start` arrancó correctamente, Metro generó QR, pero al escanearlo en iPhone Expo Go mostró:

"Project is incompatible with this version of Expo Go"

Datos concretos:
- Expo Go del iPhone: SDK 57.0.0.
- Proyecto: SDK 54.

Además, Expo Go en iOS físico no permitía instalar una versión antigua para SDK 54.

ESTE FUE EL ERROR DE DISEÑO DE ENTORNO MÁS COSTOSO.

CAUSA:
La documentación del proyecto estaba basada en SDK 54, pero el entorno real de ejecución en octubre de 2026 ya tenía Expo Go SDK 57.

LECCIÓN CRÍTICA:
SI EL OBJETIVO ES EJECUTAR INMEDIATAMENTE EN IPHONE FÍSICO CON EXPO GO, LA IA NO DEBE CREAR EL PROYECTO USANDO UN SDK ANTIGUO SOLO PORQUE UN DOCUMENTO ANTERIOR LO FIJA.

ANTES DE GENERAR LA APP:
1. Confirmar qué SDK soporta el Expo Go actualmente instalado en el iPhone.
2. Crear el proyecto directamente con esa versión compatible.
3. Registrar como decisión técnica que el stack del documento maestro debe actualizarse.

PARA ESTE PROYECTO, LA NUEVA BASE DEBE CONSIDERAR:
- Expo SDK 57.
- React Native 0.86.x (durante la migración quedó 0.86.3).
- React 19.2.x (se usó 19.2.3 durante la migración).
- Expo Router compatible con SDK 57.
- Node moderno; la PC actual funciona con Node 24.19.0.

RECOMENDACIÓN PARA UNA CONSTRUCCIÓN NUEVA:
Preferir crear desde la plantilla ACTUAL soportada por Expo en vez de fijar manualmente paquetes viejos.

Ejemplo conceptual:
npx create-expo-app@latest riachuelo-mobile --template blank-typescript

Después instalar módulos con:
npx expo install <paquetes>

No copiar un package.json de SDK 54 a un proyecto que se ejecutará en Expo Go SDK 57.


======================================================================
5. ERROR: INTENTAR ACTUALIZAR SOLO `expo` A SDK 57
======================================================================

Se intentó:

npm install expo@^57.0.0

y apareció:
ERESOLVE
Conflictos entre:
- React 19.1.0
- react-dom 19.3.0
- expo-router 6.0.24
- dependencias asociadas a SDK 54

CAUSA:
El package.json mezclaba versiones de SDK 54 con Expo 57.

ERROR DE ENFOQUE:
Cambiar solo:
expo = 57

NO convierte un proyecto completo de SDK 54 a SDK 57.

Expo, React, React Native, Expo Router y todos los módulos Expo deben estar alineados.

REGLA PARA LA IA:
Nunca actualizar solo `expo`.
Nunca mezclar manualmente:
- Expo SDK 57
- expo-router del SDK 54
- expo-constants del SDK 54
- React de una generación diferente
- React Native de otra generación

Si se construye desde cero, esto debe evitarse por completo creando el proyecto directamente en SDK 57.

Si se migra uno existente:
- limpiar dependencias incompatibles;
- instalar la base coherente;
- dejar que `npx expo install` elija versiones compatibles.


======================================================================
6. ERROR: expo-constants Y OTROS MÓDULOS DE SDK 54 QUEDARON FIJADOS
======================================================================

Luego del primer intento de migración apareció otro ERESOLVE.

Ejemplo:
Found:
expo-constants@18.0.14

Pero Expo Router 57 necesitaba una versión compatible con SDK 57.

CAUSA:
El package.json seguía teniendo paquetes viejos fijados manualmente.

Durante la corrección se eliminaron temporalmente dependencias antiguas como:
- expo-router
- expo-application
- expo-battery
- expo-camera
- expo-constants
- expo-crypto
- expo-device
- expo-file-system
- expo-image-manipulator
- expo-keep-awake
- expo-linking
- expo-location
- expo-network
- expo-secure-store
- expo-sharing
- expo-sqlite
- expo-status-bar
- react-native-safe-area-context
- react-native-screens
- jest-expo
- eslint-config-expo

LECCIÓN:
NO fijar manualmente versiones de todos los módulos Expo cuando se parte de cero.

FORMA RECOMENDADA:
Primero tener Expo SDK correcto.
Después:

npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar expo-sqlite expo-file-system expo-secure-store expo-camera expo-image-manipulator expo-location expo-crypto expo-device expo-application expo-battery expo-keep-awake expo-network expo-sharing

El comando `expo install` selecciona versiones compatibles con el SDK activo.

REGLA:
Para módulos de Expo usar `npx expo install`, no `npm install paquete@numero-inventado`, salvo que exista una razón técnica documentada.


======================================================================
7. ERROR: expo-router FUE BORRADO DEL PACKAGE.JSON PERO SEGUÍA EN app.json
======================================================================

Después de limpiar dependencias, apareció:

PluginError:
Failed to resolve plugin for module "expo-router"

CAUSA:
`app.json` tenía:
"plugins": [
  "expo-router",
  ...
]

pero `expo-router` no estaba instalado en `node_modules`.

Expo intenta resolver los config plugins declarados en app.json al arrancar y al ejecutar `expo config`.

CORRECCIÓN:
Reinstalar Expo Router compatible:
npm install expo-router@~57.0.21

Luego se terminó instalando una versión 57 compatible (en el entorno llegó a expo-router 57.0.24).

Después:
npx expo install --fix

REGLA CRÍTICA PARA LA IA:
CADA plugin declarado en `app.json` debe corresponder con un paquete realmente instalado.

Antes de entregar un proyecto:
- revisar `app.json`;
- revisar `package.json`;
- asegurarse de que no exista un plugin declarado cuyo paquete falte.

No crear:
"plugins": ["expo-router", "expo-camera", ...]
si esos módulos no están instalados.


======================================================================
8. ERROR: `expo install --fix` NO PUEDE INSTALAR LO QUE YA NO EXISTE
   EN PACKAGE.JSON
======================================================================

En un momento se ejecutó:

npx expo install --fix

y decía:
Dependencies are up to date

Pero Expo Doctor seguía fallando porque faltaban módulos.

LECCIÓN:
`expo install --fix` sirve para ALINEAR versiones de dependencias presentes.
No debe tratarse como un instalador mágico que adivina todos los módulos que el código y `app.json` requieren.

CORRECCIÓN:
Instalar explícitamente los módulos necesarios con:

npx expo install ...

y solo después ejecutar:
npx expo install --fix

REGLA PARA LA IA:
Orden correcto:
1. Crear proyecto con SDK correcto.
2. Instalar explícitamente módulos usados.
3. Ejecutar `npx expo install --fix`.
4. Ejecutar `npx expo config`.
5. Ejecutar `npx expo-doctor@latest`.


======================================================================
9. `npx expo config` FUE LA PRUEBA CLAVE PARA CONFIG PLUGINS
======================================================================

Antes de corregir módulos, Expo Doctor fallaba con:

node ... expo\bin\cli config --json --full exited with non-zero code: 1

No mostraba claramente el plugin causante.

Una prueba más directa fue:

npx expo config

Una vez corregidos los módulos, `npx expo config` funcionó y mostró:

name: 'Riachuelo Monitoreo'
slug: 'riachuelo-mobile'
version: '0.1.0'
sdkVersion: '57.0.0'
platforms: ios, android, web

Plugins resueltos:
- expo-router
- expo-sqlite
- expo-secure-store
- expo-camera
- expo-location
- expo-status-bar
- expo-sharing

Versiones observadas en pluginHistory:
- expo-sqlite: 57.0.3
- expo-secure-store: 57.0.4
- expo-camera: 57.0.6
- expo-location: 57.0.20
- expo-status-bar: 57.0.1
- expo-sharing: 57.0.22

Estas versiones son una referencia del entorno que llegó a resolver correctamente la configuración.
NO se recomienda que otra IA las fuerce manualmente si `npx expo install` selecciona versiones compatibles más nuevas dentro de SDK 57.

REGLA:
Después de definir app.json:
npx expo config

DEBE FUNCIONAR antes de considerar que el proyecto está listo.


======================================================================
10. ERROR DE RED DURANTE `npm install`: ECONNRESET
======================================================================

En un intento apareció:

npm error code ECONNRESET
npm error network aborted

Además hubo avisos:
EPERM: operation not permitted
al intentar limpiar partes de node_modules.

CAUSA:
- descarga npm interrumpida;
- posible conexión inestable;
- directorios parcialmente bloqueados en Windows después del intento.

COMPROBACIONES REALIZADAS:

npm cache verify

npm ping
Resultado:
PONG

npm config get registry
Resultado:
https://registry.npmjs.org/

npm config get proxy
Resultado:
null

npm config get https-proxy
Resultado:
null

REINTENTO QUE FUNCIONÓ:

npm install --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

Resultado exitoso:
added 694 packages, and audited 695 packages

REGLA PARA LA IA:
Un ECONNRESET NO debe desencadenar cambios de versiones del proyecto.
Primero tratarlo como fallo de red.

Secuencia útil:
taskkill /F /IM node.exe
Remove-Item -Recurse -Force .\node_modules -ErrorAction SilentlyContinue
Remove-Item -Force .\package-lock.json -ErrorAction SilentlyContinue
npm cache verify
npm ping
npm config get registry
npm config get proxy
npm config get https-proxy

y luego reintentar con fetch retries.

IMPORTANTE:
No borrar o modificar archivos de código por un error ECONNRESET.


======================================================================
11. AVISOS `deprecated`, `ERESOLVE overriding peer dependency`
   Y VULNERABILIDADES
======================================================================

Durante la instalación aparecieron múltiples WARN:
- deprecated inflight
- deprecated glob
- deprecated uuid
- deprecated eslint
- ERESOLVE overriding peer dependency
- react-native-worklets peer warnings

También aparecieron:
12 vulnerabilities
luego 15
luego 16
según la composición de dependencias.

ESTOS AVISOS NO FUERON EL ERROR QUE IMPEDÍA ARRANCAR METRO.

REGLA:
Distinguir:
- `npm WARN` -> advertencia;
- `npm ERR!` -> fallo real.

MUY IMPORTANTE:
NO ejecutar automáticamente:

npm audit fix --force

porque puede introducir breaking changes y romper el árbol de dependencias de Expo.

Para una primera versión que necesita ejecutarse:
- primero asegurar compatibilidad de Expo;
- después analizar vulnerabilidades por separado;
- no forzar actualizaciones a ciegas.


======================================================================
12. EXPO LOGIN EN IPHONE / CUENTA EXPO
======================================================================

Se intentó:
npx expo login

Primero falló por credenciales incorrectas.

Después se corrigió.

Comprobación definitiva:
npx expo whoami

Resultado:
oscar2020

REGLA:
No asumir que un login sin mensaje significa que todo está bien.
Siempre comprobar:

npx expo whoami

En el iPhone, Expo Go debe estar listo con la cuenta que corresponda cuando la versión actual lo requiera.


======================================================================
13. `.expo/` Y EXPO DOCTOR
======================================================================

Resultado:
20/21 checks passed.

Único problema reportado:
"The .expo directory is not ignored by Git."

Se intentó:
Add-Content .gitignore ".expo/"

pero Expo Doctor SIGUIÓ mostrando el mismo check pendiente.

Esto NO bloqueó:
npx expo start -c

Metro arrancó normalmente.

LECCIÓN:
Es un problema de higiene del repositorio, no del runtime.

En una nueva construcción debe existir DESDE EL PRINCIPIO en `.gitignore`:

.expo/
node_modules/
.env
dist/

Y debe comprobarse:

git check-ignore -v .expo

Si no aparece ignorado:
- revisar que realmente exista `.gitignore`;
- revisar codificación/formato;
- revisar si Git está inicializado;
- revisar reglas superiores de Git;
- no asumir que `Add-Content` resolvió el problema solo porque no produjo error.

REGLA:
La nueva IA debe generar `.gitignore` correcto desde la creación del proyecto.


======================================================================
14. ESTADO CORRECTO ALCANZADO
======================================================================

Al final:

npx expo install --fix
-> Dependencies are up to date

npx expo config
-> funciona
-> sdkVersion: 57.0.0
-> plugins resolubles

npx expo-doctor@latest
-> 20/21
-> único aviso: .expo no ignorado por Git

npx expo whoami
-> oscar2020

npx expo start -c
-> Starting Metro Bundler
-> QR generado
-> Using Expo Go
-> exp://192.168.18.44:8081

POR LO TANTO:
El entorno y la estructura de Expo quedaron suficientemente corregidos para continuar probando la app.


======================================================================
15. CÓMO DEBERÍA CONSTRUIRSE DESDE CERO PARA EVITAR TODO LO ANTERIOR
======================================================================

La siguiente IA NO debe "repetir la migración".
Debe iniciar ya con el entorno actual correcto.

ORDEN RECOMENDADO:

PASO 1 — comprobar entorno
node -v
npm -v

Si PowerShell bloquea npm:
resolver ExecutionPolicy o usar npm.cmd/npx.cmd.

PASO 2 — confirmar Expo Go del teléfono
Antes de crear la app, verificar el SDK actual de Expo Go que se usará físicamente.
Para este contexto se trabajó finalmente con SDK 57.

PASO 3 — crear proyecto nuevo con Expo actual
Preferir:
npx create-expo-app@latest riachuelo-mobile --template blank-typescript

No crear una plantilla SDK 54.

PASO 4 — instalar Expo Router y módulos mediante Expo
Ejemplo:

npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar

Después los módulos del proyecto:

npx expo install expo-sqlite expo-file-system expo-secure-store expo-camera expo-image-manipulator expo-location expo-crypto expo-device expo-application expo-battery expo-keep-awake expo-network expo-sharing

NO asignar números antiguos copiados del Archivo Maestro.

PASO 5 — instalar librerías JavaScript puras
Solo si siguen siendo necesarias según el código:
- zustand
- zod
- jpeg-js
- @noble/hashes

Estas no deben mezclarse a ciegas con versiones antiguas; revisar compatibilidad actual.

PASO 6 — configurar Expo Router correctamente
package.json:
"main": "expo-router/entry"

app.json:
plugin "expo-router"

Y confirmar que `expo-router` realmente está instalado.

PASO 7 — app.json
Agregar únicamente config plugins que estén instalados.

Ejemplos del proyecto:
- expo-router
- expo-sqlite
- expo-secure-store
- expo-camera
- expo-location
- expo-status-bar
- expo-sharing

No dejar plugins huérfanos.

PASO 8 — crear `.env.example`
Variables del proyecto:
EXPO_PUBLIC_API_URL=
EXPO_PUBLIC_USE_MOCK_API=1
EXPO_PUBLIC_APP_ENV=dev

`.env` real fuera de Git.

PASO 9 — `.gitignore`
Debe contener desde el comienzo:
node_modules/
.expo/
.env
dist/
*.log

PASO 10 — instalar
npm install

Si falla por red ECONNRESET:
NO modificar stack.
Revisar red/caché y reintentar.

PASO 11 — alinear
npx expo install --fix

PASO 12 — validar configuración
npx expo config

ESTE COMANDO DEBE FUNCIONAR.

PASO 13 — diagnóstico
npx expo-doctor@latest

Objetivo ideal:
21/21.

Si solo falla `.expo/`, es Git y no debe confundirse con un fallo de ejecución.

PASO 14 — autenticación Expo
npx expo whoami

Si no existe sesión:
npx expo login

PASO 15 — iniciar limpio
npx expo start -c

Escanear QR desde Expo Go.


======================================================================
16. REGLAS DE DISEÑO DEL PROYECTO QUE SE DEBEN CONSERVAR
======================================================================

Aunque el SDK cambió de 54 a 57, la arquitectura conceptual original sí debe conservarse.

La app utiliza:
- React Native + Expo.
- TypeScript.
- Expo Router.
- SQLite local.
- SecureStore.
- Cámara.
- Ubicación/GPS.
- File System.
- Image Manipulator.
- Device/Application info.
- Battery.
- Keep Awake.
- Network.
- Sharing.
- Zustand.
- Zod.

La estructura prevista incluye:

app/
  (auth)/
  (setup)/
  controller/
  camera/

src/
  api/
  auth/
  camera/
  config/
  controller/
  device/
  diagnostics/
  domain/
  local-network/
    client/
    simulator/
    tcp/
  protocol/
  storage/
    migrations/
    repositories/
  sync/
  ui/

IMPORTANTE:
La nueva IA debe crear desde el inicio TODA la estructura prevista, aunque varios archivos queden como placeholders.

Pero:
- No debe inventar lógica de fases posteriores.
- Debe implementar una primera versión funcional en Expo Go.
- La red local TCP/WebSocket real se reserva para Development Build.
- En Expo Go debe usarse simulador para probar el flujo de controlador y cámaras.
- El backend puede empezar simulado con EXPO_PUBLIC_USE_MOCK_API=1.


======================================================================
17. REGLA ESPECIAL: EXPO GO VS DEVELOPMENT BUILD
======================================================================

NO confundir ambas cosas.

EXPO GO:
Sirve en Fase 1 para:
- pantallas;
- SQLite;
- SecureStore;
- cámara;
- GPS;
- permisos;
- almacenamiento;
- backend simulado;
- cámaras virtuales/simulador;
- flujo funcional básico.

DEVELOPMENT BUILD:
Se necesitará para módulos nativos no incluidos en Expo Go, especialmente la red local real TCP/WebSocket del diseño.

Por eso:
NO instalar ni importar directamente módulos nativos incompatibles con Expo Go en rutas que se cargan durante Fase 1.

El proyecto debe poder abrir en Expo Go aunque los archivos de red real todavía existan como placeholders.

La futura fábrica de transporte debe separar:
- simulador en Expo Go;
- implementación real en Development Build.


======================================================================
18. NO HACER ESTAS COSAS DESDE CERO
======================================================================

1. NO crear SDK 54 si el iPhone usa Expo Go SDK 57.
2. NO fijar manualmente todas las versiones antiguas del documento.
3. NO instalar Expo 57 encima de un package.json lleno de módulos SDK 54.
4. NO usar `--force` o `--legacy-peer-deps` como primera solución.
5. NO ejecutar `npm audit fix --force` automáticamente.
6. NO declarar plugins en app.json si el paquete no está instalado.
7. NO asumir que `expo install --fix` instala paquetes que faltan completamente.
8. NO modificar dependencias por un ECONNRESET de red.
9. NO confundir warnings `deprecated` con errores fatales.
10. NO construir la red TCP real para Expo Go.
11. NO borrar la arquitectura de carpetas porque algunos módulos aún no estén implementados.
12. NO inventar códigos de lotes, segmentos, marcadores o contratos que el Archivo Maestro deje pendientes.
13. NO entregar el proyecto sin ejecutar:
    - npm install
    - npx expo install --fix
    - npx expo config
    - npx expo-doctor@latest
    - npx expo start -c


======================================================================
19. CHECKLIST OBLIGATORIO PARA LA IA ANTES DE ENTREGAR UNA NUEVA CARPETA
======================================================================

[ ] Node y npm comprobados.
[ ] Proyecto creado directamente para el SDK actual de Expo Go.
[ ] Expo SDK y React Native compatibles.
[ ] Expo Router compatible.
[ ] `main` = expo-router/entry.
[ ] Todos los plugins de app.json tienen paquete instalado.
[ ] Módulos Expo instalados usando `npx expo install`.
[ ] package.json no contiene restos de SDK 54.
[ ] `.env.example` presente.
[ ] `.env` ignorado.
[ ] `.expo/` ignorado.
[ ] node_modules ignorado.
[ ] `npm install` termina sin npm ERR.
[ ] `npx expo install --fix` termina correctamente.
[ ] `npx expo config` funciona.
[ ] `npx expo-doctor@latest` se revisó.
[ ] `npx expo whoami` se comprobó si Expo Go requiere cuenta.
[ ] `npx expo start -c` genera QR.
[ ] El proyecto abre en Expo Go físico.
[ ] Login mock probado.
[ ] Cambio de rol probado.
[ ] Permisos probados.
[ ] Controlador simulado probado.
[ ] Cámara modo prueba probada.
[ ] SQLite migra correctamente.
[ ] La app se cierra y vuelve a abrir sin romper el arranque.
[ ] No hay imports de módulos nativos de Fase 2 cargándose en Expo Go.


======================================================================
20. ESTADO DEL STACK QUE OTRA IA DEBE TOMAR COMO NUEVA BASE
======================================================================

La decisión original del Archivo Maestro de "Expo SDK 54" YA NO debe aplicarse de forma literal para la versión que se ejecuta ahora en el iPhone.

Para continuar desde el estado probado:
- Expo SDK 57.
- Expo Go SDK 57.
- React Native 0.86.x.
- React 19.2.x.
- Expo Router 57.x.
- Node actual del equipo: v24.19.0.
- Módulos Expo instalados con `npx expo install`.
- Backend simulado habilitado para Fase 1.
- Development Build reservado para red local real.

La arquitectura funcional, requerimientos, pantallas y capas del Archivo Maestro se mantienen; se actualiza únicamente la base tecnológica necesaria para ser compatible con el entorno actual.


======================================================================
21. OBSERVACIONES SOBRE LOS COMANDOS
======================================================================

En PowerShell, para CAMBIAR de carpeta:
cd "C:\Users\oscos\Downloads\riachuelo-mobile-v0.1"

No escribir solamente:
C:\Users\oscos\Downloads\riachuelo-mobile-v0.1

porque PowerShell intentará ejecutarlo como si fuera un comando.

Para limpiar procesos:
taskkill /F /IM node.exe

Si responde:
"no se encontró el proceso node.exe"
no es un error grave; simplemente no había Node ejecutándose.

Para arrancar Metro después de cambios grandes:
npx expo start -c

El `-c` limpia caché y debe usarse después de migraciones/importantes cambios de dependencias.


======================================================================
22. RESUMEN EJECUTIVO PARA LA IA
======================================================================

El problema principal de la primera versión NO fue la arquitectura de la app.
El problema principal fue construirla con un stack de Expo desactualizado para el Expo Go real disponible en el iPhone.

Si se rehace desde cero:
- usar SDK 57 desde el primer minuto;
- no migrar desde 54;
- no copiar las versiones antiguas;
- instalar módulos Expo con `npx expo install`;
- mantener app.json y package.json coherentes;
- validar `expo config`;
- validar `expo-doctor`;
- ejecutar físicamente con Expo Go antes de entregar.

La prioridad es:
COMPATIBILIDAD PRIMERO -> ARQUITECTURA -> FUNCIONALIDAD -> PRUEBAS.

No debe volver a ocurrir que una carpeta "teóricamente correcta" no pueda abrirse en el teléfono por una incompatibilidad de SDK que podía verificarse antes de generar el proyecto.


======================================================================
23. COMANDOS DE REFERENCIA PARA UN ARRANQUE LIMPIO
======================================================================

Verificar:
node -v
npm -v

Crear:
npx create-expo-app@latest riachuelo-mobile --template blank-typescript
cd riachuelo-mobile

Instalar navegación:
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar

Instalar módulos:
npx expo install expo-sqlite expo-file-system expo-secure-store expo-camera expo-image-manipulator expo-location expo-crypto expo-device expo-application expo-battery expo-keep-awake expo-network expo-sharing

Instalar JavaScript puro solo según necesidad:
npm install zustand zod jpeg-js @noble/hashes

Validar:
npx expo install --fix
npx expo config
npx expo-doctor@latest
npx expo whoami

Ejecutar:
npx expo start -c


======================================================================
24. ESTADO FINAL DE ESTA ETAPA
======================================================================

Se corrigieron:
- Node/npm inexistentes.
- PowerShell bloqueando npm.ps1.
- incompatibilidad Expo Go SDK 57 vs proyecto SDK 54.
- mezcla de React/React Native/Expo de distintas generaciones.
- módulos Expo antiguos.
- expo-router faltante mientras app.json lo exigía.
- config plugins no resolubles.
- ECONNRESET durante npm install.
- alineación de módulos con Expo SDK 57.
- login Expo.

Queda para la siguiente etapa:
- verificar apertura completa de la aplicación en el iPhone después de la migración;
- corregir cualquier error de runtime del código;
- conseguir 21/21 en Expo Doctor corrigiendo definitivamente `.expo/` en Git;
- continuar la implementación funcional de Fase 1 sin introducir módulos nativos de Fase 2.

======================================================================
25. AJUSTES DE INTERFAZ Y FLUJO FUNCIONAL DEFINIDOS DESPUÉS DE LA PRIMERA VERSIÓN
======================================================================

Estas decisiones corrigen detalles de experiencia de uso detectados al revisar la primera versión.
La siguiente IA DEBE aplicarlas desde el inicio y no conservar el comportamiento anterior.

----------------------------------------------------------------------
25.1 ELIMINAR EL MODO "MIXTO"
----------------------------------------------------------------------

DECISIÓN:
Eliminar por completo la opción "MIXTO" de la interfaz de creación de sesión y del flujo funcional visible para el operador.

La pantalla "Nueva sesión" debe mostrar únicamente:

- MANUAL
- AUTOMÁTICO

No debe aparecer una tercera opción "MIXTO".

MOTIVO:
El modo mixto genera ambigüedad y no aporta una diferencia clara para el flujo actual.
La operación debe quedar simple y directa.

COMPORTAMIENTO ESPERADO:

A) MODO MANUAL
- El operador decide cuándo capturar.
- La captura ocurre únicamente cuando pulsa el botón "Capturar".
- El campo/opción "Intervalo" debe quedar DESHABILITADO.
- Visualmente debe verse bloqueado con un fondo blanco/transparente o una apariencia atenuada.
- No debe permitir modificar el intervalo mientras MANUAL esté seleccionado.
- El valor puede mantenerse internamente, pero no debe participar en la captura manual.

Ejemplo visual:

[ MANUAL ✓ ]   [ AUTOMÁTICO ]

Intervalo:
[ 2 segundos ]   ← deshabilitado / atenuado / no editable

B) MODO AUTOMÁTICO
- El campo/opción "Intervalo" se habilita.
- El operador puede seleccionar el intervalo dentro de los límites configurados.
- El sistema genera capturas automáticas según ese intervalo.
- Sigue aplicándose la regla de no enviar una nueva orden mientras la anterior no haya finalizado o vencido.

Ejemplo visual:

[ MANUAL ]   [ AUTOMÁTICO ✓ ]

Intervalo:
[ 1 s ] [ 2 s ] [ 3 s ] [ 5 s ]   ← habilitado

REGLA DE VALIDACIÓN:
Si modo == MANUAL:
    intervalo UI = deshabilitado
    intervalo no se usa para disparar

Si modo == AUTOMATICO:
    intervalo UI = habilitado
    intervalo obligatorio y dentro de minIntervalMs/maxIntervalMs

IMPORTANTE PARA EL CÓDIGO:
- Actualizar tipos, validaciones, pantallas y reglas para no ofrecer MIXTO al usuario.
- Si contratos antiguos todavía contienen 'MIXTO', no usarlo en la interfaz nueva.
- La siguiente actualización formal del Archivo Maestro debe reflejar este cambio para mantener coherencia entre documentación y código.


----------------------------------------------------------------------
25.2 EL CAMBIO DE MARCADOR SIEMPRE ES MANUAL
----------------------------------------------------------------------

DECISIÓN:
El cambio de marcador nunca debe ser automático.

El sistema NO debe inferir, adelantar ni cambiar marcadores por tiempo, distancia, cantidad de fotos o GPS.

El marcador cambia solamente cuando el operador lo ordena manualmente.

COMPORTAMIENTO EN MODO MANUAL:
- Durante la pasada el operador puede pulsar "Cambiar marcador".
- Selecciona el nuevo marcador.
- Confirma.
- A partir de ese momento, las nuevas secuencias usan ese marcador.
- Las secuencias anteriores conservan el marcador anterior.

COMPORTAMIENTO EN MODO AUTOMÁTICO:
El modo automático NO elimina el control manual del marcador.

Debe existir esta posibilidad:

Captura automática en curso
        ↓
Operador pulsa "Pausar"
        ↓
Se detienen nuevas órdenes automáticas
        ↓
Operador pulsa "Cambiar marcador"
        ↓
Selecciona el nuevo marcador
        ↓
Confirma
        ↓
Operador pulsa "Reanudar"
        ↓
Continúan las capturas automáticas usando el nuevo marcador

REGLA:
En AUTOMÁTICO, el botón "Pausar" debe permanecer siempre visible y disponible mientras la pasada esté activa.

El cambio de marcador debe realizarse con la pasada pausada para evitar que una captura se genere exactamente durante el cambio de contexto.

SECUENCIA RECOMENDADA:
1. PAUSAR
2. CAMBIAR MARCADOR
3. CONFIRMAR
4. REANUDAR

No deben modificarse retrospectivamente las capturas anteriores.


----------------------------------------------------------------------
25.3 POSICIÓN DEL BOTÓN "CERRAR SESIÓN"
----------------------------------------------------------------------

DECISIÓN DE INTERFAZ:
El botón "Cerrar sesión" debe estar visible en la misma zona y a la misma altura visual que "Ajustes".

No debe quedar escondido al final de una pantalla larga ni depender de desplazarse demasiado.

OBJETIVO:
Las dos acciones principales de gestión general deben quedar claramente accesibles:

[ Ajustes ]        [ Cerrar sesión ]

o una distribución equivalente en la misma barra/cabecera/zona de acciones.

IMPORTANTE:
- "Cerrar sesión" debe seguir respetando las reglas de negocio vigentes.
- Si existe una sesión de monitoreo abierta que impide cerrar la sesión de usuario, debe aplicarse la validación correspondiente.
- La decisión aquí es de visibilidad y ubicación, no de eliminar las validaciones de seguridad/estado.


----------------------------------------------------------------------
25.4 ELIMINAR TEXTOS DE CAPACITACIÓN O EXPLICACIONES INTERNAS EN LA UI
----------------------------------------------------------------------

DECISIÓN:
La aplicación NO debe parecer un manual, tutorial o documento técnico.

Eliminar de las pantallas:
- explicaciones extensas;
- textos que enseñan cómo funciona internamente la arquitectura;
- frases sobre Expo Go, Development Build, backend simulado, fases del proyecto o tareas T-XX;
- explicaciones de por qué una función todavía no está disponible;
- mensajes dirigidos al desarrollador;
- textos de capacitación innecesarios;
- descripciones técnicas que el operador no necesita para realizar su trabajo.

EJEMPLOS DE TEXTOS QUE NO DEBEN APARECER:
- "Expo Go usa dos cámaras virtuales en memoria para probar el flujo."
- "La comunicación TCP/WebSocket real entra en Development Build."
- "La integración real se completa en T-06."
- "Persistencia y alta manual de incidencias se completan en T-13."
- "La cola real hacia Spring Boot todavía no se activa en v0.1."
- "Reservado para Fase 2."
- "Esta pantalla queda preparada en la estructura."
- "Los códigos definitivos todavía están pendientes de validación..." cuando el detalle técnico no sea necesario para operar.

Estos detalles pueden existir en:
- logs;
- documentación;
- README;
- comentarios de código;
- archivos de contexto para IA/desarrollador.

Pero NO deben mostrarse al usuario final.


----------------------------------------------------------------------
25.5 FUNCIONES TODAVÍA NO IMPLEMENTADAS: MOSTRAR SOLO "PENDIENTE"
----------------------------------------------------------------------

DECISIÓN:
Cuando una función exista en la interfaz pero aún no esté implementada, no mostrar una explicación técnica extensa.

Usar solamente:

"Pendiente"

o, si se necesita un mínimo de contexto:

"Función pendiente"

Nada más.

EJEMPLO INCORRECTO:
"La cola de nube aún no se ejecuta en esta versión. La sincronización real corresponde a Fase 4."

EJEMPLO CORRECTO:
"Pendiente"

EJEMPLO INCORRECTO:
"El escaneo QR y la comunicación local real se habilitan en Development Build (Fase 2)."

EJEMPLO CORRECTO:
"Pendiente"

REGLA:
La interfaz debe separar completamente:
- información útil para el operador;
- información interna de desarrollo.

El operador solo ve lo necesario para usar la app.


----------------------------------------------------------------------
25.6 PRINCIPIO GENERAL DE DISEÑO DE LA UI
----------------------------------------------------------------------

La siguiente IA debe aplicar esta regla:

"MENOS TEXTO, MÁS ESTADO Y ACCIÓN."

Las pantallas deben priorizar:
- título corto;
- estado actual;
- datos necesarios;
- botones;
- alertas importantes;
- validaciones claras.

Evitar párrafos largos.

PREFERIR:
Estado: CONECTADA
Batería: 82 %
Espacio: 14.2 GB
Última captura: UTILIZABLE

EVITAR:
"La cámara virtual se encuentra actualmente conectada a través de un simulador en memoria..."

La UI debe sentirse como una aplicación de trabajo de campo, no como una maqueta académica.


----------------------------------------------------------------------
25.7 AJUSTE RECOMENDADO DE PANTALLA "NUEVA SESIÓN"
----------------------------------------------------------------------

La pantalla debe simplificarse aproximadamente así:

NUEVA SESIÓN

Modo de captura

[ MANUAL ]    [ AUTOMÁTICO ]

Intervalo
[ 1 s ] [ 2 s ] [ 3 s ] [ 5 s ]

[ CREAR SESIÓN ]

REGLAS VISUALES:

Si MANUAL:
- intervalo atenuado;
- fondo blanco/transparente;
- sin interacción;
- no mostrar error por intervalo.

Si AUTOMÁTICO:
- intervalo activo;
- selección obligatoria;
- destacar opción seleccionada.

No mostrar:
- MIXTO;
- textos sobre configuración interna;
- textos de desarrollo;
- explicaciones largas.


----------------------------------------------------------------------
25.8 AJUSTE RECOMENDADO DE "PASADA ACTIVA"
----------------------------------------------------------------------

Debe priorizar:

PASADA ACTIVA
Lote / Hilera / Lateral
Marcador actual
GPS / precisión
Cámara 1
Cámara 2
Contadores

Modo MANUAL:
[ CAPTURAR ]
[ PAUSAR ]
[ CAMBIAR MARCADOR ]
[ TERMINAR PASADA ]

Modo AUTOMÁTICO:
Captura automática: ACTIVA
Intervalo: X s

[ PAUSAR ]
[ CAMBIAR MARCADOR ]   ← disponible cuando está pausada
[ TERMINAR PASADA ]

Cuando AUTOMÁTICO está pausado:

Captura automática: PAUSADA

[ REANUDAR ]
[ CAMBIAR MARCADOR ]
[ TERMINAR PASADA ]

El cambio de marcador sigue siendo manual en todos los casos.


----------------------------------------------------------------------
25.9 ESTADO DE ESTAS DECISIONES
----------------------------------------------------------------------

Estas decisiones deben considerarse NUEVAS REGLAS VIGENTES PARA LA SIGUIENTE ITERACIÓN DE LA APP:

- MIXTO eliminado de la UI.
- MANUAL deshabilita intervalo.
- AUTOMÁTICO habilita intervalo.
- Cambio de marcador siempre manual.
- AUTOMÁTICO debe permitir pausa para cambiar marcador.
- "Cerrar sesión" al mismo nivel visual de "Ajustes".
- Eliminar textos de capacitación.
- Eliminar explicaciones técnicas de funciones incompletas.
- Para funciones incompletas mostrar solo "Pendiente".
- UI compacta, operativa y orientada al trabajador de campo.

La siguiente IA debe aplicar estos cambios antes de ampliar nuevas funciones.


FIN DEL CONTEXTO TÉCNICO
